import type { EmailMessage } from "./senders.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function greeting(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `Hi ${trimmed},` : "Hi,";
}

function layout(paragraphs: string[], action: { label: string; url: string }): string {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(text)}</p>`)
    .join("");
  return [
    '<div style="font-family:Figtree,Arial,sans-serif;color:#18211D;max-width:520px">',
    body,
    `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1E5B43;color:#FFFFFF;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>`,
    `<p style="margin:0;color:#4F5A54;font-size:13px">Or paste this link into your browser: ${escapeHtml(action.url)}</p>`,
    "</div>",
  ].join("");
}

export function verificationEmail(input: {
  to: string;
  name: string;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  const lines = [
    greeting(input.name),
    "Confirm your email address to finish setting up your Nevile account.",
    `This link expires in ${input.expiresInMinutes} minutes. If you didn't sign up for Nevile, you can ignore this email.`,
  ];
  return {
    to: input.to,
    subject: "Confirm your email for Nevile",
    text: [...lines, "", `Confirm your email: ${input.url}`].join("\n"),
    html: layout(lines, { label: "Confirm email", url: input.url }),
  };
}

/**
 * Sent instead of a second verification email when someone signs up with an address that
 * already has an account. The sign-up response itself is identical either way, so the
 * form never reveals whether an address is registered.
 */
export function existingAccountEmail(input: {
  to: string;
  name: string;
  signInUrl: string;
}): EmailMessage {
  const lines = [
    greeting(input.name),
    "Someone tried to create a Nevile account with this email address, but you already have one.",
    "If that was you, sign in instead. If it wasn't, no action is needed: your account hasn't changed.",
  ];
  return {
    to: input.to,
    subject: "You already have a Nevile account",
    text: [...lines, "", `Sign in: ${input.signInUrl}`].join("\n"),
    html: layout(lines, { label: "Sign in", url: input.signInUrl }),
  };
}

export function otpSms(code: string, expiresInMinutes: number): string {
  return `${code} is your Nevile sign-in code. It expires in ${expiresInMinutes} minutes. Never share it with anyone.`;
}
