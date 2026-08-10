// MariaDB-implementatie van VoteStore (SKELET voor Codex, Fase 3).
// Correctheidskritisch: append-only revisies + atomair sluiten (ADR-0002 regel 3).
// Claude (Validator) toetst dit tegen de acceptatiecriteria voor stemrondes.
import { withConnection, withTransaction } from '../../db/pool.js';

/** @returns {import('../interfaces.js').VoteStore} */
export function createVoteStoreMariaDB() {
  return {
    async openRound(motionId) {
      return withConnection(async (conn) => {
        const [res] = await conn.query(
          `INSERT INTO round (motion_id, round_version, status, opened_at)
           VALUES (?, 1, 'open', UTC_TIMESTAMP(3))`,
          [motionId]
        );
        const [rows] = await conn.query('SELECT * FROM round WHERE id = ?', [res.insertId]);
        return mapRound(rows[0]);
      });
    },

    async recordVote(roundId, { entitlementId, choice }) {
      // Append-only: NOOIT updaten/deleten. De laatste geaccepteerde revisie telt.
      // Weiger als de ronde niet (meer) open is — de server bevestigt pas na acceptatie.
      return withTransaction(async (conn) => {
        const [[round]] = await conn.query(
          'SELECT status FROM round WHERE id = ? FOR UPDATE',
          [roundId]
        );
        if (!round || round.status !== 'open') {
          const e = new Error('round_not_open');
          e.code = 'ROUND_NOT_OPEN';
          throw e;
        }
        // TODO(Codex): valideer dat entitlementId bij de ingelogde eigenaarsgroep hoort
        //              (row-level, ADR-0002 regel 4) — NIET client-side.
        const [res] = await conn.query(
          `INSERT INTO vote_revision (round_id, entitlement_id, choice, accepted_at)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
          [roundId, entitlementId, choice]
        );
        const [[rev]] = await conn.query(
          'SELECT accepted_at FROM vote_revision WHERE id = ?',
          [res.insertId]
        );
        return { acceptedAt: toIso(rev.accepted_at) };
      });
    },

    async getCurrentVote(roundId, entitlementId) {
      return withConnection(async (conn) => {
        // Laatste revisie per (ronde, recht): hoogste id wint.
        const [[row]] = await conn.query(
          `SELECT entitlement_id, choice
             FROM vote_revision
            WHERE round_id = ? AND entitlement_id = ?
            ORDER BY id DESC LIMIT 1`,
          [roundId, entitlementId]
        );
        return row ? { entitlementId: row.entitlement_id, choice: row.choice } : null;
      });
    },

    async closeRoundAtomically(roundId) {
      // ALLES in één transactie (ADR-0002 regel 3):
      //  1) lock de ronde (FOR UPDATE) en zet 'closing' -> weigert nieuwe stemmen
      //  2) bepaal per recht de LAATSTE revisie vóór sluiting
      //  3) bereken gewogen uitslag + quorum (bestaande VvE-regels; NIET opnieuw bedenken)
      //  4) schrijf onveranderlijke round_result, zet ronde 'closed'
      return withTransaction(async (conn) => {
        const [[round]] = await conn.query(
          'SELECT id, status FROM round WHERE id = ? FOR UPDATE',
          [roundId]
        );
        if (!round) throw new Error('round_not_found');
        if (round.status === 'closed') {
          const [[existing]] = await conn.query(
            'SELECT snapshot FROM round_result WHERE round_id = ?',
            [roundId]
          );
          return { roundId, snapshot: existing ? JSON.parse(existing.snapshot) : null };
        }

        await conn.query("UPDATE round SET status = 'closing' WHERE id = ?", [roundId]);

        // Laatste revisie per recht (correlated subquery op MAX(id)).
        const [finalVotes] = await conn.query(
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

        // TODO(Codex): roep hier de GEÏSOLEERDE, met regressietests vastgepinde
        //              VvE-rekenkern aan (gewogen uitslag + quorum + PG-blok).
        //              Deze skeleton aggregeert alleen ruw als placeholder.
        const snapshot = computeResultPlaceholder(finalVotes);

        await conn.query(
          `INSERT INTO round_result (round_id, snapshot, created_at)
           VALUES (?, ?, UTC_TIMESTAMP(3))`,
          [roundId, JSON.stringify(snapshot)]
        );
        await conn.query(
          "UPDATE round SET status = 'closed', closed_at = UTC_TIMESTAMP(3) WHERE id = ?",
          [roundId]
        );
        return { roundId, snapshot };
      });
    },
  };
}

// --- helpers (placeholder; Codex vervangt computeResultPlaceholder door de echte kern) ---
function computeResultPlaceholder(rows) {
  const totals = { voor: 0, tegen: 0, blanco: 0, onthouding: 0 };
  for (const r of rows) totals[r.choice] += Number(r.weight);
  return { perChoiceWeight: totals, count: rows.length, note: 'PLACEHOLDER — vervang door VvE-kern' };
}
function mapRound(r) {
  return {
    id: r.id, motionId: r.motion_id, roundVersion: r.round_version,
    status: r.status, openedAt: toIso(r.opened_at), closedAt: toIso(r.closed_at),
  };
}
function toIso(v) { return v ? new Date(v).toISOString() : null; }
