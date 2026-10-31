/**
 * Off-platform leakage protection — SPEC §7 / §10: until a booking is paid, chat masks
 * phone numbers and email addresses.
 *
 * Phone detection targets North American numbers (+1 / NANP) in any common layout —
 * dashed, dotted, spaced, parenthesised, with or without a leading 1 / +1, or written
 * digit by digit with separators — plus any other international number written with a
 * leading "+". To avoid masking prices, times, dates, postal codes and quantities, the
 * separators must follow the number's area-code / exchange / line structure
 * ("2026-10-21 10" is a date and a time, not 202-610-2110). A dollar amount right after
 * "$" (up to 7 digits, plus cents) is a price and is never part of a phone number, but
 * anything written after the price is still checked ("$120. 416-555-1234" is masked).
 * A bare 3-3-4 split whose parts are ascending multiples of 25 ("450 / 600 / 1200") is
 * read as a price list. Seven-digit local numbers are not masked: they are
 * indistinguishable from ranges like "200-1500".
 *
 * Email detection covers normal addresses and common obfuscations such as
 * "jo (at) mail (dot) com", "jo [@] mail.com" or "jo dot smith at mail dot ca" (the
 * obfuscated forms only for well-known TLDs). With the bare word "at", a literal "."
 * must not be followed by a space, so sentences like "Arriving at noon. Email me" are
 * left alone. Spelled-out digits ("four one six…") are not detected.
 */

export const CONTACT_MASK = "[hidden until booked]";

const LOCAL = "[a-z0-9_%+\\-](?:[a-z0-9._%+\\-]*[a-z0-9_%+\\-])?";
const LABEL = "[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?";
const KNOWN_TLD =
  "(?:com|ca|net|org|info|biz|io|co|me|us|uk|edu|gov|app|dev|xyz|live|email|online|ly|ai)";
const BRACKET_OPEN = "[\\(\\[\\{<]";
const BRACKET_CLOSE = "[\\)\\]\\}>]";
/** "@" (optionally spaced) or a bracketed "at" / "@": unambiguous at-signs. */
const AT_SYMBOL = `(?:[ \\t]*[@＠][ \\t]*|[ \\t]*${BRACKET_OPEN}[ \\t]*(?:at|[@＠])[ \\t]*${BRACKET_CLOSE}[ \\t]*)`;
/** The bare word "at", which is also ordinary English. */
const AT_WORD = "[ \\t]+at[ \\t]+";
const DOT_WORD = `(?:[ \\t]*${BRACKET_OPEN}[ \\t]*dot[ \\t]*${BRACKET_CLOSE}[ \\t]*|[ \\t]+dot[ \\t]+)`;
/**
 * A literal "." either hugs the next label ("example.com", "example .com") or has
 * space before it ("example . com"); "noon. Email" is the end of a sentence.
 */
const DOT = `(?:[ \\t]+\\.[ \\t]*|\\.|${DOT_WORD})`;
const OBFUSCATED_LOCAL = `${LOCAL}(?:${DOT_WORD}${LOCAL})*`;
const OBFUSCATED_DOMAIN = `${LABEL}(?:${DOT}${LABEL})*${DOT}${KNOWN_TLD}`;

/** A standard address: any TLD, no spaces. */
const PLAIN_EMAIL = new RegExp(
  `(?<![a-z0-9._%+\\-])${LOCAL}[@＠]${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,63}(?![a-z0-9\\-])`,
  "gi",
);
/** Obfuscated / spaced address: only with a well-known TLD to limit false positives. */
const OBFUSCATED_EMAIL = new RegExp(
  `(?<![a-z0-9._%+\\-])${OBFUSCATED_LOCAL}(?:${AT_SYMBOL}|${AT_WORD})${OBFUSCATED_DOMAIN}(?![a-z0-9\\-])`,
  "gi",
);

/** Characters allowed between digits of one number, at most three in a row. */
const SEPARATOR = "[ \\t\\u00a0.\\-\\u2010-\\u2015\\u2212/\\\\_*~|()\\[\\]]";
const DIGIT_CHAIN = new RegExp(`\\d(?:${SEPARATOR}{0,3}\\d)*`, "g");
const DIGIT_RUN = /\d+/g;

type DigitGroup = { start: number; end: number; digits: string };

function isNanpLeading(digit: string | undefined): boolean {
  return digit !== undefined && digit >= "2" && digit <= "9";
}

/**
 * Whether consecutive digit groups form a NANP number: 10 digits, or 11 starting with 1.
 * The separators must follow the number's structure: either every cut falls on a
 * segment boundary (4165551234, 416 5551234, 416-555-1234) or every segment boundary is
 * a cut, with extra cuts allowed inside segments (4 1 6 5 5 5 1 2 3 4, 416 555 12 34).
 * Dates and times such as "2026-10-21 10" (cuts at 4, 6, 8) fit neither.
 */
function isNanpNumber(groups: readonly DigitGroup[]): boolean {
  const digits = groups.map((group) => group.digits).join("");
  let required: readonly number[];
  let optional: readonly number[];
  let offset: number;
  if (digits.length === 10) {
    required = [3, 6];
    optional = [];
    offset = 0;
  } else if (digits.length === 11 && digits[0] === "1") {
    required = [4, 7];
    optional = [1];
    offset = 1;
  } else {
    return false;
  }
  if (!isNanpLeading(digits[offset]) || !isNanpLeading(digits[offset + 3])) return false;
  const cuts: number[] = [];
  let position = 0;
  for (const group of groups.slice(0, -1)) {
    position += group.digits.length;
    cuts.push(position);
  }
  const coarse = cuts.every((cut) => required.includes(cut) || optional.includes(cut));
  const fine = required.every((boundary) => cuts.includes(boundary));
  return coarse || fine;
}

type Span = { start: number; end: number };

/** The longest dollar amount (in whole dollars) read as a price after "$": $9,999,999. */
const MAX_PRICE_DIGITS = 7;

/**
 * How many leading digit groups of a chain that follows "$" are the price: the dollars,
 * plus the cents when written as ".5" / ".50". A ten-digit "$4165551234" is not a price.
 */
function priceGroupCount(text: string, groups: readonly DigitGroup[]): number {
  const [dollars, cents] = groups;
  if (!dollars || dollars.digits.length > MAX_PRICE_DIGITS) return 0;
  if (cents && cents.digits.length <= 2 && text.slice(dollars.end, cents.start) === ".") {
    return 2;
  }
  return 1;
}

/**
 * "450 / 600 / 1200", "350-450-1100": three ascending round amounts in a 3-3-4 split
 * are a price list, not a phone number. Real numbers almost never look like this, and
 * nobody can pick their number to match.
 */
function isPriceLadder(groups: readonly DigitGroup[]): boolean {
  if (groups.length !== 3) return false;
  const values = groups.map((group) => Number(group.digits));
  const lengths = groups.map((group) => group.digits.length).join("-");
  return (
    lengths === "3-3-4" &&
    values.every((value) => value % 25 === 0) &&
    (values[0] ?? 0) < (values[1] ?? 0) &&
    (values[1] ?? 0) < (values[2] ?? 0)
  );
}

function phoneSpansInChain(text: string, chainStart: number, chain: string): Span[] {
  const groups: DigitGroup[] = [];
  for (const match of chain.matchAll(DIGIT_RUN)) {
    const start = chainStart + match.index;
    groups.push({ start, end: start + match[0].length, digits: match[0] });
  }
  const spans: Span[] = [];
  const intlPrefixed =
    text[chainStart - 1] === "+" || text.slice(chainStart - 2, chainStart) === "+ ";
  // "$120. 416-555-1234": the price is never part of a number, but what follows it is.
  const firstCandidate = text[chainStart - 1] === "$" ? priceGroupCount(text, groups) : 0;
  let i = firstCandidate;
  while (i < groups.length) {
    let found = -1;
    let count = 0;
    for (let j = i; j < groups.length; j++) {
      count += groups[j]?.digits.length ?? 0;
      if (count > 11) break;
      const candidate = groups.slice(i, j + 1);
      if (count >= 10 && isNanpNumber(candidate) && !isBarePriceLadder(text, candidate)) {
        found = j;
      }
    }
    if (found === -1 && i === 0 && intlPrefixed) {
      // "+44 20 7946 0958": any 8–15 digit number written after a "+".
      const total = groups.reduce((n, group) => n + group.digits.length, 0);
      if (total >= 8 && total <= 15) found = groups.length - 1;
    }
    const first = groups[i];
    const last = groups[found];
    if (first && last) {
      spans.push({ start: first.start, end: last.end });
      i = found + 1;
    } else {
      i++;
    }
  }
  return spans;
}

/** A price ladder written with nothing that marks it as a phone number ("+", "("). */
function isBarePriceLadder(text: string, groups: readonly DigitGroup[]): boolean {
  const first = groups[0];
  if (!first || !isPriceLadder(groups)) return false;
  const before = text.slice(Math.max(0, first.start - 2), first.start);
  return !/[+(]\s?$/.test(before);
}

const PHONE_PREFIX = /(?:\+ ?)?(?:\( ?)?$/;

/** Widens a phone span to swallow a leading "+", "(" or "+ (" and a matching ")". */
function widen(text: string, span: Span): Span {
  const prefix = PHONE_PREFIX.exec(text.slice(Math.max(0, span.start - 4), span.start));
  const start = span.start - (prefix?.[0].length ?? 0);
  let end = span.end;
  const inner = text.slice(start, end);
  const unclosed = inner.split("(").length - inner.split(")").length;
  if (unclosed > 0 && text[end] === ")") end++;
  return { start, end };
}

function maskPhones(text: string): string {
  const spans: Span[] = [];
  for (const match of text.matchAll(DIGIT_CHAIN)) {
    for (const span of phoneSpansInChain(text, match.index, match[0])) {
      spans.push(widen(text, span));
    }
  }
  let result = "";
  let cursor = 0;
  for (const span of spans) {
    result += text.slice(cursor, Math.max(cursor, span.start)) + CONTACT_MASK;
    cursor = Math.max(cursor, span.end);
  }
  return result + text.slice(cursor);
}

function maskEmails(text: string): string {
  return text.replace(PLAIN_EMAIL, CONTACT_MASK).replace(OBFUSCATED_EMAIL, CONTACT_MASK);
}

/** Replaces phone numbers and email addresses with "[hidden until booked]". */
export function maskContactInfo(text: string): string {
  return maskPhones(maskEmails(text));
}

/** True when `text` contains something `maskContactInfo` would hide. */
export function containsContactInfo(text: string): boolean {
  return maskContactInfo(text) !== text;
}
