// MariaDB-implementatie van vergadering, eigenaarsgroepen en stemrechten.
import { withConnection } from '../../db/pool.js';

/** @returns {import('../interfaces.js').MeetingStore} */
export function createMeetingStoreMariaDB() {
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
      return withConnection(async (conn) => {
        await conn.execute(
          `INSERT INTO attendance (meeting_id, participant_id, present, changed_at)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE present = VALUES(present), changed_at = UTC_TIMESTAMP(3)`,
          [meetingId, participantId, present ? 1 : 0]
        );
      });
    },
  };
}
