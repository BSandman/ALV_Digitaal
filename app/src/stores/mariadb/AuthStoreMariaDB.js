import { withConnection, withTransaction } from '../../db/pool.js';
import {
  createSessionToken,
  credentialLocator,
  generateCredentialCode,
  hashCredentialCode,
  keyedHash,
  verifyCredentialCode,
} from '../../security/credential-crypto.js';

const DEFAULTS = Object.freeze({
  windowSeconds: 15 * 60,
  maxIpFailures: 20,
  maxCredentialFailures: 5,
  baseBackoffSeconds: 2,
  maxBackoffSeconds: 5 * 60,
  sessionTtlSeconds: 4 * 60 * 60,
});

export function createAuthStoreMariaDB(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const withConnectionFn = options.withConnectionFn ?? withConnection;
  const withTransactionFn = options.withTransactionFn ?? withTransaction;
  if (!config.pepper) throw new TypeError('pepper is verplicht.');

  return {
    /** Provisioning retourneert de leesbare code precies één keer. */
    async provisionCredential({ participantId, meetingId, inviteVersion, visiblePrefix }) {
      const code = generateCredentialCode(visiblePrefix);
      const lookupHash = keyedHash(credentialLocator(code), config.pepper, 'credential');
      const codeHash = await hashCredentialCode(code);
      await withConnectionFn((conn) => conn.execute(
        `INSERT INTO credential
           (participant_id, meeting_id, invite_version, code_lookup_hash, code_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [participantId, meetingId, inviteVersion, lookupHash, codeHash]
      ));
      return { code };
    },

    async authenticate({ code, deviceBinding, clientIp }) {
      assertDeviceBinding(deviceBinding);
      const lookupHash = keyedHash(authenticationLocator(code), config.pepper, 'credential');
      const ipHash = keyedHash(clientIp, config.pepper, 'client-ip');

      const outcome = await withTransactionFn(async (conn) => {
        const [[limits]] = await conn.execute(
          `SELECT
             SUM(client_ip_hash = ? AND succeeded = 0) AS ip_failures,
             SUM(credential_lookup_hash = ? AND succeeded = 0) AS credential_failures
           FROM authentication_attempt
          WHERE attempted_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)`,
          [ipHash, lookupHash, config.windowSeconds]
        );
        if (Number(limits?.ip_failures ?? 0) >= config.maxIpFailures
            || Number(limits?.credential_failures ?? 0) >= config.maxCredentialFailures) {
          await recordAttempt(conn, null, lookupHash, ipHash, false);
          return failure('AUTH_RATE_LIMITED', 'authentication_rate_limited', config.maxBackoffSeconds);
        }

        const [[credential]] = await conn.execute(
          `SELECT id, participant_id, meeting_id, code_hash, failed_attempts,
                  GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), locked_until)) AS lock_seconds
             FROM credential
            WHERE code_lookup_hash = ? AND revoked_at IS NULL
            LIMIT 1 FOR UPDATE`,
          [lookupHash]
        );

        if (!credential) {
          await recordAttempt(conn, null, lookupHash, ipHash, false);
          return failure('AUTH_INVALID', 'authentication_failed');
        }
        if (Number(credential.lock_seconds ?? 0) > 0) {
          await recordAttempt(conn, credential.id, lookupHash, ipHash, false);
          return failure('AUTH_LOCKED', 'authentication_locked', Number(credential.lock_seconds));
        }

        if (!await verifyCredentialCode(code, credential.code_hash)) {
          const failures = Number(credential.failed_attempts) + 1;
          const backoffSeconds = Math.min(
            config.maxBackoffSeconds,
            config.baseBackoffSeconds * (2 ** Math.max(0, failures - 1))
          );
          await conn.execute(
            `UPDATE credential
                SET failed_attempts = ?,
                    locked_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
              WHERE id = ?`,
            [failures, backoffSeconds, credential.id]
          );
          await recordAttempt(conn, credential.id, lookupHash, ipHash, false);
          return failure('AUTH_INVALID', 'authentication_failed', backoffSeconds);
        }

        // Credential-lock + revoke/insert maakt één actieve sessie race-bestendig.
        await conn.execute(
          `UPDATE credential
              SET failed_attempts = 0, locked_until = NULL,
                  last_authenticated_at = UTC_TIMESTAMP(3)
            WHERE id = ?`,
          [credential.id]
        );
        await conn.execute(
          `UPDATE session SET revoked_at = UTC_TIMESTAMP(3)
            WHERE credential_id = ? AND revoked_at IS NULL`,
          [credential.id]
        );

        // ADR-0008 §2: lock, invalideer en audit iedere openstaande machtiging.
        const [powers] = await conn.execute(
          `SELECT pa.id, pa.entitlement_id
             FROM power_of_attorney pa
             JOIN entitlement e ON e.id = pa.entitlement_id
            WHERE pa.meeting_id = ?
              AND e.participant_id = ?
              AND pa.status = 'active'
            FOR UPDATE`,
          [credential.meeting_id, credential.participant_id]
        );
        if (powers.length > 0) {
          await conn.execute(
            `UPDATE power_of_attorney pa
             JOIN entitlement e ON e.id = pa.entitlement_id
                SET pa.status = 'invalidated_owner_login',
                    pa.invalidated_at = UTC_TIMESTAMP(3)
              WHERE pa.meeting_id = ?
                AND e.participant_id = ?
                AND pa.status = 'active'`,
            [credential.meeting_id, credential.participant_id]
          );
          for (const power of powers) {
            await conn.execute(
              `INSERT INTO audit_event (actor, action, context, created_at)
               VALUES (?, 'power_of_attorney_invalidated_owner_login', ?, UTC_TIMESTAMP(3))`,
              [
                `participant:${credential.participant_id}`,
                JSON.stringify({ meetingId: credential.meeting_id, entitlementId: power.entitlement_id }),
              ]
            );
          }
        }

        const sessionToken = createSessionToken();
        const sessionHash = keyedHash(sessionToken, config.pepper, 'session');
        const deviceHash = keyedHash(deviceBinding, config.pepper, 'device');
        await conn.execute(
          `INSERT INTO session
             (credential_id, session_token_hash, device_binding_hash, role, expires_at)
           VALUES (?, ?, ?, 'owner', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
          [credential.id, sessionHash, deviceHash, config.sessionTtlSeconds]
        );
        await recordAttempt(conn, credential.id, lookupHash, ipHash, true);
        return {
          value: {
            sessionToken,
            participantId: credential.participant_id,
            meetingId: credential.meeting_id,
            expiresInSeconds: config.sessionTtlSeconds,
            invalidatedPowerCount: powers.length,
          },
        };
      });
      if (outcome.error) {
        throw authError(outcome.error.code, outcome.error.message, outcome.error.retryAfterSeconds);
      }
      return outcome.value;
    },

    async verifySession({ sessionToken, deviceBinding }) {
      assertDeviceBinding(deviceBinding);
      const sessionHash = keyedHash(sessionToken, config.pepper, 'session');
      const deviceHash = keyedHash(deviceBinding, config.pepper, 'device');
      return withConnectionFn(async (conn) => {
        const [[session]] = await conn.execute(
          `SELECT c.participant_id, c.meeting_id
             FROM session s
             JOIN credential c ON c.id = s.credential_id
            WHERE s.session_token_hash = ?
              AND s.device_binding_hash = ?
              AND s.revoked_at IS NULL
              AND s.expires_at > UTC_TIMESTAMP(3)
              AND c.revoked_at IS NULL
            LIMIT 1`,
          [sessionHash, deviceHash]
        );
        if (!session) throw authError('SESSION_INVALID', 'session_invalid');
        await conn.execute(
          `UPDATE session SET last_seen_at = UTC_TIMESTAMP(3)
            WHERE session_token_hash = ?`,
          [sessionHash]
        );
        return { participantId: session.participant_id, meetingId: session.meeting_id };
      });
    },
  };
}

async function recordAttempt(conn, credentialId, lookupHash, ipHash, succeeded) {
  await conn.execute(
    `INSERT INTO authentication_attempt
       (credential_id, credential_lookup_hash, client_ip_hash, succeeded, attempted_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [credentialId, lookupHash, ipHash, succeeded ? 1 : 0]
  );
}

function assertDeviceBinding(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256) {
    throw authError('DEVICE_BINDING_REQUIRED', 'device_binding_required');
  }
}

function authError(code, message, retryAfterSeconds) {
  const error = new Error(message);
  error.code = code;
  if (retryAfterSeconds) error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function failure(code, message, retryAfterSeconds) {
  return { error: { code, message, retryAfterSeconds } };
}

function authenticationLocator(code) {
  try {
    return credentialLocator(code);
  } catch {
    // Ook misvormde invoer doorloopt dezelfde DB-gebaseerde IP-limiter en krijgt
    // dezelfde generieke authenticatiefout; zo ontstaat geen enumeratie-orakel.
    return `invalid:${String(code ?? '').slice(0, 480)}`;
  }
}
