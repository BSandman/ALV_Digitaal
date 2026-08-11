import assert from 'node:assert/strict';
import http from 'node:http';
import { closePool, withConnection } from '../src/db/pool.js';
import { createRequestHandler } from '../src/server.js';
import { createAuthStoreMariaDB } from '../src/stores/mariadb/AuthStoreMariaDB.js';
import { createMeetingStoreMariaDB } from '../src/stores/mariadb/MeetingStoreMariaDB.js';
import { createVoteStoreMariaDB } from '../src/stores/mariadb/VoteStoreMariaDB.js';

const votes = createVoteStoreMariaDB();
const meetings = createMeetingStoreMariaDB();
const pepper = process.env.AUTH_PEPPER;
if (!pepper) throw new Error('AUTH_PEPPER ontbreekt voor integratietest.');
const ids = await seedScenario();
await meetings.establishQuorum(ids.meetingId, {
  setBy: 'chair:concurrency', quorumNumerator: 1, quorumDenominator: 2,
});
const round = await votes.openRound(ids.motionId, 60);
const authStore = {
  async verifySession() {
    return { participantId: ids.participantId, meetingId: ids.meetingId };
  },
};
const server = http.createServer(createRequestHandler({ authStore, voteStore: votes }));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
  // Eén aantoonbaar geaccepteerde HTTP-stem vóór de grens.
  assert.equal(await postVote(port, round.id, ids.entitlementId, 'voor'), 201);

  // Vijftig HTTP-verzoeken en het sluiten starten zonder onderlinge await. Iedere
  // stem eindigt óf vóór de round-lock (201), óf ziet daarna closed (409).
  const pendingVotes = Array.from({ length: 50 }, (_, index) =>
    postVote(port, round.id, ids.entitlementId, index % 2 ? 'voor' : 'tegen')
  );
  const closing = votes.closeRoundAtomically(round.id);
  const [statuses, closed] = await Promise.all([Promise.all(pendingVotes), closing]);
  assert.ok(statuses.every((status) => status === 201 || status === 409));

  const evidence = await withConnection(async (conn) => {
    const [[counts]] = await conn.execute(
      `SELECT COUNT(*) AS revisions,
              SUM(vr.accepted_at > r.closed_at) AS accepted_after_close
         FROM vote_revision vr
         JOIN round r ON r.id = vr.round_id
        WHERE vr.round_id = ?`,
      [round.id]
    );
    const [[results]] = await conn.execute(
      'SELECT COUNT(*) AS amount FROM round_result WHERE round_id = ?',
      [round.id]
    );
    return { counts, results };
  });
  assert.equal(Number(evidence.counts.revisions), 1 + statuses.filter((status) => status === 201).length);
  assert.equal(Number(evidence.counts.accepted_after_close), 0);
  assert.equal(Number(evidence.results.amount), 1);
  assert.equal(closed.snapshot.count, Number(evidence.counts.revisions) > 0 ? 1 : 0);

  // Twee gelijktijdige sluiters leveren exact één bevroren resultaat en dezelfde snapshot.
  const secondRound = await votes.openRound(ids.motionId, 60);
  await votes.recordVote(secondRound.id, ids.participantId, {
    entitlementId: ids.entitlementId,
    choice: 'voor',
  });
  const [firstClose, secondClose] = await Promise.all([
    votes.closeRoundAtomically(secondRound.id),
    votes.closeRoundAtomically(secondRound.id),
  ]);
  assert.deepEqual(firstClose.snapshot, secondClose.snapshot);
  const resultCount = await withConnection(async (conn) => {
    const [[row]] = await conn.execute(
      'SELECT COUNT(*) AS amount FROM round_result WHERE round_id = ?',
      [secondRound.id]
    );
    return Number(row.amount);
  });
  assert.equal(resultCount, 1);

  // Eigenaarlogin en stemmen op hetzelfde gemachtigde recht mogen nooit een
  // onafgehandelde deadlock of dubbele representatie opleveren.
  const powerRace = await seedPowerRace();
  await meetings.establishQuorum(powerRace.meetingId, {
    setBy: 'chair:power-race', quorumNumerator: 1, quorumDenominator: 2,
  });
  const auth = createAuthStoreMariaDB({ pepper });
  const { code } = await auth.provisionCredential({
    participantId: powerRace.participantId,
    meetingId: powerRace.meetingId,
    inviteVersion: 1,
    visiblePrefix: `RACE${powerRace.meetingId}`,
  });
  const powerRound = await votes.openRound(powerRace.motionId, 60);
  const [loginOutcome, voteOutcome] = await Promise.allSettled([
    auth.authenticate({
      code,
      deviceBinding: 'integration-device-binding-power-race',
      clientIp: '203.0.113.23',
    }),
    votes.recordVote(powerRound.id, powerRace.participantId, {
      entitlementId: powerRace.entitlementId,
      choice: 'voor',
    }),
  ]);
  assert.equal(loginOutcome.status, 'fulfilled');
  if (voteOutcome.status === 'rejected') {
    assert.equal(voteOutcome.reason.code, 'ENTITLEMENT_FORBIDDEN');
  }
  const powerEvidence = await withConnection(async (conn) => {
    const [[power]] = await conn.execute(
      'SELECT status FROM power_of_attorney WHERE entitlement_id = ?',
      [powerRace.entitlementId]
    );
    const [[audit]] = await conn.execute(
      `SELECT COUNT(*) AS amount FROM audit_event
        WHERE action = 'power_of_attorney_invalidated_owner_login'
          AND JSON_VALUE(context, '$.entitlementId') = ?`,
      [powerRace.entitlementId]
    );
    return { power, audit };
  });
  assert.equal(powerEvidence.power.status, 'invalidated_owner_login');
  assert.equal(Number(powerEvidence.audit.amount), 1);

  console.log(JSON.stringify({
    concurrentHttpVotes: statuses.length,
    acceptedBeforeClose: 1 + statuses.filter((status) => status === 201).length,
    rejectedAfterClose: statuses.filter((status) => status === 409).length,
    acceptedAfterClose: 0,
    duplicateCloseResults: 1,
    loginPowerRace: voteOutcome.status === 'fulfilled' ? 'vote-before-or-after-invalidation' : 'safely-rejected',
  }));
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closePool();
}

async function postVote(port, roundId, entitlementId, choice) {
  const response = await fetch(`http://127.0.0.1:${port}/deelnemen/api/vote`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer integration-session',
      'X-Device-Binding': 'integration-device-binding-race',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roundId, entitlementId, choice }),
  });
  return response.status;
}

async function seedScenario() {
  return withConnection(async (conn) => {
    const [meeting] = await conn.execute(
      "INSERT INTO meeting (vve_code, meeting_date, status, invite_version) VALUES ('VVE-TEST-RACE', '2026-09-01', 'open', 1)"
    );
    const [participant] = await conn.execute(
      "INSERT INTO participant (meeting_id, display_name, object_label) VALUES (?, 'Testgroep Race', 'Testobject Race')",
      [meeting.insertId]
    );
    const [entitlement] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'PG', 1.0000)",
      [participant.insertId]
    );
    const [motion] = await conn.execute(
      `INSERT INTO motion
         (meeting_id, title, splitsingen, majority_numerator, majority_denominator)
       VALUES (?, 'Synthetische race-test', NULL, 2, 3)`,
      [meeting.insertId]
    );
    await conn.execute(
      'INSERT INTO attendance (meeting_id, participant_id, present) VALUES (?, ?, 1)',
      [meeting.insertId, participant.insertId]
    );
    return {
      meetingId: meeting.insertId,
      participantId: participant.insertId,
      entitlementId: entitlement.insertId,
      motionId: motion.insertId,
    };
  });
}

async function seedPowerRace() {
  return withConnection(async (conn) => {
    const [meeting] = await conn.execute(
      "INSERT INTO meeting (vve_code, meeting_date, status, invite_version) VALUES ('VVE-TEST-POWER-RACE', '2026-09-01', 'open', 1)"
    );
    const [participant] = await conn.execute(
      "INSERT INTO participant (meeting_id, display_name, object_label) VALUES (?, 'Testgroep Machtiging', 'Testobject Machtiging')",
      [meeting.insertId]
    );
    const [entitlement] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'PG', 1.0000)",
      [participant.insertId]
    );
    const [motion] = await conn.execute(
      "INSERT INTO motion (meeting_id, title, splitsingen) VALUES (?, 'Synthetische machtigingsrace', NULL)",
      [meeting.insertId]
    );
    await conn.execute(
      'INSERT INTO power_of_attorney (meeting_id, entitlement_id) VALUES (?, ?)',
      [meeting.insertId, entitlement.insertId]
    );
    return {
      meetingId: meeting.insertId,
      participantId: participant.insertId,
      entitlementId: entitlement.insertId,
      motionId: motion.insertId,
    };
  });
}
