// MariaDB-implementatie van de correctheidskritische stemverwerking.
// Correctheidskritisch: append-only revisies + atomair sluiten (ADR-0002 regel 3).
// Claude (Validator) toetst dit tegen de acceptatiecriteria voor stemrondes.
import {
  withConnection as defaultWithConnection,
  withTransaction as defaultWithTransaction,
} from '../../db/pool.js';
import { calculateVoteResult } from '../../domain/vote-result.js';

/** @returns {import('../interfaces.js').VoteStore} */
export function createVoteStoreMariaDB({
  withConnection = defaultWithConnection,
  withTransaction = defaultWithTransaction,
} = {}) {
  return {
    async openRound(motionId, durationSeconds) {
      assertDuration(durationSeconds);
      return withConnection(async (conn) => {
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
            WHERE e.id = ?
              AND e.participant_id = ?
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

    async getRoundStatus(roundId) {
      return withConnection(async (conn) => {
        const [[row]] = await conn.execute(
          `SELECT id, status, round_version,
                  GREATEST(0, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), closes_at) / 1000000)) AS remaining_seconds
             FROM round WHERE id = ?`,
          [roundId]
        );
        if (!row) return null;
        return {
          roundId: row.id,
          status: row.status,
          roundVersion: row.round_version,
          remainingSeconds: row.status === 'open' ? Number(row.remaining_seconds) : 0,
        };
      });
    },

    async closeRoundAtomically(roundId) {
      // ALLES in één transactie (ADR-0002 regel 3):
      //  1) lock de ronde (FOR UPDATE) en zet 'closing' -> weigert nieuwe stemmen
      //  2) bepaal per recht de LAATSTE revisie vóór sluiting
      //  3) bereken gewogen uitslag + quorum (bestaande VvE-regels; NIET opnieuw bedenken)
      //  4) schrijf onveranderlijke round_result, zet ronde 'closed'
      return withTransaction(async (conn) => {
        const [[round]] = await conn.execute(
          `SELECT r.id, r.status, m.meeting_id,
                  m.quorum_numerator, m.quorum_denominator,
                  m.majority_numerator, m.majority_denominator
             FROM round r
             JOIN motion m ON m.id = r.motion_id
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

        await conn.execute("UPDATE round SET status = 'closing' WHERE id = ?", [roundId]);

        // Laatste revisie per recht (correlated subquery op MAX(id)). DECIMAL blijft
        // tekst in mysql2; de rekenkern schaalt exact naar bigint-eenheden.
        const [finalVotes] = await conn.execute(
          `SELECT vr.entitlement_id, vr.choice, e.weight, e.splitsing_code
             FROM vote_revision vr
             JOIN entitlement e ON e.id = vr.entitlement_id
            WHERE vr.round_id = ?
              AND vr.id = (
                SELECT MAX(vr2.id) FROM vote_revision vr2
                 WHERE vr2.round_id = vr.round_id
                   AND vr2.entitlement_id = vr.entitlement_id
              )`,
          [roundId]
        );

        const [[eligibility]] = await conn.execute(
          `SELECT CAST(COALESCE(SUM(e.weight), 0) AS CHAR) AS eligible_weight
             FROM entitlement e
             JOIN participant p ON p.id = e.participant_id
             JOIN round r ON r.id = ?
             JOIN motion m ON m.id = r.motion_id AND m.meeting_id = p.meeting_id
            WHERE m.splitsingen IS NULL OR JSON_CONTAINS(m.splitsingen, JSON_QUOTE(e.splitsing_code))`,
          [roundId]
        );

        const snapshot = calculateVoteResult(finalVotes, {
          eligibleWeight: eligibility.eligible_weight,
          quorumNumerator: round.quorum_numerator,
          quorumDenominator: round.quorum_denominator,
          majorityNumerator: round.majority_numerator,
          majorityDenominator: round.majority_denominator,
        });

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

function assertChoice(choice) {
  if (!['voor', 'tegen', 'blanco', 'onthouding'].includes(choice)) {
    const error = new Error('choice_invalid');
    error.code = 'INVALID_INPUT';
    throw error;
  }
}
