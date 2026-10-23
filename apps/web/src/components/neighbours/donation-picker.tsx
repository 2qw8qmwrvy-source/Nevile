"use client";

import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  DONATION_PRESETS_CENTS,
  type DonationChoice,
  donationBreakdown,
  donationChoiceSchema,
  formatCad,
  resolveDonation,
  roundUpDonationCents,
} from "@nevile/core";
import { useId, useState } from "react";
import { HeartIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";

type DonationPickerProps = {
  /** What the booking itself costs (job + service fee + tax), before any donation. */
  orderTotalCents: number;
  value: DonationChoice;
  onChange: (choice: DonationChoice) => void;
  /** Disables the controls, e.g. while the program is switched off. */
  disabled?: boolean;
  className?: string;
};

type OptionKey = "round_up" | `preset-${number}` | "custom";

function keyOf(choice: DonationChoice): OptionKey | null {
  if (choice.kind === "round_up") return "round_up";
  if (choice.kind === "preset") return `preset-${choice.amountCents}`;
  if (choice.kind === "custom") return "custom";
  return null;
}

/** "12.5" → 1250 cents; null when it isn't a plain dollar amount. */
function parseDollars(text: string): number | null {
  const match = /^\s*\$?\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/**
 * Optional Nevile Neighbours donation at checkout (SPEC §15): round up, $2, $5 or a custom
 * amount. Nothing is pre-selected, and pressing the chosen option again removes it. The
 * card fee (2.9%) comes out of the donation and is shown before paying.
 */
export function DonationPicker({
  orderTotalCents,
  value,
  onChange,
  disabled = false,
  className,
}: DonationPickerProps) {
  const groupId = useId();
  const [customText, setCustomText] = useState(
    value.kind === "custom" ? (value.amountCents / 100).toFixed(2) : "",
  );
  const [customError, setCustomError] = useState<string | null>(null);
  const selected = keyOf(value);
  const roundUp = roundUpDonationCents(orderTotalCents);
  const resolved = resolveDonationSafely(value, orderTotalCents);
  const breakdown = resolved > 0 ? donationBreakdown(resolved) : null;

  function toggle(key: OptionKey, choice: DonationChoice) {
    setCustomError(null);
    onChange(selected === key ? { kind: "none" } : choice);
  }

  function applyCustom(text: string) {
    setCustomText(text);
    const cents = parseDollars(text);
    const parsed =
      cents === null
        ? null
        : donationChoiceSchema.safeParse({ kind: "custom", amountCents: cents });
    if (!parsed?.success) {
      setCustomError(
        `Enter an amount from ${formatCad(DONATION_MIN_CENTS)} to ${formatCad(DONATION_MAX_CENTS)}.`,
      );
      return;
    }
    setCustomError(null);
    onChange(parsed.data);
  }

  const options: ReadonlyArray<{ key: OptionKey; label: string; choice: DonationChoice }> = [
    {
      key: "round_up",
      label: `Round up to ${formatCad(orderTotalCents + roundUp)}`,
      choice: { kind: "round_up" },
    },
    ...DONATION_PRESETS_CENTS.map((amount) => ({
      key: `preset-${amount}` as OptionKey,
      label: `Add ${formatCad(amount).replace(".00", "")}`,
      choice: { kind: "preset", amountCents: amount } as DonationChoice,
    })),
  ];

  return (
    <fieldset
      disabled={disabled}
      className={cn("rounded-card border border-border bg-surface p-4", className)}
      aria-describedby={`${groupId}-summary`}
    >
      <legend className="sr-only">Donate to Nevile Neighbours (optional)</legend>
      <p className="flex items-start gap-2.5 text-[15px] leading-snug">
        <HeartIcon size={20} className="mt-px flex-none text-season-ink" />
        <span>
          <strong className="font-semibold">Help a neighbour (optional).</strong>{" "}
          <span className="text-muted">
            Donations help Nova Scotians who can&apos;t keep up with their homes.
          </span>
        </span>
      </p>
      <div className="mt-3.5 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected === option.key}
            onClick={() => toggle(option.key, option.choice)}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[15px] font-medium transition duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:active:scale-100",
              selected === option.key
                ? "border-primary bg-primary text-on-primary"
                : "border-border bg-surface text-ink hover:border-field",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={selected === "custom"}
          aria-expanded={selected === "custom"}
          aria-controls={`${groupId}-custom`}
          onClick={() => {
            if (selected === "custom") {
              toggle("custom", { kind: "none" });
              return;
            }
            const cents = parseDollars(customText);
            onChange(
              cents !== null && cents >= DONATION_MIN_CENTS && cents <= DONATION_MAX_CENTS
                ? { kind: "custom", amountCents: cents }
                : { kind: "custom", amountCents: DONATION_MIN_CENTS },
            );
            if (!customText) setCustomText((DONATION_MIN_CENTS / 100).toFixed(2));
          }}
          className={cn(
            "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[15px] font-medium transition duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:active:scale-100",
            selected === "custom"
              ? "border-primary bg-primary text-on-primary"
              : "border-border bg-surface text-ink hover:border-field",
          )}
        >
          Other amount
        </button>
      </div>
      {selected === "custom" ? (
        <div id={`${groupId}-custom`} className="nv-pop-in mt-3 max-w-[220px]">
          <label htmlFor={`${groupId}-amount`} className="mb-1.5 block text-[13px] font-semibold">
            Amount (CAD)
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
            >
              $
            </span>
            <input
              id={`${groupId}-amount`}
              inputMode="decimal"
              value={customText}
              onChange={(event) => applyCustom(event.target.value)}
              aria-invalid={customError ? true : undefined}
              aria-describedby={customError ? `${groupId}-amount-error` : undefined}
              className="block h-12 w-full rounded-input border border-field bg-surface pr-3.5 pl-7 text-[15px] text-ink focus:border-primary aria-invalid:border-danger"
            />
          </div>
          {customError ? (
            <p id={`${groupId}-amount-error`} className="mt-1.5 text-sm font-medium text-danger">
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}
      <p id={`${groupId}-summary`} role="status" className="mt-3 text-sm leading-snug text-muted">
        {breakdown
          ? `${formatCad(breakdown.netCents)} goes to the fund after a ${formatCad(breakdown.feeCents)} card fee.`
          : "No donation added."}
      </p>
    </fieldset>
  );
}

function resolveDonationSafely(choice: DonationChoice, orderTotalCents: number): number {
  try {
    return resolveDonation(choice, orderTotalCents).amountCents;
  } catch {
    return 0;
  }
}
