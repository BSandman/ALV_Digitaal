import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeetingStoreMariaDB } from '../app/src/stores/mariadb/MeetingStoreMariaDB.js';

test('voorzitter bevriest aanwezige en gemachtigde rechten zonder dubbeltelling', async () => {
  const calls = [];
  let created = false;
  const conn = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id FROM meeting/.test(sql)) return [[{ id: 7 }]];
      if (/FROM meeting_quorum WHERE/.test(sql)) {
        return created ? [[{
          meeting_id: 7, quorum_met: 1,
          basis_weight: '6.0000', eligible_weight: '10.0000',
          quorum_numerator: 3, quorum_denominator: 5,
          set_by: 'chair:42', set_at: new Date('2026-08-11T08:00:00Z'),
        }]] : [[]];
      }
      if (/COUNT\(\*\) AS amount/.test(sql)) return [[{ amount: 0 }]];
      if (/FROM entitlement e/.test(sql)) return [[
        { entitlement_id: 1, weight: '2.0000', attendance_present: 1, power_submitted: 0 },
        { entitlement_id: 2, weight: '4.0000', attendance_present: 1, power_submitted: 1 },
        { entitlement_id: 3, weight: '4.0000', attendance_present: 0, power_submitted: 0 },
      ]];
      if (/INSERT INTO meeting_quorum\s/.test(sql)) created = true;
      return [{}];
    },
  };
  const store = createMeetingStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  const quorum = await store.establishQuorum(7, {
    setBy: 'chair:42', quorumNumerator: 3, quorumDenominator: 5,
  });
  assert.equal(quorum.met, true);
  assert.equal(quorum.basisWeight, '6.0000');
  assert.equal(quorum.eligibleWeight, '10.0000');
  const details = calls.filter(({ sql }) => /INSERT INTO meeting_quorum_entitlement/.test(sql));
  assert.equal(details.length, 2);
  assert.deepEqual(details.map(({ params }) => params[1]), [1, 2]);
  assert.ok(calls.some(({ sql }) => /meeting_quorum_established/.test(sql)));
});

test('herhaalde quorumactie retourneert de bestaande snapshot zonder mutatie of nieuwe audit', async () => {
  const calls = [];
  const conn = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id FROM meeting/.test(sql)) return [[{ id: 7 }]];
      if (/FROM meeting_quorum WHERE/.test(sql)) return [[{
        meeting_id: 7, quorum_met: 0,
        basis_weight: '4.9999', eligible_weight: '10.0000',
        quorum_numerator: 1, quorum_denominator: 2,
        set_by: 'chair:1', set_at: new Date('2026-08-11T08:00:00Z'),
      }]];
      throw new Error(`Onverwachte query: ${sql}`);
    },
  };
  const store = createMeetingStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  const result = await store.establishQuorum(7, {
    setBy: 'chair:2', quorumNumerator: 2, quorumDenominator: 3,
  });
  assert.equal(result.met, false);
  assert.equal(result.setBy, 'chair:1');
  assert.equal(calls.length, 2);
});
