import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateMeetingQuorum,
  calculateVoteResult,
  formatWeight,
  parseWeight,
} from '../app/src/domain/vote-result.js';

test('DECIMAL(12,4)-gewichten worden zonder drijvende-kommafout geschaald', () => {
  assert.equal(parseWeight('0.1000') + parseWeight('0.2000'), parseWeight('0.3000'));
  assert.equal(formatWeight(parseWeight('12345678.9012')), '12345678.9012');
});

test('tweederdemeerderheid is groen exact op de grens en bevat geen rondquorum', () => {
  const result = calculateVoteResult([
    { choice: 'voor', weight: '2.0000' },
    { choice: 'tegen', weight: '1.0000' },
    { choice: 'onthouding', weight: '2.0000' },
  ], {
    majorityNumerator: 2,
    majorityDenominator: 3,
  });

  assert.equal(result.accountedWeight, '5.0000');
  assert.equal('quorum' in result, false);
  assert.equal('presentWeight' in result, false);
  assert.equal('eligibleWeight' in result, false);
  assert.equal(result.majority.met, true);
  assert.deepEqual(result.perChoiceWeight, {
    voor: '2.0000', tegen: '1.0000', blanco: '0.0000', onthouding: '2.0000',
  });
});

test('één tienduizendste onder de meerderheidsdrempel blijft exact rood', () => {
  const result = calculateVoteResult([
    { choice: 'voor', weight: '1.9999' },
    { choice: 'tegen', weight: '1.0001' },
    { choice: 'onthouding', weight: '1.9999' },
  ], {
    majorityNumerator: 2,
    majorityDenominator: 3,
  });

  assert.equal(result.majority.met, false);
});

test('vergaderingquorum gebruikt exacte presentiebasis en nul eligible is nooit groen', () => {
  assert.equal(calculateMeetingQuorum('5.0000', '10.0000', 1, 2).met, true);
  assert.equal(calculateMeetingQuorum('4.9999', '10.0000', 1, 2).met, false);
  assert.equal(calculateMeetingQuorum('0.0000', '0.0000', 1, 2).met, false);
});

test('blanco en onthouding blijven buiten de meerderheidsnoemer', () => {
  const result = calculateVoteResult([
    { choice: 'voor', weight: '2.0000' },
    { choice: 'tegen', weight: '1.0000' },
    { choice: 'blanco', weight: '90.0000' },
    { choice: 'onthouding', weight: '90.0000' },
  ], { majorityNumerator: 2, majorityDenominator: 3 });
  assert.equal(result.decisiveWeight, '3.0000');
  assert.equal(result.majority.met, true);
});

test('ongeldige of negatieve gewichten en onmogelijke ratio’s worden geweigerd', () => {
  for (const invalid of ['10.12345', '-1.0000', 'abc', null, undefined]) {
    assert.throws(() => parseWeight(invalid), TypeError);
  }
  assert.throws(() => formatWeight(-1n), TypeError);
  assert.throws(() => calculateMeetingQuorum('1.0000', '10.0000', 3, 2), RangeError);
});
