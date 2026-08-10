import assert from 'node:assert/strict';
import test from 'node:test';
import { runTransactionWithRetry } from '../app/src/db/pool.js';

test('een InnoDB-deadlock rolt terug en herhaalt de volledige transactie', async () => {
  const events = [];
  let executions = 0;
  const conn = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
  };
  const result = await runTransactionWithRetry(conn, async () => {
    executions += 1;
    events.push(`execute-${executions}`);
    if (executions === 1) {
      const error = new Error('deadlock');
      error.code = 'ER_LOCK_DEADLOCK';
      throw error;
    }
    return 'green';
  });
  assert.equal(result, 'green');
  assert.deepEqual(events, ['begin', 'execute-1', 'rollback', 'begin', 'execute-2', 'commit']);
});

test('een niet-retrybare fout wordt eenmaal teruggedraaid en direct doorgegeven', async () => {
  let executions = 0;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
  };
  await assert.rejects(runTransactionWithRetry(conn, async () => {
    executions += 1;
    const error = new Error('invalid');
    error.code = 'ER_BAD_FIELD_ERROR';
    throw error;
  }), { code: 'ER_BAD_FIELD_ERROR' });
  assert.equal(executions, 1);
});
