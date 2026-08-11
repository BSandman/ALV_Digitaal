// MariaDB-implementatie van vergadering, eigenaarsgroepen en stemrechten.
import {
  withConnection as defaultWithConnection,
  withTransaction as defaultWithTransaction,
} from '../../db/pool.js';
import { calculateMeetingQuorum, formatWeight, parseWeight } from '../../domain/vote-result.js';

/** @returns {import('../interfaces.js').MeetingStore} */
export function createMeetingStoreMariaDB({
  withConnection = defaultWithConnection,
  withTransaction = defaultWithTransaction,
} = {}) {
  return {
    async getMeeting(meetingId) {
      return withConnection(async (conn) => {
        const [[row]] = await conn.execute('SELECT * FROM meeting WHERE id = ?', [meetingId]);
        return row || null;
      });
    },

    async listParticipants(meetingId) {
      return withConnection(async (conn) => {
        const [rows] = await conn.execute(
          'SELECT * FROM participant WHERE meeting_id = ? ORDER BY display_name',
          [meetingId]
        );
        return rows;
      });
    },

    async listEntitlements(participantId) {
      // Rechten NIET samenvoegen: elk recht apart teruggeven (ADR/scope v0.1.0 §4).
      return withConnection(async (conn) => {
        const [rows] = await conn.execute(
          'SELECT * FROM entitlement WHERE participant_id = ? ORDER BY splitsing_code',
          [participantId]
        );
        return rows;
      });
    },

    async setAttendance(meetingId, participantId, present) {
      // 'Present' = juridische registratie; wordt niet automatisch verwijderd (v0.1.0 §5).
      return withTransaction(async (conn) => {
        const [[meeting]] = await conn.execute('SELECT id FROM meeting WHERE id = ? FOR UPDATE', [meetingId]);
        if (!meeting) throw domainError('MEETING_NOT_FOUND', 'meeting_not_found');
        const [[participant]] = await conn.execute(
          'SELECT id FROM participant WHERE id = ? AND meeting_id = ?',
          [participantId, meetingId]
        );
        if (!participant) throw domainError('PARTICIPANT_NOT_FOUND', 'participant_not_found');
        await conn.execute(
          `INSERT INTO attendance (meeting_id, participant_id, present, changed_at)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE present = VALUES(present), changed_at = UTC_TIMESTAMP(3)`,
          [meetingId, participantId, present ? 1 : 0]
        );
      });
    },

    async establishQuorum(meetingId, { setBy, quorumNumerator, quorumDenominator }) {
      assertPositiveId(meetingId, 'meetingId');
      assertActor(setBy);
      // Eén meeting-lock serialiseert presentieregistratie en de eenmalige
      // voorzittersactie. De detailset en audit worden in dezelfde transactie gezet.
      return withTransaction(async (conn) => {
        const [[meeting]] = await conn.execute('SELECT id FROM meeting WHERE id = ? FOR UPDATE', [meetingId]);
        if (!meeting) throw domainError('MEETING_NOT_FOUND', 'meeting_not_found');

        const [[existing]] = await conn.execute(
          `SELECT meeting_id, quorum_met, CAST(basis_weight AS CHAR) AS basis_weight,
                  CAST(eligible_weight AS CHAR) AS eligible_weight,
                  quorum_numerator, quorum_denominator, set_by, set_at
             FROM meeting_quorum WHERE meeting_id = ?`,
          [meetingId]
        );
        if (existing) return mapQuorum(existing);

        const [[rounds]] = await conn.execute(
          `SELECT COUNT(*) AS amount
             FROM round r
             JOIN motion m ON m.id = r.motion_id
            WHERE m.meeting_id = ?`,
          [meetingId]
        );
        if (Number(rounds.amount) > 0) {
          throw domainError('QUORUM_TOO_LATE', 'quorum_must_be_established_before_first_round');
        }

        const [entitlements] = await conn.execute(
          `SELECT e.id AS entitlement_id, CAST(e.weight AS CHAR) AS weight,
                  COALESCE(a.present, 0) AS attendance_present,
                  CASE WHEN pa.id IS NULL THEN 0 ELSE 1 END AS power_submitted
             FROM entitlement e
             JOIN participant p ON p.id = e.participant_id
             LEFT JOIN attendance a
               ON a.meeting_id = p.meeting_id AND a.participant_id = p.id
             LEFT JOIN power_of_attorney pa
               ON pa.meeting_id = p.meeting_id
              AND pa.entitlement_id = e.id
              AND pa.status = 'active'
            WHERE p.meeting_id = ?
            ORDER BY e.id
            FOR UPDATE`,
          [meetingId]
        );
        const participating = entitlements.filter(
          (row) => isDatabaseTrue(row.attendance_present) || isDatabaseTrue(row.power_submitted)
        );
        const eligibleWeight = sumWeights(entitlements);
        const basisWeight = sumWeights(participating);
        const quorum = calculateMeetingQuorum(
          formatWeight(basisWeight),
          formatWeight(eligibleWeight),
          quorumNumerator,
          quorumDenominator
        );

        for (const row of participating) {
          await conn.execute(
            `INSERT INTO meeting_quorum_entitlement
               (meeting_id, entitlement_id, attendance_present, power_submitted, weight_snapshot)
             VALUES (?, ?, ?, ?, ?)`,
            [
              meetingId,
              row.entitlement_id,
              isDatabaseTrue(row.attendance_present) ? 1 : 0,
              isDatabaseTrue(row.power_submitted) ? 1 : 0,
              row.weight,
            ]
          );
        }
        await conn.execute(
          `INSERT INTO meeting_quorum
             (meeting_id, quorum_met, basis_weight, eligible_weight,
              quorum_numerator, quorum_denominator, set_by, set_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [
            meetingId,
            quorum.met ? 1 : 0,
            quorum.basisWeight,
            quorum.eligibleWeight,
            quorum.numerator,
            quorum.denominator,
            setBy,
          ]
        );
        await conn.execute(
          `INSERT INTO audit_event (actor, action, context, created_at)
           VALUES (?, 'meeting_quorum_established', ?, UTC_TIMESTAMP(3))`,
          [
            setBy,
            JSON.stringify({
              meetingId,
              quorumMet: quorum.met,
              basisWeight: quorum.basisWeight,
              eligibleWeight: quorum.eligibleWeight,
              quorumNumerator: quorum.numerator,
              quorumDenominator: quorum.denominator,
              participantEntitlementCount: participating.length,
            }),
          ]
        );
        const [[created]] = await conn.execute(
          `SELECT meeting_id, quorum_met, CAST(basis_weight AS CHAR) AS basis_weight,
                  CAST(eligible_weight AS CHAR) AS eligible_weight,
                  quorum_numerator, quorum_denominator, set_by, set_at
             FROM meeting_quorum WHERE meeting_id = ?`,
          [meetingId]
        );
        return mapQuorum(created);
      });
    },
  };
}

function sumWeights(rows) {
  return rows.reduce((sum, row) => sum + parseWeight(row.weight), 0n);
}

function isDatabaseTrue(value) {
  return Number(value) === 1;
}

function mapQuorum(row) {
  return {
    meetingId: row.meeting_id,
    met: isDatabaseTrue(row.quorum_met),
    basisWeight: row.basis_weight,
    eligibleWeight: row.eligible_weight,
    numerator: Number(row.quorum_numerator),
    denominator: Number(row.quorum_denominator),
    setBy: row.set_by,
    setAt: new Date(row.set_at).toISOString(),
  };
}

function assertPositiveId(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} ontbreekt.`);
}

function assertActor(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > 255) {
    throw new TypeError('setBy moet een geldige voorzitter-identificatie zijn.');
  }
}

function domainError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
