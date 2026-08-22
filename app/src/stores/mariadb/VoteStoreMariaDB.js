// MariaDB-implementatie van de correctheidskritische stemverwerking.
// Correctheidskritisch: append-only revisies + atomair sluiten (ADR-0002 regel 3).
// Claude (Validator) toetst dit tegen de acceptatiecriteria voor stemrondes.
import {
  withConnection as defaultWithConnection,
  withTransaction as defaultWithTransaction,
} from '../../db/pool.js';
import { calculateVoteResult, formatWeight, parseWeight } from '../../domain/vote-result.js';

/** @returns {import('../interfaces.js').VoteStore} */
export function createVoteStoreMariaDB({
  withConnection = defaultWithConnection,
  withTransaction = defaultWithTransaction,
} = {}) {
  return {
    async openRound(motionId, durationSeconds) {
      assertDuration(durationSeconds);
      return withConnection(async (conn) => {
        const [[motion]] = await conn.execute(
          `SELECT m.id, m.opening_attendance_numerator, m.opening_attendance_denominator,
                  CAST(mq.basis_weight AS CHAR) AS basis_weight,
                  CAST(mq.eligible_weight AS CHAR) AS eligible_weight
             FROM motion m
             LEFT JOIN meeting_quorum mq ON mq.meeting_id = m.meeting_id
            WHERE m.id = ?`,
          [motionId]
        );
        if (!motion) throw domainError('MOTION_NOT_FOUND', 'motion_not_found');
        if (motion.basis_weight === null) {
          throw domainError('QUORUM_NOT_ESTABLISHED', 'meeting_quorum_not_established');
        }
        if (motion.opening_attendance_numerator !== null
            && !meetsRatio(
              motion.basis_weight,
              motion.eligible_weight,
              motion.opening_attendance_numerator,
              motion.opening_attendance_denominator
            )) {
          throw domainError(
            'MOTION_ATTENDANCE_REQUIREMENT_NOT_MET',
            'motion_attendance_requirement_not_met'
          );
        }
        const [res] = await conn.execute(
          `INSERT INTO round (motion_id, round_version, status, opened_at, closes_at)
           VALUES (?, 1, 'open', UTC_TIMESTAMP(3),
                   DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
          [motionId, durationSeconds]
        );
        const [rows] = await conn.execute(
          `SELECT id, motion_id, round_version, status, opened_at, closed_at,
                  GREATEST(0, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), closes_at) / 1000000)) AS remaining_seconds
             FROM round WHERE id = ?`,
          [res.insertId]
        );
        return mapRound(rows[0]);
      });
    },

    async recordVote(roundId, participantId, { entitlementId, choice }) {
      assertOwnerScope(participantId, entitlementId);
      assertChoice(choice);
      // Append-only: NOOIT updaten/deleten. De laatste geaccepteerde revisie telt.
      // Weiger als de ronde niet (meer) open is — de server bevestigt pas na acceptatie.
      return withTransaction(async (conn) => {
        const [[round]] = await conn.execute(
          `SELECT status, closes_at,
                  TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), closes_at) AS remaining_microseconds
             FROM round WHERE id = ? FOR UPDATE`,
          [roundId]
        );
        if (!round || round.status !== 'open' || BigInt(round.remaining_microseconds ?? 0) <= 0n) {
          const e = new Error('round_not_open');
          e.code = 'ROUND_NOT_OPEN';
          throw e;
        }

        // Row-level autorisatie: recht, eigenaar en ronde moeten server-side bij
        // dezelfde vergadering/splitsing horen. Een actieve machtiging blokkeert
        // digitaal stemmen; normaal is die al onherstelbaar vervallen bij login.
        const [[entitlement]] = await conn.execute(
          `SELECT e.id
             FROM entitlement e
             JOIN participant p ON p.id = e.participant_id
             JOIN round r ON r.id = ?
             JOIN motion m ON m.id = r.motion_id AND m.meeting_id = p.meeting_id
             JOIN meeting_quorum_entitlement mqe
               ON mqe.meeting_id = m.meeting_id AND mqe.entitlement_id = e.id
            WHERE e.id = ?
              AND e.participant_id = ?
              AND mqe.attendance_present = 1
              AND (m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code)))
              AND NOT EXISTS (
                    SELECT 1 FROM power_of_attorney pa
                     WHERE pa.meeting_id = p.meeting_id
                       AND pa.entitlement_id = e.id
                       AND pa.status = 'active'
                  )
            LIMIT 1`,
          [roundId, entitlementId, participantId]
        );
        if (!entitlement) {
          const e = new Error('entitlement_forbidden');
          e.code = 'ENTITLEMENT_FORBIDDEN';
          throw e;
        }

        const [res] = await conn.execute(
          `INSERT INTO vote_revision (round_id, entitlement_id, choice, accepted_at)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
          [roundId, entitlementId, choice]
        );
        const [[rev]] = await conn.execute(
          'SELECT accepted_at FROM vote_revision WHERE id = ?',
          [res.insertId]
        );
        return { acceptedAt: toIso(rev.accepted_at) };
      });
    },

    async recordOwnerVote(roundId, participantId, { choice }) {
      assertParticipantScope(participantId);
      assertChoice(choice);
      return withTransaction(async (conn) => {
        const [[round]] = await conn.execute(
          `SELECT status, closes_at,
                  TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), closes_at) AS remaining_microseconds
             FROM round WHERE id = ? FOR UPDATE`,
          [roundId]
        );
        if (!round || round.status !== 'open' || BigInt(round.remaining_microseconds ?? 0) <= 0n) {
          throw domainError('ROUND_NOT_OPEN', 'round_not_open');
        }

        // Eén eigenaarsactie selecteert de volledige, bevroren set server-side.
        // De client kent geen entitlement-id's en kan de fan-out dus niet sturen.
        const [entitlements] = await conn.execute(
          `SELECT e.id, e.splitsing_code, CAST(e.weight AS CHAR) AS weight,
                  (SELECT vr.choice
                     FROM vote_revision vr
                    WHERE vr.round_id = r.id AND vr.entitlement_id = e.id
                    ORDER BY vr.id DESC LIMIT 1) AS current_choice,
                  (SELECT vr.accepted_at
                     FROM vote_revision vr
                    WHERE vr.round_id = r.id AND vr.entitlement_id = e.id
                    ORDER BY vr.id DESC LIMIT 1) AS current_accepted_at
             FROM entitlement e
             JOIN participant p ON p.id = e.participant_id
             JOIN round r ON r.id = ?
             JOIN motion m ON m.id = r.motion_id AND m.meeting_id = p.meeting_id
             JOIN meeting_quorum_entitlement mqe
               ON mqe.meeting_id = m.meeting_id
              AND mqe.entitlement_id = e.id
              AND mqe.attendance_present = 1
            WHERE e.participant_id = ?
              AND (m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code)))
              AND NOT EXISTS (
                    SELECT 1 FROM power_of_attorney pa
                     WHERE pa.meeting_id = p.meeting_id
                       AND pa.entitlement_id = e.id
                       AND pa.status = 'active'
                  )
            ORDER BY e.id
            FOR UPDATE`,
          [roundId, participantId]
        );
        if (entitlements.length === 0) {
          throw domainError('ENTITLEMENT_FORBIDDEN', 'entitlement_forbidden');
        }

        const unchanged = entitlements.every((row) => row.current_choice === choice);
        if (unchanged) {
          const acceptedAt = mostRecent(entitlements.map((row) => row.current_accepted_at));
          return {
            roundId,
            choice,
            entitlementCount: entitlements.length,
            acceptedAt: toIso(acceptedAt),
            changed: false,
          };
        }

        let lastInsertId;
        for (const entitlement of entitlements) {
          const [result] = await conn.execute(
            `INSERT INTO vote_revision (round_id, entitlement_id, choice, accepted_at)
             VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
            [roundId, entitlement.id, choice]
          );
          lastInsertId = result.insertId;
        }
        const [[revision]] = await conn.execute(
          'SELECT accepted_at FROM vote_revision WHERE id = ?',
          [lastInsertId]
        );
        return {
          roundId,
          choice,
          entitlementCount: entitlements.length,
          acceptedAt: toIso(revision.accepted_at),
          changed: true,
        };
      });
    },

    async getCurrentVote(roundId, participantId, entitlementId) {
      assertOwnerScope(participantId, entitlementId);
      return withConnection(async (conn) => {
        // Laatste revisie per (ronde, recht): hoogste id wint.
        const [[row]] = await conn.execute(
          `SELECT vr.entitlement_id, vr.choice
             FROM vote_revision vr
             JOIN entitlement e ON e.id = vr.entitlement_id
             JOIN participant p ON p.id = e.participant_id
             JOIN round r ON r.id = vr.round_id
             JOIN motion m ON m.id = r.motion_id AND m.meeting_id = p.meeting_id
            WHERE vr.round_id = ?
              AND vr.entitlement_id = ?
              AND e.participant_id = ?
              AND (m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code)))
            ORDER BY vr.id DESC LIMIT 1`,
          [roundId, entitlementId, participantId]
        );
        return row ? { entitlementId: row.entitlement_id, choice: row.choice } : null;
      });
    },

    async getOwnerCurrentVote(roundId, participantId) {
      assertParticipantScope(participantId);
      return withConnection(async (conn) => {
        const [rows] = await conn.execute(
          `SELECT e.id AS entitlement_id, vr.choice, vr.accepted_at
             FROM entitlement e
             JOIN participant p ON p.id = e.participant_id
             JOIN round r ON r.id = ?
             JOIN motion m ON m.id = r.motion_id AND m.meeting_id = p.meeting_id
             JOIN meeting_quorum_entitlement mqe
               ON mqe.meeting_id = m.meeting_id
              AND mqe.entitlement_id = e.id
              AND mqe.attendance_present = 1
             JOIN vote_revision vr
               ON vr.round_id = r.id
              AND vr.entitlement_id = e.id
              AND vr.id = (
                    SELECT MAX(latest.id)
                      FROM vote_revision latest
                     WHERE latest.round_id = r.id
                       AND latest.entitlement_id = e.id
                  )
            WHERE e.participant_id = ?
              AND (m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code)))
            ORDER BY e.id`,
          [roundId, participantId]
        );
        if (rows.length === 0) return null;
        const choices = new Set(rows.map((row) => row.choice));
        if (choices.size !== 1) throw domainError('VOTE_STATE_INCONSISTENT', 'vote_state_inconsistent');
        const acceptedAt = mostRecent(rows.map((row) => row.accepted_at));
        return {
          roundId,
          choice: rows[0].choice,
          entitlementCount: rows.length,
          acceptedAt: toIso(acceptedAt),
        };
      });
    },

    async getParticipantStatus(participantId, meetingId, roundId = null) {
      assertParticipantScope(participantId);
      assertParticipantScope(meetingId, 'meetingId');
      return withConnection(async (conn) => {
        const [[participant]] = await conn.execute(
          `SELECT p.display_name, p.object_label, mt.vve_code, mt.meeting_date
             FROM participant p
             JOIN meeting mt ON mt.id = p.meeting_id
            WHERE p.id = ? AND p.meeting_id = ?`,
          [participantId, meetingId]
        );
        if (!participant) throw domainError('SESSION_INVALID', 'session_invalid');

        const roundFilter = roundId ? ' AND r.id = ?' : '';
        const roundParams = roundId ? [meetingId, roundId] : [meetingId];
        const [[round]] = await conn.execute(
          `SELECT r.id, r.round_version, m.title, m.splitsingen,
                  CASE
                    WHEN r.status = 'open' AND r.closes_at <= UTC_TIMESTAMP(3) THEN 'closing'
                    ELSE r.status
                  END AS effective_status,
                  GREATEST(0, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), r.closes_at) / 1000000))
                    AS remaining_seconds
             FROM round r
             JOIN motion m ON m.id = r.motion_id
            WHERE m.meeting_id = ?${roundFilter}
            ORDER BY CASE
                       WHEN r.status = 'open' AND r.closes_at > UTC_TIMESTAMP(3) THEN 0
                       WHEN r.status = 'waiting' THEN 1
                       WHEN r.status IN ('open', 'closing') THEN 2
                       ELSE 3
                     END,
                     r.id DESC
            LIMIT 1`,
          roundParams
        );

        const base = {
          participant: {
            displayName: participant.display_name,
            objectLabel: participant.object_label,
          },
          meeting: {
            vveCode: participant.vve_code,
            date: dateOnly(participant.meeting_date),
          },
        };
        if (!round) {
          if (roundId) return null;
          return {
            ...base,
            version: 0,
            status: 'waiting',
            remainingSeconds: 0,
            round: null,
            eligible: false,
            entitlements: [],
          };
        }

        const [entitlements] = await conn.execute(
          `SELECT e.splitsing_code, CAST(e.weight AS CHAR) AS weight
             FROM entitlement e
             JOIN participant p ON p.id = e.participant_id
             JOIN motion m ON m.meeting_id = p.meeting_id
             JOIN round r ON r.motion_id = m.id AND r.id = ?
             JOIN meeting_quorum_entitlement mqe
               ON mqe.meeting_id = m.meeting_id
              AND mqe.entitlement_id = e.id
              AND mqe.attendance_present = 1
            WHERE e.participant_id = ?
              AND (m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code)))
              AND NOT EXISTS (
                    SELECT 1 FROM power_of_attorney pa
                     WHERE pa.meeting_id = p.meeting_id
                       AND pa.entitlement_id = e.id
                       AND pa.status = 'active'
                  )
            ORDER BY e.splitsing_code, e.id`,
          [round.id, participantId]
        );
        const status = round.effective_status;
        return {
          ...base,
          version: Number(round.round_version),
          status,
          remainingSeconds: status === 'open' ? Number(round.remaining_seconds) : 0,
          round: {
            id: Number(round.id),
            title: round.title,
            splitsingen: parseJsonArray(round.splitsingen),
          },
          eligible: status === 'open' && entitlements.length > 0,
          entitlements: entitlements.map((row) => ({
            splitsingCode: row.splitsing_code,
            weight: row.weight,
          })),
        };
      });
    },

    async getRoundStatus(roundId) {
      return withConnection(async (conn) => {
        const [[row]] = await conn.execute(
          `SELECT id,
                  CASE
                    WHEN status = 'open' AND closes_at <= UTC_TIMESTAMP(3) THEN 'closing'
                    ELSE status
                  END AS effective_status,
                  round_version,
                  GREATEST(0, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), closes_at) / 1000000)) AS remaining_seconds
             FROM round WHERE id = ?`,
          [roundId]
        );
        if (!row) return null;
        return {
          roundId: row.id,
          status: row.effective_status,
          roundVersion: row.round_version,
          remainingSeconds: row.effective_status === 'open' ? Number(row.remaining_seconds) : 0,
        };
      });
    },

    async closeRoundAtomically(roundId) {
      // ALLES in één transactie (ADR-0002 regel 3):
      //  1) lock de ronde (FOR UPDATE) en zet 'closing' -> weigert nieuwe stemmen
      //  2) bepaal per deelnemend recht de LAATSTE revisie vóór sluiting
      //  3) registreer ontbrekende stemmen onveranderlijk als onthouding (ADR-0010)
      //  4) bereken uitsluitend de meerderheid; rapporteer het bevroren meetingquorum
      //  5) schrijf onveranderlijke round_result, zet ronde 'closed'
      return withTransaction(async (conn) => {
        const [[round]] = await conn.execute(
          `SELECT r.id, r.status, m.meeting_id,
                  m.majority_numerator, m.majority_denominator,
                  mq.quorum_met, CAST(mq.basis_weight AS CHAR) AS basis_weight,
                  CAST(mq.eligible_weight AS CHAR) AS eligible_weight,
                  mq.quorum_numerator, mq.quorum_denominator, mq.set_by, mq.set_at
             FROM round r
             JOIN motion m ON m.id = r.motion_id
             LEFT JOIN meeting_quorum mq ON mq.meeting_id = m.meeting_id
            WHERE r.id = ? FOR UPDATE`,
          [roundId]
        );
        if (!round) throw new Error('round_not_found');
        if (round.status === 'closed') {
          const [[existing]] = await conn.execute(
            'SELECT snapshot FROM round_result WHERE round_id = ?',
            [roundId]
          );
          return { roundId, snapshot: existing ? parseSnapshot(existing.snapshot) : null };
        }
        if (round.quorum_met === null) {
          throw domainError('QUORUM_NOT_ESTABLISHED', 'meeting_quorum_not_established');
        }

        await conn.execute("UPDATE round SET status = 'closing' WHERE id = ?", [roundId]);

        // De bevroren deelnemende set is leidend. Een ontbrekende revisie wordt
        // een automatische onthouding, dus de uitslag is volledig (ADR-0010).
        const [finalVotes] = await conn.execute(
          `SELECT mqe.entitlement_id,
                  COALESCE(vr.choice, 'onthouding') AS choice,
                  CAST(mqe.weight_snapshot AS CHAR) AS weight,
                  CASE WHEN vr.id IS NULL THEN 1 ELSE 0 END AS automatic_abstention
             FROM round r
             JOIN motion m ON m.id = r.motion_id
             JOIN meeting_quorum_entitlement mqe ON mqe.meeting_id = m.meeting_id
             JOIN entitlement e ON e.id = mqe.entitlement_id
             LEFT JOIN vote_revision vr
               ON vr.round_id = r.id
              AND vr.entitlement_id = mqe.entitlement_id
              AND vr.id = (
                SELECT MAX(vr2.id) FROM vote_revision vr2
                 WHERE vr2.round_id = r.id
                   AND vr2.entitlement_id = mqe.entitlement_id
              )
            WHERE r.id = ?
              AND (m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code)))
            ORDER BY mqe.entitlement_id`,
          [roundId]
        );

        const automaticAbstentions = finalVotes.filter(
          (vote) => Number(vote.automatic_abstention) === 1
        );
        for (const vote of automaticAbstentions) {
          await conn.execute(
            `INSERT INTO round_automatic_abstention
               (round_id, entitlement_id, weight_snapshot, registered_at)
             VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
            [roundId, vote.entitlement_id, vote.weight]
          );
        }
        const automaticWeight = automaticAbstentions.reduce(
          (sum, vote) => sum + parseWeight(vote.weight),
          0n
        );
        if (automaticAbstentions.length > 0) {
          await conn.execute(
            `INSERT INTO audit_event (actor, action, context, created_at)
             VALUES ('system:round-close', 'round_non_votes_registered_as_abstention', ?, UTC_TIMESTAMP(3))`,
            [JSON.stringify({
              meetingId: round.meeting_id,
              roundId,
              entitlementIds: automaticAbstentions.map((vote) => vote.entitlement_id),
              count: automaticAbstentions.length,
              weight: formatWeight(automaticWeight),
            })]
          );
        }

        const voteResult = calculateVoteResult(finalVotes, {
          majorityNumerator: round.majority_numerator,
          majorityDenominator: round.majority_denominator,
        });
        const snapshot = {
          ...voteResult,
          submittedVoteCount: finalVotes.length - automaticAbstentions.length,
          automaticAbstentions: {
            count: automaticAbstentions.length,
            weight: formatWeight(automaticWeight),
          },
          quorum: {
            meetingId: round.meeting_id,
            met: Number(round.quorum_met) === 1,
            basisWeight: round.basis_weight,
            eligibleWeight: round.eligible_weight,
            numerator: Number(round.quorum_numerator),
            denominator: Number(round.quorum_denominator),
            setBy: round.set_by,
            setAt: toIso(round.set_at),
            frozen: true,
          },
        };

        await conn.execute(
          `INSERT INTO round_result (round_id, snapshot, created_at)
           VALUES (?, ?, UTC_TIMESTAMP(3))`,
          [roundId, JSON.stringify(snapshot)]
        );
        await conn.execute(
          "UPDATE round SET status = 'closed', closed_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [roundId]
        );
        return { roundId, snapshot };
      });
    },
  };
}

function mapRound(r) {
  return {
    id: r.id, motionId: r.motion_id, roundVersion: r.round_version,
    status: r.status, openedAt: toIso(r.opened_at), closedAt: toIso(r.closed_at),
    remainingSeconds: r.status === 'open' ? Number(r.remaining_seconds) : 0,
  };
}
function toIso(v) { return v ? new Date(v).toISOString() : null; }
function parseSnapshot(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

function assertDuration(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86400) {
    throw new TypeError('durationSeconds moet een geheel getal tussen 1 en 86400 zijn.');
  }
}

function assertOwnerScope(participantId, entitlementId) {
  if (!Number.isSafeInteger(participantId) || participantId < 1) throw new TypeError('participantId ontbreekt.');
  if (!Number.isSafeInteger(entitlementId) || entitlementId < 1) throw new TypeError('entitlementId ontbreekt.');
}

function assertParticipantScope(value, field = 'participantId') {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} ontbreekt.`);
}

function assertChoice(choice) {
  // ADR-0011: het eigenaarpad kent uitsluitend de twee in-app knoppen.
  // Blanco komt later via het papier-/adminpad; onthouding ontstaat bij sluiten.
  if (!['voor', 'tegen'].includes(choice)) {
    const error = new Error('choice_invalid');
    error.code = 'INVALID_INPUT';
    throw error;
  }
}

function meetsRatio(basisWeight, eligibleWeight, numerator, denominator) {
  const basis = parseWeight(basisWeight);
  const eligible = parseWeight(eligibleWeight);
  const numeratorBig = BigInt(numerator);
  const denominatorBig = BigInt(denominator);
  return eligible > 0n && basis * denominatorBig >= eligible * numeratorBig;
}

function domainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseJsonArray(value) {
  if (value === null || value === undefined) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

function dateOnly(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

function mostRecent(values) {
  return values.filter(Boolean).reduce(
    (latest, value) => latest === null || value > latest ? value : latest,
    null
  );
}
