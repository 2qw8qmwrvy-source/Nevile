/**
 * Off-platform leakage protection — SPEC §7 / §10: until a booking is paid, chat masks
 * phone numbers and email addresses.
 *
 * Phone detection targets North American numbers (+1 / NANP) in any common layout —
 * dashed, dotted, spaced, parenthesised, with or without a leading 1 / +1, or written
 * digit by digit with separators — plus any other international number written with a
 * leading "+". To avoid masking prices, times, dates, postal codes and quantities, a
 * group of digits may not straddle the area-code / exchange / line boundaries
 * ("2026-10-21 10" is a date and a time, not 202-610-2110). Seven-digit local numbers
 * are not masked: they are indistinguishable from ranges like "200-1500".
 *
 * Email detection covers normal addresses and common obfuscations such as
 * "jo (at) mail (dot) com" or "jo at mail dot ca" (the latter only for well-known TLDs).
 * Spelled-out digits ("four one six…") are not detected.
 */

export const CONTACT_MASK = "[hidden until booked]";

const LOCAL = "[a-z0-9_%+\\-](?:[a-z0-9._%+\\-]*[a-z0-9_%+\\-])?";
const LABEL = "[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?";
const KNOWN_TLD =
  "(?:com|ca|net|org|info|biz|io|co|me|us|uk|edu|gov|app|dev|xyz|live|email|online|ly|ai)";
const BRACKET_OPEN = "[\\(\\[\\{<]";
const BRACKET_CLOSE = "[\\)\\]\\}>]";
const AT = `(?:[ \\t]*[@＠][ \\t]*|[ \\t]*${BRACKET_OPEN}[ \\t]*at[ \\t]*${BRACKET_CLOSE}[ \\t]*|[ \\t]+at[ \\t]+)`;
const DOT = `(?:[ \\t]*\\.[ \\t]*|[ \\t]*${BRACKET_OPEN}[ \\t]*dot[ \\t]*${BRACKET_CLOSE}[ \\t]*|[ \\t]+dot[ \\t]+)`;

/** A standard address: any TLD, no spaces. */
const PLAIN_EMAIL = new RegExp(
  `(?<![a-z0-9._%+\\-])${LOCAL}[@＠]${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,63}(?![a-z0-9\\-])`,
  "gi",
);
/** Obfuscated / spaced address: only with a well-known TLD to limit false positives. */
const OBFUSCATED_EMAIL = new RegExp(
  `(?<![a-z0-9._%+\\-])${LOCAL}${AT}${LABEL}(?:${DOT}${LABEL})*${DOT}${KNOWN_TLD}(?![a-z0-9\\-])`,
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

function phoneSpansInChain(text: string, chainStart: number, chain: string): Span[] {
  const groups: DigitGroup[] = [];
  for (const match of chain.matchAll(DIGIT_RUN)) {
    const start = chainStart + match.index;
    groups.push({ start, end: start + match[0].length, digits: match[0] });
  }
  const spans: Span[] = [];
  const intlPrefixed =
    text[chainStart - 1] === "+" || text.slice(chainStart - 2, chainStart) === "+ ";
  let i = 0;
  while (i < groups.length) {
    let found = -1;
    let count = 0;
    for (let j = i; j < groups.length; j++) {
      count += groups[j]?.digits.length ?? 0;
      if (count > 11) break;
      if (count >= 10 && isNanpNumber(groups.slice(i, j + 1))) found = j;
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
    // "$4165551234" is a price, not a phone number.
    if (text[match.index - 1] === "$") continue;
    for (const span of phoneSpansInChain(text, match.index, match[0])) {
      spans.push(widen(text, span));
    }
  }
  let result = "";
  let cursor = 0;
  for (const span of spans) {
    result += text.slice(cursor, span.start) + CONTACT_MASK;
    cursor = span.end;
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
