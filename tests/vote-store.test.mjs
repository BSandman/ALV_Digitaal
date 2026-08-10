import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoteStoreMariaDB } from '../app/src/stores/mariadb/VoteStoreMariaDB.js';

test('recordVote autoriseert het recht server-side op participant, vergadering en splitsing', async () => {
  const calls = [];
  const conn = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/remaining_microseconds/.test(sql)) return [[{ status: 'open', remaining_microseconds: '5000000' }]];
      if (/FROM entitlement e/.test(sql)) return [[{ id: 7 }]];
      if (/INSERT INTO vote_revision/.test(sql)) return [{ insertId: 41 }];
      if (/SELECT accepted_at/.test(sql)) return [[{ accepted_at: new Date('2026-08-11T10:00:00Z') }]];
      throw new Error(`Onverwachte query: ${sql}`);
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });

  const result = await store.recordVote(3, 11, { entitlementId: 7, choice: 'voor' });
  assert.equal(result.acceptedAt, '2026-08-11T10:00:00.000Z');
  const authorization = calls.find(({ sql }) => /FROM entitlement e/.test(sql));
  assert.match(authorization.sql, /e\.participant_id = \?/);
  assert.match(authorization.sql, /m\.meeting_id = p\.meeting_id/);
  assert.match(authorization.sql, /power_of_attorney/);
  assert.deepEqual(authorization.params, [3, 7, 11]);
});

test('recordVote lekt geen bestaan van een recht buiten de ingelogde eigenaarsgroep', async () => {
  let inserted = false;
  const conn = {
    async query(sql) {
      if (/remaining_microseconds/.test(sql)) return [[{ status: 'open', remaining_microseconds: '1' }]];
      if (/FROM entitlement e/.test(sql)) return [[]];
      if (/INSERT INTO vote_revision/.test(sql)) inserted = true;
      return [{}];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  await assert.rejects(
    store.recordVote(3, 12, { entitlementId: 7, choice: 'voor' }),
    { code: 'ENTITLEMENT_FORBIDDEN' }
  );
  assert.equal(inserted, false);
});

test('server-relatieve rondestatus bevat resterende seconden maar geen absolute deadline', async () => {
  const conn = {
    async query(sql) {
      assert.match(sql, /TIMESTAMPDIFF\(MICROSECOND, UTC_TIMESTAMP\(3\), closes_at\)/);
      return [[{ id: 5, status: 'open', round_version: 2, remaining_seconds: 17 }]];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
  const status = await store.getRoundStatus(5);
  assert.deepEqual(status, { roundId: 5, status: 'open', roundVersion: 2, remainingSeconds: 17 });
  assert.equal('closesAt' in status, false);
});

test('ongeldige stemkeuze wordt vóór databasegebruik afgewezen', async () => {
  let usedDatabase = false;
  const store = createVoteStoreMariaDB({
    withTransaction: async () => { usedDatabase = true; },
  });
  await assert.rejects(
    store.recordVote(3, 11, { entitlementId: 7, choice: 'misschien' }),
    { code: 'INVALID_INPUT' }
  );
  assert.equal(usedDatabase, false);
});

test('idempotent sluiten accepteert MariaDB JSON als tekst én als reeds geparseerd object', async () => {
  for (const stored of ['{"count":1}', { count: 1 }]) {
    const conn = {
      async execute(sql) {
        if (/JOIN motion/.test(sql)) return [[{
          id: 5, status: 'closed', meeting_id: 1,
          quorum_numerator: 1, quorum_denominator: 2,
          majority_numerator: 2, majority_denominator: 3,
        }]];
        if (/SELECT snapshot/.test(sql)) return [[{ snapshot: stored }]];
        throw new Error(`Onverwachte query: ${sql}`);
      },
    };
    const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });
    assert.deepEqual(await store.closeRoundAtomically(5), { roundId: 5, snapshot: { count: 1 } });
  }
});
