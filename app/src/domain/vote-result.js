const SCALE_DIGITS = 4;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const CHOICES = ['voor', 'tegen', 'blanco', 'onthouding'];

/** Zet een MariaDB DECIMAL(12,4)-waarde verliesvrij om naar gehele 1/10.000-eenheden. */
export function parseWeight(value) {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new TypeError(`Ongeldig stemgewicht: ${text}`);
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(SCALE_DIGITS, '0'));
}

/** Zet interne gehele eenheden terug naar een canonieke DECIMAL(12,4)-tekst. */
export function formatWeight(units) {
  if (typeof units !== 'bigint' || units < 0n) throw new TypeError('Gewichtseenheden moeten een niet-negatieve bigint zijn.');
  const whole = units / SCALE;
  const fraction = String(units % SCALE).padStart(SCALE_DIGITS, '0');
  return `${whole}.${fraction}`;
}

/**
 * Geïsoleerde VvE-rekenkern. Alle vergelijkingen zijn integervermenigvuldigingen;
 * er komt nergens IEEE-754-drijvende-kommarekenkunde aan te pas (ADR-0008 §3).
 */
export function calculateVoteResult(rows, {
  majorityNumerator,
  majorityDenominator,
}) {
  const totals = Object.fromEntries(CHOICES.map((choice) => [choice, 0n]));
  for (const row of rows) {
    if (!CHOICES.includes(row.choice)) throw new TypeError(`Ongeldige stemkeuze: ${row.choice}`);
    totals[row.choice] += parseWeight(row.weight);
  }

  const accounted = CHOICES.reduce((sum, choice) => sum + totals[choice], 0n);
  const decisive = totals.voor + totals.tegen;
  const majority = normalizeRatio(majorityNumerator, majorityDenominator, 'meerderheid');

  return {
    perChoiceWeight: Object.fromEntries(CHOICES.map((choice) => [choice, formatWeight(totals[choice])])),
    accountedWeight: formatWeight(accounted),
    decisiveWeight: formatWeight(decisive),
    count: rows.length,
    majority: {
      numerator: majority.numerator,
      denominator: majority.denominator,
      met: decisive > 0n && totals.voor * majority.denominatorBig >= decisive * majority.numeratorBig,
    },
  };
}

/** Bepaal éénmalig de vergadering-brede quorumvlag uit de bevroren presentiebasis. */
export function calculateMeetingQuorum(basisWeight, eligibleWeight, numerator, denominator) {
  const basis = parseWeight(basisWeight);
  const eligible = parseWeight(eligibleWeight);
  const quorum = normalizeRatio(numerator, denominator, 'quorum');
  return {
    basisWeight: formatWeight(basis),
    eligibleWeight: formatWeight(eligible),
    numerator: quorum.numerator,
    denominator: quorum.denominator,
    met: eligible > 0n && basis * quorum.denominatorBig >= eligible * quorum.numeratorBig,
  };
}

function normalizeRatio(numerator, denominator, label) {
  const numeratorBig = toPositiveBigInt(numerator, `${label}teller`);
  const denominatorBig = toPositiveBigInt(denominator, `${label}noemer`);
  if (numeratorBig > denominatorBig) throw new RangeError(`${label}teller mag niet groter zijn dan de noemer.`);
  return {
    numerator: Number(numeratorBig),
    denominator: Number(denominatorBig),
    numeratorBig,
    denominatorBig,
  };
}

function toPositiveBigInt(value, label) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw new TypeError(`${label} moet een positief geheel getal zijn.`);
  return BigInt(text);
}
