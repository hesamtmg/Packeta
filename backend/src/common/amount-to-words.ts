// Spells out a currency amount's major-unit value in words, in either
// English or Farsi — mirrors frontend/src/utils/number-to-words.ts so the
// server can bake a words caption into displayAmount for surfaces (like the
// sandbox IPG) that don't have a live currency table of their own to
// recompute it from.

const EN_ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function enHundreds(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${EN_ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    const tens = EN_TENS[Math.floor(n / 10)];
    const ones = n % 10;
    parts.push(ones ? `${tens}-${EN_ONES[ones]}` : tens);
  } else if (n > 0) {
    parts.push(EN_ONES[n]);
  }
  return parts.join(' ');
}

function integerToEnglishWords(n: number): string {
  if (n === 0) return 'zero';
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const group = n % 1000;
    if (group > 0) {
      groups.unshift(
        `${enHundreds(group)}${EN_SCALES[scale] ? ` ${EN_SCALES[scale]}` : ''}`,
      );
    }
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return groups.join(' ');
}

const FA_ONES = [
  '',
  'یک',
  'دو',
  'سه',
  'چهار',
  'پنج',
  'شش',
  'هفت',
  'هشت',
  'نه',
  'ده',
  'یازده',
  'دوازده',
  'سیزده',
  'چهارده',
  'پانزده',
  'شانزده',
  'هفده',
  'هجده',
  'نوزده',
];
const FA_TENS = [
  '',
  '',
  'بیست',
  'سی',
  'چهل',
  'پنجاه',
  'شصت',
  'هفتاد',
  'هشتاد',
  'نود',
];
const FA_HUNDREDS = [
  '',
  'صد',
  'دویست',
  'سیصد',
  'چهارصد',
  'پانصد',
  'ششصد',
  'هفتصد',
  'هشتصد',
  'نهصد',
];
const FA_SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'بیلیون'];

function faHundreds(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(FA_HUNDREDS[Math.floor(n / 100)]);
    n %= 100;
  }
  if (n >= 20) {
    const tens = FA_TENS[Math.floor(n / 10)];
    const ones = n % 10;
    parts.push(ones ? `${tens} و ${FA_ONES[ones]}` : tens);
  } else if (n > 0) {
    parts.push(FA_ONES[n]);
  }
  return parts.join(' و ');
}

function integerToFarsiWords(n: number): string {
  if (n === 0) return 'صفر';
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const group = n % 1000;
    if (group > 0) {
      const words = faHundreds(group);
      groups.unshift(FA_SCALES[scale] ? `${words} ${FA_SCALES[scale]}` : words);
    }
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return groups.join(' و ');
}

// `value` is the already-scaled major-unit amount (e.g. 1200000, or 12.5 for
// a currency with 2 decimal places).
export function amountToWords(value: number, locale: 'en' | 'fa'): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  // Fractional part rounded to 2 places is enough for every currency this
  // app supports (decimalPlaces is 0 or 2).
  const fraction = Math.round((abs - whole) * 100);

  if (locale === 'fa') {
    let words = integerToFarsiWords(whole);
    if (fraction > 0) words += ` و ${integerToFarsiWords(fraction)} صدم`;
    return negative ? `منفی ${words}` : words;
  }

  let words = integerToEnglishWords(whole);
  if (fraction > 0) words += ` and ${integerToEnglishWords(fraction)}/100`;
  return negative ? `negative ${words}` : words;
}
