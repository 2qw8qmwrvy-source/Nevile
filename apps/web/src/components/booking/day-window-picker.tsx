"use client";

import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/cn.ts";

export type PickerDay = {
  date: string;
  windows: ReadonlyArray<{ startMinute: number; label: string; available: boolean }>;
};

const dayName = new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" });
const dayNumber = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
export const longDay = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
/** Calendar dates are shown as-is (they're already local days), so format them in UTC. */
export const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

type DayWindowPickerProps = {
  title: string;
  hint: string;
  days: readonly PickerDay[] | undefined;
  loading: boolean;
  error: string | null;
  date: string | null;
  windowStart: number | null;
  onDate: (date: string) => void;
  onWindow: (startMinute: number) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onPage: (by: number) => void;
};

/** A week of days and their arrival windows, with full ones disabled (SPEC §19). */
export function DayWindowPicker(props: DayWindowPickerProps) {
  const { days, date, windowStart } = props;
  const day = days?.find((candidate) => candidate.date === date) ?? null;
  return (
    <Card as="section" aria-labelledby="when-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="when-title" className="font-display text-[20px] font-bold">
          {props.title}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.canGoBack}
            onClick={() => props.onPage(-1)}
          >
            Earlier
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.canGoForward}
            onClick={() => props.onPage(1)}
          >
            Later
          </Button>
        </div>
      </div>
      <p className="mt-1 text-[15px] text-muted">{props.hint}</p>
      {props.loading ? (
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders.
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : props.error ? (
        <FormAlert tone="error" className="mt-4">
          {props.error}
        </FormAlert>
      ) : (
        <>
          <fieldset className="mt-4">
            <legend className="sr-only">Day</legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {days?.map((candidate) => {
                const open = candidate.windows.some((window) => window.available);
                const selected = candidate.date === date;
                return (
                  <button
                    key={candidate.date}
                    type="button"
                    disabled={!open}
                    aria-pressed={selected}
                    onClick={() => props.onDate(candidate.date)}
                    className={cn(
                      "flex min-h-16 flex-col items-center justify-center rounded-input border text-center transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                      selected
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border bg-surface hover:border-field",
                    )}
                  >
                    <span className="text-xs font-semibold uppercase">
                      {dayName.format(asDate(candidate.date))}
                    </span>
                    <span className="text-[15px] font-semibold">
                      {dayNumber.format(asDate(candidate.date))}
                    </span>
                    <span className="sr-only">{open ? "" : " (full)"}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {day ? (
            <fieldset className="mt-5">
              <legend className="mb-2 text-[15px] font-semibold">
                {longDay.format(asDate(day.date))}
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {day.windows.map((window) => (
                  <label
                    key={window.startMinute}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-input border px-3.5 py-2 text-[15px] font-semibold transition-colors",
                      !window.available && "cursor-not-allowed opacity-45",
                      windowStart === window.startMinute
                        ? "border-primary bg-primary-soft"
                        : "border-border hover:border-field",
                    )}
                  >
                    <input
                      type="radio"
                      name="window"
                      value={window.startMinute}
                      disabled={!window.available}
                      checked={windowStart === window.startMinute}
                      onChange={() => props.onWindow(window.startMinute)}
                      className="size-4 accent-primary"
                    />
                    {window.label}
                    {window.available ? null : (
                      <span className="ml-auto text-sm font-medium text-muted">Full</span>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : days && !days.some((candidate) => candidate.windows.some((w) => w.available)) ? (
            <p className="mt-4 text-[15px] text-muted">Nothing open these days. Try later dates.</p>
          ) : null}
        </>
      )}
    </Card>
  );
}
