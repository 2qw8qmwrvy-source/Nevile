"use client";

import type { AppRouter, inferRouterOutputs } from "@nevile/api";
import {
  ARRIVAL_WINDOW_LIMITS,
  addCalendarDays,
  DEFAULT_ARRIVAL_WINDOWS,
  formatArrivalWindow,
  formatMinuteOfDay,
  fromLocal,
  parseIsoDate,
} from "@nevile/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/app/(auth)/_components/form-alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Input, Label, Select } from "@/components/ui/field.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useTRPC } from "@/lib/trpc.ts";

type Role = "owner" | "manager" | "crew";
type Member = inferRouterOutputs<AppRouter>["team"]["members"][number];
type Hours = Member["hours"][number];

/** Monday first, the way most crews plan a week. */
const WEEKDAYS = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 0, label: "Sunday" },
] as const;

const step = ARRIVAL_WINDOW_LIMITS.stepMinutes;
const range = (from: number, to: number) =>
  Array.from({ length: (to - from) / step + 1 }, (_, index) => from + index * step);
/** 5 am to 11 pm for working hours; windows stay within 6 am to 9 pm. */
const HOUR_CHOICES = range(300, 1380);
const WINDOW_CHOICES = range(
  ARRIVAL_WINDOW_LIMITS.earliestMinute,
  ARRIVAL_WINDOW_LIMITS.latestMinute,
);

const dateLabel = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function MinuteSelect({
  id,
  value,
  choices,
  onChange,
  label,
}: {
  id: string;
  value: number;
  choices: readonly number[];
  onChange: (minute: number) => void;
  label: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Select
        id={id}
        value={value}
        className="h-11"
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {choices.map((minute) => (
          <option key={minute} value={minute}>
            {formatMinuteOfDay(minute)}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Weekly hours: which days someone works, and from when to when. */
function HoursEditor({
  member,
  businessId,
  onSaved,
}: {
  member: Member;
  businessId: string;
  onSaved: () => void;
}) {
  const trpc = useTRPC();
  const [hours, setHours] = useState<Map<number, Hours>>(
    () => new Map(member.hours.map((span) => [span.weekday, span])),
  );
  const [saved, setSaved] = useState(false);
  const save = useMutation(
    trpc.team.setHours.mutationOptions({
      onSuccess: () => {
        setSaved(true);
        onSaved();
      },
    }),
  );
  const update = (weekday: number, span: Hours | null) => {
    setSaved(false);
    setHours((current) => {
      const next = new Map(current);
      if (span) next.set(weekday, span);
      else next.delete(weekday);
      return next;
    });
  };
  return (
    <form
      method="post"
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ businessId, memberId: member.id, hours: [...hours.values()] });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Working hours</legend>
        {WEEKDAYS.map(({ weekday, label }) => {
          const span = hours.get(weekday);
          const prefix = `hours-${member.id}-${weekday}`;
          return (
            <div
              key={weekday}
              className="grid grid-cols-[8.5rem_1fr] items-center gap-2 sm:grid-cols-[9rem_1fr_1fr]"
            >
              <label className="flex min-h-11 items-center gap-2 text-[15px]">
                <input
                  type="checkbox"
                  className="size-5 accent-(--color-primary)"
                  checked={Boolean(span)}
                  onChange={(event) =>
                    update(
                      weekday,
                      event.target.checked ? { weekday, startMinute: 480, endMinute: 1020 } : null,
                    )
                  }
                />
                {label}
              </label>
              {span ? (
                <div className="col-span-1 grid grid-cols-2 gap-2 sm:col-span-2">
                  <MinuteSelect
                    id={`${prefix}-start`}
                    label={`${label} start`}
                    value={span.startMinute}
                    choices={HOUR_CHOICES}
                    onChange={(startMinute) => update(weekday, { ...span, startMinute })}
                  />
                  <MinuteSelect
                    id={`${prefix}-end`}
                    label={`${label} end`}
                    value={span.endMinute}
                    choices={HOUR_CHOICES}
                    onChange={(endMinute) => update(weekday, { ...span, endMinute })}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted sm:col-span-2">Off</span>
              )}
            </div>
          );
        })}
      </fieldset>
      {save.error ? <FormAlert tone="error">{save.error.message}</FormAlert> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save hours
        </Button>
        {saved ? (
          <p role="status" className="text-sm text-muted">
            Hours saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Days off (whole days in the business's time zone). */
function TimeOffEditor({
  member,
  businessId,
  timeZone,
  onSaved,
}: {
  member: Member;
  businessId: string;
  timeZone: string;
  onSaved: () => void;
}) {
  const trpc = useTRPC();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = useMutation(
    trpc.team.addTimeOff.mutationOptions({
      onSuccess: () => {
        setFrom("");
        setTo("");
        setReason("");
        onSaved();
      },
    }),
  );
  const remove = useMutation(trpc.team.removeTimeOff.mutationOptions({ onSuccess: onSaved }));
  const prefix = `off-${member.id}`;
  return (
    <div className="grid gap-2">
      <h4 className="text-sm font-semibold">Time off</h4>
      {member.timeOff.length === 0 ? (
        <p className="text-sm text-muted">No time off booked.</p>
      ) : (
        <ul className="grid gap-1.5">
          {member.timeOff.map((block) => (
            <li
              key={block.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-input bg-ground px-3 py-2 text-sm"
            >
              <span>
                {dateLabel.format(block.startsAt)} to{" "}
                {dateLabel.format(new Date(block.endsAt.getTime() - 1))}
                {block.reason ? ` · ${block.reason}` : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ businessId, timeOffId: block.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        method="post"
        className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const first = parseIsoDate(from);
          const last = parseIsoDate(to || from);
          if (!first || !last) {
            setProblem("Pick the first and last day off.");
            return;
          }
          setProblem(null);
          add.mutate({
            businessId,
            memberId: member.id,
            startsAt: fromLocal(first, timeZone),
            endsAt: fromLocal(addCalendarDays(last, 1), timeZone),
            reason: reason || undefined,
          });
        }}
      >
        <div>
          <Label htmlFor={`${prefix}-from`}>First day off</Label>
          <Input
            id={`${prefix}-from`}
            type="date"
            value={from}
            className="h-11"
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-to`}>Last day off</Label>
          <Input
            id={`${prefix}-to`}
            type="date"
            value={to}
            min={from || undefined}
            className="h-11"
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${prefix}-reason`}>Note (optional)</Label>
          <Input
            id={`${prefix}-reason`}
            value={reason}
            maxLength={120}
            className="h-11"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          className="h-11"
          disabled={add.isPending}
        >
          Add time off
        </Button>
      </form>
      {problem || add.error || remove.error ? (
        <FormAlert tone="error">{problem ?? add.error?.message ?? remove.error?.message}</FormAlert>
      ) : null}
    </div>
  );
}

function MemberCard({
  member,
  businessId,
  role,
  timeZone,
  onChanged,
}: {
  member: Member;
  businessId: string;
  role: Role;
  timeZone: string;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [confirming, setConfirming] = useState(false);
  const deactivate = useMutation(trpc.team.deactivate.mutationOptions({ onSuccess: onChanged }));
  const canEdit = role !== "crew" || member.isYou;
  const canRemove =
    !member.isYou &&
    member.role !== "owner" &&
    (role === "owner" || (role === "manager" && member.role === "crew"));
  return (
    <Card as="li" aria-label={member.name} padding="sm" className="grid gap-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[17px] font-semibold">
            {member.name}{" "}
            {member.isYou ? <span className="font-normal text-muted">(you)</span> : null}
          </h3>
          {member.email ? <p className="text-sm text-muted">{member.email}</p> : null}
        </div>
        <Badge>{member.roleLabel}</Badge>
      </div>
      {canEdit ? (
        <>
          <HoursEditor member={member} businessId={businessId} onSaved={onChanged} />
          <TimeOffEditor
            member={member}
            businessId={businessId}
            timeZone={timeZone}
            onSaved={onChanged}
          />
        </>
      ) : (
        <p className="text-sm text-muted">
          {member.hours.length === 0
            ? "No working hours set."
            : `Works ${member.hours.length} ${member.hours.length === 1 ? "day" : "days"} a week.`}
        </p>
      )}
      {canRemove ? (
        confirming ? (
          <div className="nv-pop-in grid gap-2 rounded-input bg-ground p-3">
            <p className="text-sm">
              Remove {member.name} from the team? Their upcoming jobs go back to unassigned.
            </p>
            {deactivate.error ? (
              <FormAlert tone="error">{deactivate.error.message}</FormAlert>
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-danger hover:bg-danger"
                disabled={deactivate.isPending}
                onClick={() => deactivate.mutate({ businessId, memberId: member.id })}
              >
                Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger hover:text-danger"
              onClick={() => setConfirming(true)}
            >
              Remove from team
            </Button>
          </div>
        )
      ) : null}
    </Card>
  );
}

function Invites({ businessId, role }: { businessId: string; role: Role }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invites = useQuery(trpc.team.invites.queryOptions({ businessId }));
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"crew" | "manager">("crew");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.team.invites.queryKey({ businessId }) });
  const invite = useMutation(
    trpc.team.invite.mutationOptions({
      onSuccess: () => {
        setSentTo(email);
        setEmail("");
        return refresh();
      },
    }),
  );
  const revoke = useMutation(trpc.team.revokeInvite.mutationOptions({ onSuccess: refresh }));
  return (
    <Card as="section" aria-labelledby="invite-title">
      <h2 id="invite-title" className="font-display text-[22px] font-bold">
        Invite your crew
      </h2>
      <p className="mt-1 text-[15px] text-muted">
        We email them a link that works for 7 days. They join with that email address.
      </p>
      <form
        method="post"
        className="mt-4 grid gap-3 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSentTo(null);
          invite.mutate({ businessId, email, role: inviteRole });
        }}
      >
        <div>
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="invite-role">Role</Label>
          <Select
            id="invite-role"
            value={inviteRole}
            onChange={(event) =>
              setInviteRole(event.target.value === "manager" ? "manager" : "crew")
            }
          >
            <option value="crew">Crew</option>
            {role === "owner" ? <option value="manager">Manager</option> : null}
          </Select>
        </div>
        <Button type="submit" disabled={invite.isPending}>
          Send invite
        </Button>
      </form>
      {invite.error ? (
        <FormAlert tone="error" className="mt-3">
          {invite.error.message}
        </FormAlert>
      ) : sentTo ? (
        <FormAlert tone="success" className="mt-3">
          Invite sent to {sentTo}.
        </FormAlert>
      ) : null}
      {invites.data && invites.data.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold">Waiting to join</h3>
          <ul className="mt-2 grid gap-1.5">
            {invites.data.map((pending) => (
              <li
                key={pending.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-input bg-ground px-3 py-2 text-sm"
              >
                <span>
                  {pending.email} · {pending.roleLabel} · link works until{" "}
                  {dateLabel.format(pending.expiresAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ businessId, inviteId: pending.id })}
                >
                  Cancel invite
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

type Window = { startMinute: number; endMinute: number };

/** Arrival windows and how soon / how far ahead customers can book. */
function BookingSettings({ businessId, canEdit }: { businessId: string; canEdit: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const settings = useQuery(trpc.team.settings.queryOptions({ businessId }));
  const [draft, setDraft] = useState<{
    windows: Window[];
    minNoticeDays: number;
    maxDaysAhead: number;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation(
    trpc.team.updateSettings.mutationOptions({
      onSuccess: async () => {
        setSaved(true);
        setDraft(null);
        await queryClient.invalidateQueries({
          queryKey: trpc.team.settings.queryKey({ businessId }),
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.businessBookings.calendar.queryKey(),
        });
      },
    }),
  );
  if (settings.isPending) return <Skeleton className="h-64" />;
  if (settings.isError) return <FormAlert tone="error">{settings.error.message}</FormAlert>;
  const { limits } = settings.data;
  const current = draft ?? {
    windows: settings.data.windows.map(({ startMinute, endMinute }) => ({
      startMinute,
      endMinute,
    })),
    minNoticeDays: settings.data.minNoticeDays,
    maxDaysAhead: settings.data.maxDaysAhead,
  };
  const change = (next: Partial<typeof current>) => {
    setSaved(false);
    setDraft({ ...current, ...next });
  };
  const setWindow = (index: number, window: Window) =>
    change({ windows: current.windows.map((existing, at) => (at === index ? window : existing)) });
  const noticeChoices = Array.from(
    { length: limits.minNoticeDays.max - limits.minNoticeDays.min + 1 },
    (_, index) => limits.minNoticeDays.min + index,
  );

  return (
    <Card as="section" aria-labelledby="windows-title">
      <h2 id="windows-title" className="font-display text-[22px] font-bold">
        Booking windows
      </h2>
      <p className="mt-1 text-[15px] text-muted">
        Customers pick an arrival window, not an exact time. A job longer than its window carries on
        into the next one.
      </p>
      {canEdit ? (
        <form
          method="post"
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ businessId, ...current });
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">Arrival windows</legend>
            {current.windows.map((window, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position.
                key={index}
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
              >
                <MinuteSelect
                  id={`window-${index}-start`}
                  label={`Window ${index + 1} starts`}
                  value={window.startMinute}
                  choices={WINDOW_CHOICES}
                  onChange={(startMinute) => setWindow(index, { ...window, startMinute })}
                />
                <MinuteSelect
                  id={`window-${index}-end`}
                  label={`Window ${index + 1} ends`}
                  value={window.endMinute}
                  choices={WINDOW_CHOICES}
                  onChange={(endMinute) => setWindow(index, { ...window, endMinute })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove window ${index + 1}`}
                  disabled={current.windows.length === 1}
                  onClick={() =>
                    change({ windows: current.windows.filter((_, at) => at !== index) })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {current.windows.length < ARRIVAL_WINDOW_LIMITS.maxWindows ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const last = current.windows.at(-1);
                    const startMinute = Math.min(
                      last?.endMinute ?? 480,
                      ARRIVAL_WINDOW_LIMITS.latestMinute - 60,
                    );
                    change({
                      windows: [
                        ...current.windows,
                        {
                          startMinute,
                          endMinute: Math.min(
                            startMinute + 180,
                            ARRIVAL_WINDOW_LIMITS.latestMinute,
                          ),
                        },
                      ],
                    });
                  }}
                >
                  Add a window
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => change({ windows: DEFAULT_ARRIVAL_WINDOWS.map((w) => ({ ...w })) })}
              >
                Use the usual windows ({DEFAULT_ARRIVAL_WINDOWS.map(formatArrivalWindow).join(", ")}
                )
              </Button>
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="min-notice">Earliest booking</Label>
              <Select
                id="min-notice"
                value={current.minNoticeDays}
                onChange={(event) => change({ minNoticeDays: Number(event.target.value) })}
              >
                {noticeChoices.map((days) => (
                  <option key={days} value={days}>
                    {days === 0
                      ? "Same day (2 hours' notice)"
                      : days === 1
                        ? "Next day"
                        : `${days} days ahead`}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="max-ahead">Latest booking (days ahead)</Label>
              <Input
                id="max-ahead"
                type="number"
                inputMode="numeric"
                min={limits.maxDaysAhead.min}
                max={limits.maxDaysAhead.max}
                value={current.maxDaysAhead}
                onChange={(event) => change({ maxDaysAhead: Number(event.target.value) })}
              />
            </div>
          </div>
          {save.error ? <FormAlert tone="error">{save.error.message}</FormAlert> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending || !draft}>
              Save booking windows
            </Button>
            {saved ? (
              <p role="status" className="text-sm text-muted">
                Saved. New bookings use these windows.
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-[15px]">
          {settings.data.windows.map((window) => window.label).join(", ")}
        </p>
      )}
    </Card>
  );
}

/** The team page: everyone's hours and time off, invites and booking windows. */
export function TeamView({ businessId, role }: { businessId: string; role: Role }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const members = useQuery(trpc.team.members.queryOptions({ businessId }));
  const settings = useQuery(trpc.team.settings.queryOptions({ businessId }));
  const canManage = role !== "crew";
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.team.members.queryKey({ businessId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.businessBookings.calendar.queryKey() }),
    ]);
  const active = members.data?.filter((member) => member.active) ?? [];
  const visible = canManage ? active : active.filter((member) => member.isYou);

  return (
    <div className="grid gap-6">
      <section aria-labelledby="team-title">
        <h2 id="team-title" className="font-display text-[22px] font-bold">
          {canManage ? "Your team" : "Your hours"}
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          Customers can book a window when someone is working and has time free. Time off blocks
          those days.
        </p>
        {members.isPending || settings.isPending ? (
          <Skeleton className="mt-4 h-72" />
        ) : members.isError ? (
          <FormAlert tone="error" className="mt-4">
            {members.error.message}
          </FormAlert>
        ) : (
          <ul className="mt-4 grid gap-4">
            {visible.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                businessId={businessId}
                role={role}
                timeZone={settings.data?.timezone ?? "America/Halifax"}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </section>
      {canManage ? <Invites businessId={businessId} role={role} /> : null}
      <BookingSettings businessId={businessId} canEdit={canManage} />
    </div>
  );
}
