import assert from 'node:assert/strict';
import http from 'node:http';
import { closePool, withConnection } from '../src/db/pool.js';
import { createRequestHandler } from '../src/server.js';
import { createAuthStoreMariaDB } from '../src/stores/mariadb/AuthStoreMariaDB.js';
import { createMeetingStoreMariaDB } from '../src/stores/mariadb/MeetingStoreMariaDB.js';
import { createVoteStoreMariaDB } from '../src/stores/mariadb/VoteStoreMariaDB.js';

const pepper = process.env.AUTH_PEPPER;
if (!pepper) throw new Error('AUTH_PEPPER ontbreekt voor integratietest.');

const auth = createAuthStoreMariaDB({ pepper });
const meetings = createMeetingStoreMariaDB();
const votes = createVoteStoreMariaDB();
const ids = await seedOwnerScenario();
await meetings.establishQuorum(ids.meetingId, {
  setBy: 'chair:owner-frontend-test',
  quorumNumerator: 1,
  quorumDenominator: 2,
});
const round = await votes.openRound(ids.motionId, 60);
const ownerCredential = await auth.provisionCredential({
  participantId: ids.ownerId,
  meetingId: ids.meetingId,
  inviteVersion: 1,
  visiblePrefix: `OWNER${ids.meetingId}`,
});
const otherCredential = await auth.provisionCredential({
  participantId: ids.otherOwnerId,
  meetingId: ids.meetingId,
  inviteVersion: 1,
  visiblePrefix: `OTHER${ids.meetingId}`,
});

const server = http.createServer(createRequestHandler({ authStore: auth, voteStore: votes }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
  const ownerSession = await login(port, ownerCredential.code, 'owner-device-binding-synthetic');
  const otherSession = await login(port, otherCredential.code, 'other-device-binding-synthetic');

  const firstStatus = await ownerRequest(port, ownerSession, '/deelnemen/api/status');
  assert.equal(firstStatus.response.status, 200);
  assert.equal(firstStatus.body.status, 'open');
  assert.equal(firstStatus.body.round.id, round.id);
  assert.deepEqual(firstStatus.body.entitlements.map((item) => item.splitsingCode), ['PG', 'TF']);
  assert.equal(firstStatus.body.eligible, true);
  assert.doesNotMatch(JSON.stringify(firstStatus.body), /Andere Testeigenaar|ANDER-OBJECT/);

  const notModified = await ownerRequest(port, ownerSession, '/deelnemen/api/status', {
    'If-None-Match': firstStatus.response.headers.get('etag'),
  });
  assert.equal(notModified.response.status, 304);

  const otherStatus = await ownerRequest(port, otherSession, '/deelnemen/api/status');
  assert.equal(otherStatus.body.entitlements.length, 1);
  assert.equal(otherStatus.body.entitlements[0].splitsingCode, 'PG');
  assert.doesNotMatch(JSON.stringify(otherStatus.body), /Test Eigenaar|EIGEN-OBJECT/);

  const firstVote = await ownerRequest(port, ownerSession, '/deelnemen/api/vote', {}, {
    method: 'POST',
    body: JSON.stringify({ roundId: round.id, choice: 'voor' }),
  });
  assert.equal(firstVote.response.status, 201);
  assert.equal(firstVote.body.entitlementCount, 2);
  assert.equal(firstVote.body.changed, true);

  const currentVoor = await ownerRequest(
    port,
    ownerSession,
    `/deelnemen/api/vote?roundId=${round.id}`
  );
  assert.deepEqual(
    { choice: currentVoor.body.choice, entitlementCount: currentVoor.body.entitlementCount },
    { choice: 'voor', entitlementCount: 2 }
  );

  const changedVote = await ownerRequest(port, ownerSession, '/deelnemen/api/vote', {}, {
    method: 'POST',
    body: JSON.stringify({ roundId: round.id, choice: 'tegen' }),
  });
  assert.equal(changedVote.response.status, 201);
  assert.equal(changedVote.body.changed, true);

  const idempotentVote = await ownerRequest(port, ownerSession, '/deelnemen/api/vote', {}, {
    method: 'POST',
    body: JSON.stringify({ roundId: round.id, choice: 'tegen' }),
  });
  assert.equal(idempotentVote.response.status, 200);
  assert.equal(idempotentVote.body.changed, false);

  const evidence = await withConnection(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT e.participant_id, e.splitsing_code, vr.choice, COUNT(*) OVER () AS total_revisions
         FROM vote_revision vr
         JOIN entitlement e ON e.id = vr.entitlement_id
        WHERE vr.round_id = ?
        ORDER BY vr.id`,
      [round.id]
    );
    return rows;
  });
  assert.equal(evidence.length, 4, 'twee keuzes x twee rechten; idempotente herhaling schrijft niets');
  assert.ok(evidence.every((row) => Number(row.participant_id) === ids.ownerId));
  assert.deepEqual(evidence.map((row) => row.choice), ['voor', 'voor', 'tegen', 'tegen']);

  await votes.closeRoundAtomically(round.id);
  const closedStatus = await ownerRequest(port, ownerSession, '/deelnemen/api/status');
  assert.equal(closedStatus.body.status, 'closed');
  assert.equal(closedStatus.body.remainingSeconds, 0);

  console.log(JSON.stringify({
    codeLogin: 'ok',
    etag304: 'ok',
    rowIsolation: 'ok',
    fanoutEntitlements: 2,
    choices: ['voor', 'tegen'],
    revisionsAfterIdempotentRepeat: evidence.length,
    pollingTerminalStatus: closedStatus.body.status,
  }));
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closePool();
}

async function seedOwnerScenario() {
  return withConnection(async (conn) => {
    const [meeting] = await conn.execute(
      "INSERT INTO meeting (vve_code, meeting_date, status, invite_version) VALUES ('VVE-TEST-OWNER-UI', '2026-09-01', 'open', 1)"
    );
    const [owner] = await conn.execute(
      "INSERT INTO participant (meeting_id, display_name, object_label) VALUES (?, 'Test Eigenaar', 'EIGEN-OBJECT')",
      [meeting.insertId]
    );
    const [otherOwner] = await conn.execute(
      "INSERT INTO participant (meeting_id, display_name, object_label) VALUES (?, 'Andere Testeigenaar', 'ANDER-OBJECT')",
      [meeting.insertId]
    );
    const [tf] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'TF', 1.2500)",
      [owner.insertId]
    );
    const [pg] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'PG', 0.5000)",
      [owner.insertId]
    );
    await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'PG', 2.0000)",
      [otherOwner.insertId]
    );
    await conn.execute(
      'INSERT INTO attendance (meeting_id, participant_id, present) VALUES (?, ?, 1), (?, ?, 1)',
      [meeting.insertId, owner.insertId, meeting.insertId, otherOwner.insertId]
    );
    const [motion] = await conn.execute(
      `INSERT INTO motion (meeting_id, title, splitsingen)
       VALUES (?, 'Synthetische onderhoudsbegroting', JSON_ARRAY('TF', 'PG'))`,
      [meeting.insertId]
    );
    return {
      meetingId: meeting.insertId,
      ownerId: owner.insertId,
      otherOwnerId: otherOwner.insertId,
      entitlementIds: [tf.insertId, pg.insertId],
      motionId: motion.insertId,
    };
  });
}

async function login(port, code, deviceBinding) {
  const response = await fetch(`http://127.0.0.1:${port}/deelnemen/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, deviceBinding }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  return { token: body.sessionToken, deviceBinding };
}

async function ownerRequest(port, session, pathname, extraHeaders = {}, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Device-Binding': session.deviceBinding,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: options.body,
  });
  const body = response.status === 304 ? null : await response.json();
  return { response, body };
}
