import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_BYTES = 32;

/** Genereert het niet-raadbare codedeel met 128 bits entropie. */
export function generateCredentialCode(visiblePrefix) {
  const prefix = String(visiblePrefix ?? '').trim();
  if (!/^[A-Za-z0-9]{1,32}$/.test(prefix)) throw new TypeError('Ongeldig zichtbaar codevoorvoegsel.');
  return `${prefix}-${randomBytes(16).toString('base64url')}`;
}

/** Het zichtbare eerste segment identificeert de credential; het geheime deel verifieert hem. */
export function credentialLocator(code) {
  assertSecret(code, 'toegangscode');
  const separator = code.indexOf('-');
  const locator = separator > 0 ? code.slice(0, separator) : '';
  if (!/^[A-Za-z0-9]{1,32}$/.test(locator)) throw new TypeError('Ongeldige toegangscodevorm.');
  return locator;
}

/** Langzame server-side hash voor verificatie; de leesbare code wordt nooit opgeslagen. */
export async function hashCredentialCode(code, salt = randomBytes(16)) {
  assertSecret(code, 'toegangscode');
  const derived = await scrypt(code, salt, SCRYPT_KEY_BYTES);
  return Buffer.from(`scrypt-v1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`);
}

export async function verifyCredentialCode(code, storedHash) {
  assertSecret(code, 'toegangscode');
  const [version, saltText, hashText] = Buffer.from(storedHash).toString('utf8').split('$');
  if (version !== 'scrypt-v1' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = Buffer.from(await scrypt(code, Buffer.from(saltText, 'base64url'), expected.length));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Snelle keyed hash voor lookup/limiting; AUTH_PEPPER blijft buiten database en release. */
export function keyedHash(value, pepper, purpose) {
  assertSecret(value, purpose);
  assertPepper(pepper);
  return createHmac('sha256', pepper).update(`${purpose}\0${value}`).digest();
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function assertSecret(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw new TypeError(`${label} ontbreekt of heeft een ongeldige lengte.`);
  }
}

function assertPepper(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) < 32) {
    throw new TypeError('AUTH_PEPPER moet minimaal 32 bytes zijn.');
  }
}
