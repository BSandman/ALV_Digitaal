import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('schema bevat persistente auth-limits, apparaatbinding en onherstelbare machtigingsinvalidation', async () => {
  const schema = await readFile(path.join(root, 'infra/mysql/init/01-schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE authentication_attempt/);
  assert.match(schema, /session_token_hash BINARY\(32\)/);
  assert.match(schema, /device_binding_hash BINARY\(32\)/);
  assert.match(schema, /CREATE TABLE power_of_attorney/);
  assert.match(schema, /CREATE TRIGGER trg_power_of_attorney_irreversible/);
  assert.match(schema, /SIGNAL SQLSTATE '45000'/);
});

test('schema bevriest vergaderingquorum en automatische onthoudingen', async () => {
  const schema = await readFile(path.join(root, 'infra/mysql/init/01-schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE meeting_quorum \(/);
  assert.match(schema, /CREATE TABLE meeting_quorum_entitlement \(/);
  assert.match(schema, /meeting_quorum_is_frozen/);
  assert.match(schema, /CREATE TABLE round_automatic_abstention \(/);
  assert.match(schema, /automatic_abstention_is_immutable/);
  assert.doesNotMatch(schema, /motion[\s\S]{0,400}quorum_numerator/);
});

test('vaste sessie-sql_mode bevat NO_BACKSLASH_ESCAPES in app en T-configuratie', async () => {
  const pool = await readFile(path.join(root, 'app/src/db/pool.js'), 'utf8');
  const compose = await readFile(path.join(root, 'infra/docker-compose.yml'), 'utf8');
  assert.match(pool, /STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES/);
  assert.match(compose, /STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES/);
});

test('parametergebonden store-SQL gebruikt echte prepared statements', async () => {
  for (const relative of [
    'app/src/stores/mariadb/AuthStoreMariaDB.js',
    'app/src/stores/mariadb/MeetingStoreMariaDB.js',
    'app/src/stores/mariadb/VoteStoreMariaDB.js',
  ]) {
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /conn\.query\(/, `${relative} gebruikt tekstuele parameter-escaping.`);
    assert.match(source, /conn\.execute\(/);
  }
});
