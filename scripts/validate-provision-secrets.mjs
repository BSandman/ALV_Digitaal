#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseSecretsFile } from '../app/src/config/secrets-file.js';

const ALLOWED_KEYS = Object.freeze([
  'AUTH_PEPPER',
  'DB_HOST',
  'DB_NAME',
  'DB_PASSWORD',
  'DB_PORT',
  'DB_USER',
  'DEPLOY_TARGET',
  'TRUST_PROXY',
]);

const TARGETS = Object.freeze({
  acceptatie: Object.freeze({ database: 'cn111993_acceptatie', user: 'cn111993_acceptatie' }),
  portaal: Object.freeze({ database: 'cn111993_portaal', user: 'cn111993_portaal' }),
});

const [sourcePath, target] = process.argv.slice(2);
if (!sourcePath || !TARGETS[target] || process.argv.length !== 4) {
  console.error('Gebruik: node scripts/validate-provision-secrets.mjs <bron.env> <acceptatie|portaal>');
  process.exit(2);
}

try {
  const raw = await readFile(sourcePath, 'utf8');
  if (Buffer.byteLength(raw) > 64 * 1024 || raw.includes('\0')) {
    throw new Error('bronbestand is ongeldig of groter dan 64 KiB');
  }
  const parsed = parseSecretsFile(raw);
  const actualKeys = Object.keys(parsed).sort();
  if (actualKeys.join('\n') !== ALLOWED_KEYS.join('\n')) {
    throw new Error(`verwacht exact deze sleutels: ${ALLOWED_KEYS.join(', ')}`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (value.length === 0 || /[\0\r\n]/.test(value)) {
      throw new Error(`${key} moet een niet-lege waarde zonder besturingstekens hebben`);
    }
  }

  const expected = TARGETS[target];
  if (parsed.DEPLOY_TARGET !== target) throw new Error('DEPLOY_TARGET hoort niet bij het doel');
  if (parsed.DB_HOST !== 'localhost') throw new Error('DB_HOST moet localhost zijn');
  if (parsed.DB_PORT !== '3306') throw new Error('DB_PORT moet 3306 zijn');
  if (parsed.DB_NAME !== expected.database || parsed.DB_USER !== expected.user) {
    throw new Error(`DB_NAME en DB_USER horen niet bij ${target}`);
  }
  if (Buffer.byteLength(parsed.AUTH_PEPPER) < 32) {
    throw new Error('AUTH_PEPPER moet minimaal 32 UTF-8-bytes zijn');
  }
  if (parsed.TRUST_PROXY !== '1') throw new Error('TRUST_PROXY moet 1 zijn');

  console.log(`Provisioning-secrets: GROEN — target=${target}, exact ${ALLOWED_KEYS.length} sleutels`);
} catch (error) {
  console.error(`Provisioning-secrets: ROOD — ${error.message}`);
  process.exit(1);
}
