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

test('recordVote accepteert alleen voor/tegen en wijst resultaatkeuzes vóór databasegebruik af', async () => {
  let usedDatabase = false;
  const store = createVoteStoreMariaDB({
    withTransaction: async () => { usedDatabase = true; },
  });
  for (const choice of ['misschien', 'blanco', 'onthouding']) {
    await assert.rejects(
      store.recordVote(3, 11, { entitlementId: 7, choice }),
      { code: 'INVALID_INPUT' }
    );
  }
  assert.equal(usedDatabase, false);
});

test('recordOwnerVote fan-out één keuze atomair naar elk eigen in-scope aanwezig recht', async () => {
  const calls = [];
  let insertId = 40;
  const conn = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/remaining_microseconds/.test(sql)) {
        return [[{ status: 'open', remaining_microseconds: '5000000' }]];
      }
      if (/SELECT e\.id, e\.splitsing_code/.test(sql)) {
        return [[
          { id: 7, splitsing_code: 'TF', weight: '1.2500', current_choice: null, current_accepted_at: null },
          { id: 8, splitsing_code: 'PG', weight: '0.5000', current_choice: null, current_accepted_at: null },
        ]];
      }
      if (/INSERT INTO vote_revision/.test(sql)) return [{ insertId: ++insertId }];
      if (/SELECT accepted_at/.test(sql)) return [[{ accepted_at: new Date('2026-08-22T14:00:00Z') }]];
      throw new Error(`Onverwachte query: ${sql}`);
    },
  };
  const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  const result = await store.recordOwnerVote(3, 11, { choice: 'voor' });

  assert.deepEqual(result, {
    roundId: 3,
    choice: 'voor',
    entitlementCount: 2,
    acceptedAt: '2026-08-22T14:00:00.000Z',
    changed: true,
  });
  const authorization = calls.find(({ sql }) => /SELECT e\.id, e\.splitsing_code/.test(sql));
  assert.match(authorization.sql, /e\.participant_id = \?/);
  assert.match(authorization.sql, /mqe\.attendance_present = 1/);
  assert.match(authorization.sql, /JSON_CONTAINS/);
  assert.deepEqual(authorization.params, [3, 11]);
  assert.deepEqual(
    calls.filter(({ sql }) => /INSERT INTO vote_revision/.test(sql)).map(({ params }) => params),
    [[3, 7, 'voor'], [3, 8, 'voor']]
  );
});

test('recordOwnerVote is idempotent voor dezelfde keuze en maakt geen nieuwe revisies', async () => {
  let inserted = false;
  const conn = {
    async execute(sql) {
      if (/remaining_microseconds/.test(sql)) {
        return [[{ status: 'open', remaining_microseconds: '5000000' }]];
      }
      if (/SELECT e\.id, e\.splitsing_code/.test(sql)) {
        return [[
          { id: 7, current_choice: 'voor', current_accepted_at: new Date('2026-08-22T13:59:00Z') },
          { id: 8, current_choice: 'voor', current_accepted_at: new Date('2026-08-22T14:00:00Z') },
        ]];
      }
      if (/INSERT INTO vote_revision/.test(sql)) inserted = true;
      throw new Error(`Onverwachte query: ${sql}`);
    },
  };
  const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  const result = await store.recordOwnerVote(3, 11, { choice: 'voor' });
  assert.equal(result.changed, false);
  assert.equal(result.entitlementCount, 2);
  assert.equal(result.acceptedAt, '2026-08-22T14:00:00.000Z');
  assert.equal(inserted, false);
});

test('recordOwnerVote lekt geen rechten van een andere eigenaar en schrijft niets', async () => {
  let inserted = false;
  const conn = {
    async execute(sql) {
      if (/remaining_microseconds/.test(sql)) {
        return [[{ status: 'open', remaining_microseconds: '5000000' }]];
      }
      if (/SELECT e\.id, e\.splitsing_code/.test(sql)) return [[]];
      if (/INSERT INTO vote_revision/.test(sql)) inserted = true;
      throw new Error(`Onverwachte query: ${sql}`);
    },
  };
  const store = createVoteStoreMariaDB({ withTransaction: (fn) => fn(conn) });
  await assert.rejects(store.recordOwnerVote(3, 12, { choice: 'tegen' }), {
    code: 'ENTITLEMENT_FORBIDDEN',
  });
  assert.equal(inserted, false);
});

test('getParticipantStatus geeft alleen eigenaarmetadata en eigen geactiveerde rechten terug', async () => {
  const conn = {
    async execute(sql, params) {
      if (/FROM participant p/.test(sql)) {
        assert.deepEqual(params, [11, 3]);
        return [[{
          display_name: 'Test Eigenaar', object_label: 'Testobject',
          vve_code: 'VVE-TEST', meeting_date: '2026-09-01',
        }]];
      }
      if (/FROM round r/.test(sql)) {
        assert.deepEqual(params, [3]);
        return [[{
          id: 7, round_version: 2, title: 'Synthetisch voorstel',
          splitsingen: '["TF","PG"]', effective_status: 'open', remaining_seconds: 25,
        }]];
      }
      if (/SELECT e\.splitsing_code/.test(sql)) {
        assert.deepEqual(params, [7, 11]);
        assert.match(sql, /WHERE e\.participant_id = \?/);
        assert.match(sql, /mqe\.attendance_present = 1/);
        return [[
          { splitsing_code: 'PG', weight: '0.5000' },
          { splitsing_code: 'TF', weight: '1.2500' },
        ]];
      }
      throw new Error(`Onverwachte query: ${sql}`);
    },
  };
  const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
  const result = await store.getParticipantStatus(11, 3);
  assert.deepEqual(result, {
    participant: { displayName: 'Test Eigenaar', objectLabel: 'Testobject' },
    meeting: { vveCode: 'VVE-TEST', date: '2026-09-01' },
    version: 2,
    status: 'open',
    remainingSeconds: 25,
    round: { id: 7, title: 'Synthetisch voorstel', splitsingen: ['TF', 'PG'] },
    eligible: true,
    entitlements: [
      { splitsingCode: 'PG', weight: '0.5000' },
      { splitsingCode: 'TF', weight: '1.2500' },
    ],
  });
  assert.equal(JSON.stringify(result).includes('participantId'), false);
  assert.equal(JSON.stringify(result).includes('entitlementId'), false);
});

test('getOwnerCurrentVote vat de server-side fan-out samen zonder entitlement-id’s te lekken', async () => {
  const conn = {
    async execute(sql, params) {
      assert.match(sql, /WHERE e\.participant_id = \?/);
      assert.match(sql, /mqe\.attendance_present = 1/);
      assert.deepEqual(params, [7, 11]);
      return [[
        { entitlement_id: 2, choice: 'tegen', accepted_at: new Date('2026-08-22T13:00:00Z') },
        { entitlement_id: 3, choice: 'tegen', accepted_at: new Date('2026-08-22T13:00:01Z') },
      ]];
    },
  };
  const store = createVoteStoreMariaDB({ withConnection: (fn) => fn(conn) });
  assert.deepEqual(await store.getOwnerCurrentVote(7, 11), {
    roundId: 7,
    choice: 'tegen',
    entitlementCount: 2,
    acceptedAt: '2026-08-22T13:00:01.000Z',
  });
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
