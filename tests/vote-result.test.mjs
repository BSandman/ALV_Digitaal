import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateVoteResult, formatWeight, parseWeight } from '../app/src/domain/vote-result.js';

test('DECIMAL(12,4)-gewichten worden zonder drijvende-kommafout geschaald', () => {
  assert.equal(parseWeight('0.1000') + parseWeight('0.2000'), parseWeight('0.3000'));
  assert.equal(formatWeight(parseWeight('12345678.9012')), '12345678.9012');
});

test('quorum en tweederdemeerderheid zijn groen exact op de grens', () => {
  const result = calculateVoteResult([
    { choice: 'voor', weight: '2.0000' },
    { choice: 'tegen', weight: '1.0000' },
    { choice: 'onthouding', weight: '2.0000' },
  ], {
    eligibleWeight: '10.0000',
    quorumNumerator: 1,
    quorumDenominator: 2,
    majorityNumerator: 2,
    majorityDenominator: 3,
  });

  assert.equal(result.presentWeight, '5.0000');
  assert.equal(result.quorum.met, true);
  assert.equal(result.majority.met, true);
  assert.deepEqual(result.perChoiceWeight, {
    voor: '2.0000', tegen: '1.0000', blanco: '0.0000', onthouding: '2.0000',
  });
});

test('één tienduizendste onder een drempel blijft exact rood', () => {
  const result = calculateVoteResult([
    { choice: 'voor', weight: '1.9999' },
    { choice: 'tegen', weight: '1.0001' },
    { choice: 'onthouding', weight: '1.9999' },
  ], {
    eligibleWeight: '10.0000',
    quorumNumerator: 1,
    quorumDenominator: 2,
    majorityNumerator: 2,
    majorityDenominator: 3,
  });

  assert.equal(result.quorum.met, false);
  assert.equal(result.majority.met, false);
});
