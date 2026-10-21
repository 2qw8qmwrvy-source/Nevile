"use client";

import { UsersIcon } from "@/components/ui/icons.tsx";
import { SEASON_JOBS } from "./season-content.ts";
import { useSeason } from "./season-scope.tsx";

type Kind = "A" | "B" | "C" | "";

const CREW: ReadonlyArray<{ name: string; avatar: string; cells: readonly Kind[] }> = [
  { name: "Sam", avatar: "#1E5B43", cells: ["A", "", "B", "A", ""] },
  { name: "Priya", avatar: "#4F5A54", cells: ["B", "A", "", "", "C"] },
  { name: "Luc", avatar: "#2D6A9F", cells: ["", "C", "", "B", "A"] },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

const kindStyle: Record<Exclude<Kind, "">, { index: 0 | 1 | 2; className: string }> = {
  A: { index: 0, className: "bg-season-tint border-season-tint" },
  B: { index: 1, className: "bg-subtle border-subtle" },
  C: { index: 2, className: "bg-surface border-[#CDD3C8]" },
};

/** Decorative example of a crew calendar for the business band. Not real bookings. */
export function CrewCalendarPreview() {
  const { season } = useSeason();
  const { jobs, times } = SEASON_JOBS[season];
  return (
    <figure className="m-0 min-w-0 rounded-card bg-surface p-4.5 text-ink shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <figcaption className="min-w-0">
          <span className="block text-xs font-semibold tracking-[0.06em] text-muted uppercase">
            Example crew calendar
          </span>
          <span className="mt-0.5 block font-display text-[17px] leading-snug font-semibold">
            Your week, by crew member
          </span>
        </figcaption>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-ground px-2.5 text-xs font-semibold">
          <UsersIcon size={14} />3 crew
        </span>
      </div>
      <div className="mt-3.5 overflow-x-auto" aria-hidden="true">
        <div className="grid min-w-[380px] gap-1.5">
          <div className="grid grid-cols-[60px_repeat(5,minmax(0,1fr))] gap-1.5">
            <span />
            {DAYS.map((day) => (
              <span key={day} className="text-center text-xs font-semibold text-muted">
                {day}
              </span>
            ))}
          </div>
          {CREW.map((member) => (
            <div
              key={member.name}
              className="grid grid-cols-[60px_repeat(5,minmax(0,1fr))] gap-1.5"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="inline-flex size-5.5 flex-none items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ backgroundColor: member.avatar }}
                >
                  {member.name.charAt(0)}
                </span>
                <span className="truncate text-[13px] font-semibold">{member.name}</span>
              </div>
              {member.cells.map((kind, day) => (
                <div key={DAYS[day]} className="h-[46px] rounded-[10px] bg-ground p-[3px]">
                  {kind ? (
                    <div
                      className={`h-full overflow-hidden rounded-lg border px-1.5 py-1 text-xs leading-tight transition-colors duration-300 ${kindStyle[kind].className}`}
                    >
                      <span className="block font-semibold whitespace-nowrap">
                        {jobs[kindStyle[kind].index]}
                      </span>
                      <span className="block text-muted">{times[kindStyle[kind].index]}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3.5 rounded-input border border-border bg-ground px-3 py-2.5 text-sm leading-snug">
        <strong>New bookings land here automatically.</strong> Assign each job to a crew member in
        one tap.
      </p>
    </figure>
  );
}
