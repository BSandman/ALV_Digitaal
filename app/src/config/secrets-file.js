import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXED_SQL_MODE = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES';
const TARGETS = Object.freeze({
  acceptatie: Object.freeze({
    host: 'localhost',
    database: 'cn111993_acceptatie',
    user: 'cn111993_acceptatie',
  }),
  portaal: Object.freeze({
    host: 'localhost',
    database: 'cn111993_portaal',
    user: 'cn111993_portaal',
  }),
});
const ALLOWED_EXACT = new Set([
  'DEPLOY_TARGET',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_POOL_SIZE',
  'DB_SESSION_SQL_MODE',
  'AUTH_PEPPER',
  'TRUST_PROXY',
]);

/** Laadt het server-side secrets-bestand vóór de overige appmodules worden geïmporteerd. */
export async function loadRuntimeConfiguration({
  env = process.env,
  appRoot = APP_ROOT,
  platform = process.platform,
  readFileFn = readFile,
  realpathFn = realpath,
  statFn = stat,
} = {}) {
  const configuredPath = String(env.SECRETS_FILE ?? '').trim();
  if (!configuredPath) {
    if (env.NODE_ENV === 'production' || env.DEPLOY_TARGET) {
      throw configError('SECRETS_FILE_REQUIRED', 'SECRETS_FILE is verplicht buiten development/test.');
    }
    return { loaded: false, target: null };
  }
  if (!path.isAbsolute(configuredPath)) {
    throw configError('SECRETS_FILE_PATH_INVALID', 'SECRETS_FILE moet een absoluut pad zijn.');
  }

  const [resolvedFile, resolvedAppRoot] = await Promise.all([
    realpathFn(configuredPath),
    realpathFn(appRoot),
  ]);
  if (isWithin(resolvedAppRoot, resolvedFile)) {
    throw configError('SECRETS_FILE_INSIDE_APP', 'SECRETS_FILE moet buiten de application root/webroot staan.');
  }
  assertSecurePermissions(await statFn(resolvedFile), platform);

  const raw = await readFileFn(resolvedFile, 'utf8');
  if (Buffer.byteLength(raw) > 64 * 1024 || raw.includes('\0')) {
    throw configError('SECRETS_FILE_INVALID', 'Secrets-bestand is ongeldig of te groot.');
  }
  const parsed = parseSecretsFile(raw);
  for (const [key, value] of Object.entries(parsed)) env[key] = value;
  env.NODE_ENV = 'production';
  env.DB_SESSION_SQL_MODE ||= FIXED_SQL_MODE;
  validateRuntimeConfiguration(env);
  return { loaded: true, target: env.DEPLOY_TARGET, path: resolvedFile };
}

export function parseSecretsFile(content) {
  const values = {};
  for (const [index, originalLine] of String(content).replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw configError('SECRETS_FILE_INVALID', `Ongeldige regel ${index + 1} in secrets-bestand.`);
    const [, key, rawValue] = match;
    if (!isAllowedKey(key)) throw configError('SECRETS_KEY_FORBIDDEN', `Niet-toegestane secretsleutel: ${key}.`);
    if (Object.hasOwn(values, key)) throw configError('SECRETS_KEY_DUPLICATE', `Dubbele secretsleutel: ${key}.`);
    values[key] = parseValue(rawValue, index + 1);
  }
  return values;
}

export function validateRuntimeConfiguration(env) {
  const expected = TARGETS[env.DEPLOY_TARGET];
  if (!expected) throw configError('DEPLOY_TARGET_INVALID', 'DEPLOY_TARGET moet acceptatie of portaal zijn.');
  const requiredValues = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'AUTH_PEPPER', 'TRUST_PROXY'];
  for (const key of requiredValues) {
    if (typeof env[key] !== 'string' || env[key].trim() === '') {
      throw configError('RUNTIME_CONFIG_MISSING', `${key} ontbreekt in het secrets-bestand.`);
    }
  }
  if (env.DB_HOST !== expected.host || env.DB_NAME !== expected.database || env.DB_USER !== expected.user) {
    throw configError('DATABASE_TARGET_MISMATCH', `Databasecoördinaten horen niet bij ${env.DEPLOY_TARGET}.`);
  }
  if (Buffer.byteLength(env.AUTH_PEPPER) < 32) {
    throw configError('AUTH_PEPPER_INVALID', 'AUTH_PEPPER moet minimaal 32 bytes zijn.');
  }
  if (env.TRUST_PROXY !== '1') {
    throw configError('TRUST_PROXY_INVALID', 'TRUST_PROXY moet 1 zijn achter de gecontroleerde LiteSpeed-proxy.');
  }
  if (env.DB_SESSION_SQL_MODE !== FIXED_SQL_MODE) {
    throw configError('SQL_MODE_INVALID', 'DB_SESSION_SQL_MODE mag de vaste strict mode niet afzwakken.');
  }
  assertIntegerRange(env.DB_PORT ?? '3306', 1, 65535, 'DB_PORT');
  assertIntegerRange(env.DB_POOL_SIZE ?? '5', 1, 10, 'DB_POOL_SIZE');
}

export function assertSecurePermissions(fileStat, platform = process.platform) {
  if (!fileStat?.isFile?.()) throw configError('SECRETS_FILE_INVALID', 'SECRETS_FILE is geen regulier bestand.');
  if (platform !== 'win32' && (fileStat.mode & 0o077) !== 0) {
    throw configError('SECRETS_FILE_PERMISSIONS', 'SECRETS_FILE moet alleen door de eigenaar leesbaar/schrijfbaar zijn (chmod 600 of strenger).');
  }
}

function isAllowedKey(key) {
  return ALLOWED_EXACT.has(key) || /^SMTP_[A-Z0-9_]+$/.test(key) || /^ADMIN_[A-Z0-9_]+$/.test(key);
}

function parseValue(rawValue, lineNumber) {
  const value = rawValue.trim();
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw configError('SECRETS_FILE_INVALID', `Ongesloten quote op regel ${lineNumber}.`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw configError('SECRETS_FILE_INVALID', `Ongesloten quote op regel ${lineNumber}.`);
    return value.slice(1, -1).replace(/\\([\\"nrt])/g, (_, escaped) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' })[escaped]);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertIntegerRange(value, minimum, maximum, field) {
  if (!/^\d+$/.test(String(value))) throw configError('RUNTIME_CONFIG_INVALID', `${field} moet een geheel getal zijn.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw configError('RUNTIME_CONFIG_INVALID', `${field} valt buiten het toegestane bereik.`);
  }
}

function configError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
