import assert from 'node:assert/strict';
import { closePool, withConnection } from '../src/db/pool.js';
import { createAuthStoreMariaDB } from '../src/stores/mariadb/AuthStoreMariaDB.js';
import { createMeetingStoreMariaDB } from '../src/stores/mariadb/MeetingStoreMariaDB.js';
import { createVoteStoreMariaDB } from '../src/stores/mariadb/VoteStoreMariaDB.js';

const pepper = process.env.AUTH_PEPPER;
if (!pepper) throw new Error('AUTH_PEPPER ontbreekt voor integratietest.');

const ids = await seedScenario();
const auth = createAuthStoreMariaDB({ pepper });
const meetings = createMeetingStoreMariaDB();
const votes = createVoteStoreMariaDB();

const { code } = await auth.provisionCredential({
  participantId: ids.ownerId,
  meetingId: ids.meetingId,
  inviteVersion: 1,
  visiblePrefix: 'TST001',
});

const firstLogin = await auth.authenticate({
  code,
  deviceBinding: 'integration-device-binding-one',
  clientIp: '203.0.113.21',
});
assert.equal(firstLogin.invalidatedPowerCount, 1);

const secondLogin = await auth.authenticate({
  code,
  deviceBinding: 'integration-device-binding-two',
  clientIp: '203.0.113.21',
});
await assert.rejects(
  auth.verifySession({
    sessionToken: firstLogin.sessionToken,
    deviceBinding: 'integration-device-binding-one',
  }),
  { code: 'SESSION_INVALID' }
);
assert.deepEqual(
  await auth.verifySession({
    sessionToken: secondLogin.sessionToken,
    deviceBinding: 'integration-device-binding-two',
  }),
  { participantId: ids.ownerId, meetingId: ids.meetingId }
);

const quorum = await meetings.establishQuorum(ids.meetingId, {
  setBy: 'chair:integration', quorumNumerator: 1, quorumDenominator: 2,
});
assert.equal(quorum.met, true);
assert.equal(quorum.basisWeight, '6.0000');
assert.deepEqual(
  await meetings.establishQuorum(ids.meetingId, {
    setBy: 'chair:other', quorumNumerator: 2, quorumDenominator: 3,
  }),
  quorum
);

const round = await votes.openRound(ids.motionId, 30);
assert.ok(round.remainingSeconds > 0 && round.remainingSeconds <= 30);
assert.equal('closesAt' in round, false);

await votes.recordVote(round.id, ids.ownerId, { entitlementId: ids.ownerPgId, choice: 'voor' });
await votes.recordVote(round.id, ids.ownerId, { entitlementId: ids.ownerTfId, choice: 'tegen' });
await votes.recordVote(round.id, ids.otherId, { entitlementId: ids.otherPgId, choice: 'onthouding' });
await assert.rejects(
  votes.recordVote(round.id, ids.ownerId, { entitlementId: ids.otherPgId, choice: 'voor' }),
  { code: 'ENTITLEMENT_FORBIDDEN' }
);

const status = await votes.getRoundStatus(round.id);
assert.ok(status.remainingSeconds > 0);
assert.equal('closesAt' in status, false);

const result = await votes.closeRoundAtomically(round.id);
assert.equal(result.snapshot.quorum.met, true);
assert.equal(result.snapshot.quorum.frozen, true);
assert.equal(result.snapshot.majority.met, true);
assert.deepEqual(result.snapshot.automaticAbstentions, { count: 1, weight: '1.0000' });
assert.deepEqual(result.snapshot.perChoiceWeight, {
  voor: '2.0000', tegen: '1.0000', blanco: '0.0000', onthouding: '3.0000',
});

const attackAuth = createAuthStoreMariaDB({ pepper, maxIpFailures: 2, maxCredentialFailures: 10 });
await attackAuth.provisionCredential({
  participantId: ids.otherId,
  meetingId: ids.meetingId,
  inviteVersion: 1,
  visiblePrefix: 'TST002',
});
await assert.rejects(
  attackAuth.authenticate({
    code: 'TST002-verkeerd-geheim',
    deviceBinding: 'integration-device-binding-attack',
    clientIp: '203.0.113.22',
  }),
  { code: 'AUTH_INVALID' }
);
await assert.rejects(
  attackAuth.authenticate({
    code: 'TST002-nogmaals-verkeerd',
    deviceBinding: 'integration-device-binding-attack',
    clientIp: '203.0.113.22',
  }),
  { code: 'AUTH_LOCKED' }
);
await assert.rejects(
  attackAuth.authenticate({
    code: 'ONBEKEND-verkeerd',
    deviceBinding: 'integration-device-binding-attack',
    clientIp: '203.0.113.22',
  }),
  { code: 'AUTH_RATE_LIMITED' }
);

const evidence = await withConnection(async (conn) => {
  const [[power]] = await conn.execute(
    'SELECT status, invalidated_at FROM power_of_attorney WHERE entitlement_id = ?',
    [ids.ownerPgId]
  );
  const [[audit]] = await conn.execute(
    "SELECT COUNT(*) AS amount FROM audit_event WHERE action = 'power_of_attorney_invalidated_owner_login'"
  );
  const [[sessions]] = await conn.execute(
    'SELECT SUM(revoked_at IS NULL) AS active FROM session WHERE credential_id = 1'
  );
  const [[attempts]] = await conn.execute(
    "SELECT COUNT(*) AS amount FROM authentication_attempt WHERE succeeded = 0"
  );
  const [[failedCredential]] = await conn.execute(
    'SELECT failed_attempts, locked_until FROM credential WHERE id = 2'
  );
  const [[sqlMode]] = await conn.execute('SELECT @@SESSION.sql_mode AS value');
  const [[autoAbstention]] = await conn.execute(
    'SELECT COUNT(*) AS amount FROM round_automatic_abstention WHERE round_id = ?',
    [round.id]
  );
  const [[autoAudit]] = await conn.execute(
    "SELECT COUNT(*) AS amount FROM audit_event WHERE action = 'round_non_votes_registered_as_abstention'"
  );
  const [[quorumAudit]] = await conn.execute(
    "SELECT COUNT(*) AS amount FROM audit_event WHERE action = 'meeting_quorum_established'"
  );
  return {
    power, audit, sessions, attempts, failedCredential, sqlMode,
    autoAbstention, autoAudit, quorumAudit,
  };
});
assert.equal(evidence.power.status, 'invalidated_owner_login');
assert.ok(evidence.power.invalidated_at);
assert.equal(Number(evidence.audit.amount), 1);
assert.equal(Number(evidence.sessions.active), 1);
assert.equal(Number(evidence.attempts.amount), 3);
assert.equal(Number(evidence.failedCredential.failed_attempts), 1);
assert.ok(evidence.failedCredential.locked_until);
assert.match(evidence.sqlMode.value, /NO_BACKSLASH_ESCAPES/);
assert.equal(Number(evidence.autoAbstention.amount), 1);
assert.equal(Number(evidence.autoAudit.amount), 1);
assert.equal(Number(evidence.quorumAudit.amount), 1);
await assert.rejects(
  withConnection((conn) => conn.execute(
    "UPDATE power_of_attorney SET status = 'active', invalidated_at = NULL WHERE entitlement_id = ?",
    [ids.ownerPgId]
  )),
  /power_of_attorney_invalidation_is_irreversible/
);
await assert.rejects(
  withConnection((conn) => conn.execute(
    'UPDATE meeting_quorum SET quorum_met = 0 WHERE meeting_id = ?',
    [ids.meetingId]
  )),
  /meeting_quorum_is_frozen/
);
await assert.rejects(
  withConnection((conn) => conn.execute(
    `INSERT INTO meeting_quorum_entitlement
       (meeting_id, entitlement_id, attendance_present, power_submitted, weight_snapshot)
     VALUES (?, ?, 1, 0, 1.0000)`,
    [ids.meetingId, ids.ownerPgId]
  )),
  /meeting_quorum_entitlements_are_frozen/
);

console.log(JSON.stringify({
  rowLevelAuthorization: 'green',
  oneActiveDevice: 'green',
  powerInvalidationAudit: 'green',
  exactBoundaryMath: 'green',
  frozenMeetingQuorum: 'green',
  automaticAbstentionAudit: 'green',
  relativeTimer: 'green',
  bruteForceLockout: 'green',
  irreversiblePowerInvalidation: 'green',
  strictSqlMode: 'green',
}));
await closePool();

async function seedScenario() {
  return withConnection(async (conn) => {
    const [meeting] = await conn.execute(
      "INSERT INTO meeting (vve_code, meeting_date, status, invite_version) VALUES ('VVE-TEST-HARDENING', '2026-09-01', 'open', 1)"
    );
    const meetingId = meeting.insertId;
    const [owner] = await conn.execute(
      "INSERT INTO participant (meeting_id, display_name, object_label) VALUES (?, 'Testgroep Alpha', 'Testobject Alpha')",
      [meetingId]
    );
    const [other] = await conn.execute(
      "INSERT INTO participant (meeting_id, display_name, object_label) VALUES (?, 'Testgroep Beta', 'Testobject Beta')",
      [meetingId]
    );
    const [ownerPg] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'PG', 2.0000)",
      [owner.insertId]
    );
    const [ownerTf] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'TF', 1.0000)",
      [owner.insertId]
    );
    const [otherPg] = await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'PG', 2.0000)",
      [other.insertId]
    );
    await conn.execute(
      "INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES (?, 'TF', 1.0000)",
      [other.insertId]
    );
    const [motion] = await conn.execute(
      `INSERT INTO motion
         (meeting_id, title, splitsingen, majority_numerator, majority_denominator)
       VALUES (?, 'Synthetisch hardeningvoorstel', NULL, 2, 3)`,
      [meetingId]
    );
    await conn.execute(
      'INSERT INTO attendance (meeting_id, participant_id, present) VALUES (?, ?, 1), (?, ?, 1)',
      [meetingId, owner.insertId, meetingId, other.insertId]
    );
    await conn.execute(
      'INSERT INTO power_of_attorney (meeting_id, entitlement_id) VALUES (?, ?)',
      [meetingId, ownerPg.insertId]
    );
    return {
      meetingId,
      motionId: motion.insertId,
      ownerId: owner.insertId,
      otherId: other.insertId,
      ownerPgId: ownerPg.insertId,
      ownerTfId: ownerTf.insertId,
      otherPgId: otherPg.insertId,
    };
  });
}
