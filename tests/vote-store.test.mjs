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
      return [[{ id: 5, effective_status: 'open', round_version: 2, remaining_seconds: 17 }]];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
  const status = await store.getRoundStatus(5);
  assert.deepEqual(status, { roundId: 5, status: 'open', roundVersion: 2, remainingSeconds: 17 });
  assert.equal('closesAt' in status, false);
});

test('een verstreken serverdeadline wordt als closing met nul seconden gepubliceerd', async () => {
  const conn = {
    async execute() {
      return [[{ id: 5, effective_status: 'closing', round_version: 2, remaining_seconds: 0 }]];
    },
  };
  const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
  assert.deepEqual(await store.getRoundStatus(5), {
    roundId: 5, status: 'closing', roundVersion: 2, remainingSeconds: 0,
  });
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
          quorum_met: 1, basis_weight: '5.0000', eligible_weight: '10.0000',
          quorum_numerator: 1, quorum_denominator: 2, set_by: 'chair:1',
          set_at: new Date('2026-08-11T08:00:00Z'),
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

test('openRound weigert vóór de eenmalige vergaderingquorumvaststelling', async () => {
  const conn = {
    async execute(sql) {
      if (/FROM motion m/.test(sql)) return [[{
        id: 4,
        opening_attendance_numerator: null,
        opening_attendance_denominator: null,
        basis_weight: null,
        eligible_weight: null,
      }]];
      throw new Error(`Onverwachte query: ${sql}`);
    },
  };
  const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
  await assert.rejects(store.openRound(4, 30), { code: 'QUORUM_NOT_ESTABLISHED' });
});

test('gekwalificeerde openstelling gebruikt exact dezelfde vergadering-brede presentiebasis', async () => {
  for (const scenario of [
    { basis: '2.0000', eligible: '3.0000', opens: true },
    { basis: '1.9999', eligible: '3.0000', opens: false },
  ]) {
    let inserted = false;
    const conn = {
      async execute(sql) {
        if (/FROM motion m/.test(sql)) return [[{
          id: 4,
          opening_attendance_numerator: 2,
          opening_attendance_denominator: 3,
          basis_weight: scenario.basis,
          eligible_weight: scenario.eligible,
        }]];
        if (/INSERT INTO round/.test(sql)) {
          inserted = true;
          return [{ insertId: 9 }];
        }
        if (/SELECT id, motion_id/.test(sql)) return [[{
          id: 9, motion_id: 4, round_version: 1, status: 'open',
          opened_at: new Date('2026-08-11T08:00:00Z'), closed_at: null,
          remaining_seconds: 30,
        }]];
        throw new Error(`Onverwachte query: ${sql}`);
      },
    };
    const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
    if (scenario.opens) {
      assert.equal((await store.openRound(4, 30)).id, 9);
      assert.equal(inserted, true);
    } else {
      await assert.rejects(
        store.openRound(4, 30),
        { code: 'MOTION_ATTENDANCE_REQUIREMENT_NOT_MET' }
      );
      assert.equal(inserted, false);
    }
  }
});

test('sluiten registreert niet-stemmend deelnemend recht als geauditeerde onthouding', async () => {
  const calls = [];
  const conn = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT r\.id, r\.status/.test(sql)) return [[{
        id: 5, status: 'open', meeting_id: 1,
        majority_numerator: 2, majority_denominator: 3,
        quorum_met: 1, basis_weight: '4.0000', eligible_weight: '4.0000',
        quorum_numerator: 1, quorum_denominator: 2,
        set_by: 'chair:1', set_at: new Date('2026-08-11T08:00:00Z'),
      }]];
      if (/SELECT mqe\.entitlement_id/.test(sql)) return [[
        { entitlement_id: 10, choice: 'voor', weight: '2.0000', automatic_abstention: 0 },
        { entitlement_id: 11, choice: 'onthouding', weight: '2.0000', automatic_abstention: 1 },
      ]];
      if (/INSERT INTO round_result/.test(sql)) return [{ insertId: 1 }];
      return [{}];
    },
  };
  const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  const result = await store.closeRoundAtomically(5);
  assert.equal(result.snapshot.perChoiceWeight.onthouding, '2.0000');
  assert.deepEqual(result.snapshot.automaticAbstentions, { count: 1, weight: '2.0000' });
  assert.equal(result.snapshot.submittedVoteCount, 1);
  assert.equal(result.snapshot.quorum.frozen, true);
  assert.ok(calls.some(({ sql }) => /INSERT INTO round_automatic_abstention/.test(sql)));
  assert.ok(calls.some(({ sql }) => /round_non_votes_registered_as_abstention/.test(sql)));
});
