"use client";

import { launchPostalCodeSchema, type OnboardingInput, type OnboardingIntent } from "@nevile/core";
import { useMutation } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { CheckIcon, categoryIconName, Icon, type IconName } from "@/components/ui/icons.tsx";
import { postalCodeError } from "@/lib/auth-client.ts";
import { cn } from "@/lib/cn.ts";
import { useTRPC } from "@/lib/trpc.ts";

type Category = { slug: string; name: string };

type WelcomeFlowProps = {
  firstName: string;
  categories: readonly Category[];
  initial: { intent: OnboardingIntent | null; postalCode: string; interests: readonly string[] };
};

const INTENTS: ReadonlyArray<{
  value: OnboardingIntent;
  title: string;
  body: string;
  icon: IconName;
}> = [
  {
    value: "customer",
    title: "I need help at home",
    body: "Find and book local pros for the yard, the snow and the house.",
    icon: "home",
  },
  {
    value: "business",
    title: "I run a business",
    body: "List your services and fill your calendar across Nova Scotia.",
    icon: "users",
  },
  {
    value: "both",
    title: "Both",
    body: "Book help for your own home and take bookings for your business.",
    icon: "sparkle",
  },
];

const STEP_TITLES = ["What brings you to Nevile?", "Where are you?", "What can we help with?"];
const STEP_COUNT = STEP_TITLES.length;

export function WelcomeFlow({ firstName, categories, initial }: WelcomeFlowProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const [step, setStep] = useState(0);
  const [intent, setIntent] = useState<OnboardingIntent | null>(initial.intent);
  const [postalCode, setPostalCode] = useState(initial.postalCode);
  const [postalProblem, setPostalProblem] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([...initial.interests]);
  const [intentProblem, setIntentProblem] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const save = useMutation(trpc.onboarding.save.mutationOptions());
  const skip = useMutation(trpc.onboarding.skip.mutationOptions());
  const busy = save.isPending || skip.isPending;

  // Move focus to the new step's heading so keyboard and screen-reader users follow along.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step change is the trigger.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function goNext(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (step === 0 && !intent) {
      setIntentProblem("Choose one to continue.");
      return;
    }
    if (step === 1) {
      const problem = postalCodeError(postalCode);
      if (problem) {
        setPostalProblem(problem);
        return;
      }
    }
    setStep((current) => Math.min(current + 1, STEP_COUNT - 1));
  }

  function destination(chosen: OnboardingIntent | null): Route {
    return (chosen === "business" ? "/account?intent=business" : "/") as Route;
  }

  async function finish() {
    if (!intent) return;
    try {
      await save.mutateAsync({
        intent,
        postalCode: launchPostalCodeSchema.parse(postalCode),
        interests: interests as OnboardingInput["interests"],
      });
      router.replace(destination(intent));
      router.refresh();
    } catch {
      // Shown below via save.error.
    }
  }

  async function skipAll() {
    try {
      await skip.mutateAsync();
    } catch {
      // Skipping is a convenience; go home regardless.
    }
    router.replace(destination(intent));
    router.refresh();
  }

  function toggleInterest(slug: string) {
    setInterests((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  }

  const isBusiness = intent === "business";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold tracking-[0.06em] text-season-ink uppercase">
          {firstName ? `Welcome, ${firstName}` : "Welcome to Nevile"}
        </p>
        <button
          type="button"
          onClick={skipAll}
          disabled={busy}
          className="min-h-11 cursor-pointer rounded-full px-3 text-[15px] font-semibold text-primary hover:bg-hover disabled:cursor-not-allowed disabled:text-muted"
        >
          Skip for now
        </button>
      </div>

      <div
        className="mt-3 flex gap-2"
        role="progressbar"
        aria-label="Welcome progress"
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={step + 1}
        aria-valuetext={`Step ${step + 1} of ${STEP_COUNT}`}
      >
        {STEP_TITLES.map((title, index) => (
          <span
            key={title}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-200",
              index <= step ? "bg-primary" : "bg-surface",
            )}
          />
        ))}
      </div>

      <form key={step} onSubmit={goNext} noValidate className="nv-rise mt-6">
        <p className="text-sm font-medium text-muted">
          Step {step + 1} of {STEP_COUNT}
        </p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-1 font-display text-[30px] leading-[1.1] font-extrabold tracking-[-0.03em] text-balance outline-none sm:text-[36px]"
        >
          {STEP_TITLES[step]}
        </h1>

        {step === 0 ? (
          <fieldset className="mt-5">
            <legend className="sr-only">Choose what describes you</legend>
            <div className="grid gap-3">
              {INTENTS.map((option) => {
                const selected = intent === option.value;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3.5 rounded-card border bg-surface px-4 py-4 shadow-card transition duration-150 active:scale-[0.99] motion-reduce:active:scale-100",
                      selected
                        ? "border-primary ring-2 ring-primary"
                        : "border-border hover:border-field",
                    )}
                  >
                    <input
                      type="radio"
                      name="intent"
                      value={option.value}
                      checked={selected}
                      onChange={() => {
                        setIntent(option.value);
                        setIntentProblem(null);
                      }}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="inline-flex size-11 flex-none items-center justify-center rounded-xl bg-season-tint text-season-ink"
                    >
                      <Icon name={option.icon} size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] font-semibold">{option.title}</span>
                      <span className="mt-0.5 block text-[15px] leading-snug text-muted">
                        {option.body}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1 inline-flex size-6 flex-none items-center justify-center rounded-full border-2",
                        selected ? "border-primary bg-primary text-on-primary" : "border-field",
                      )}
                    >
                      {selected ? <CheckIcon size={14} strokeWidth={2.5} /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {intentProblem ? (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                {intentProblem}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {step === 1 ? (
          <div className="mt-5 grid gap-3">
            <p className="text-[16px] leading-relaxed text-muted">
              {isBusiness
                ? "Where is your business based? You'll set your exact service area on a map when you list your services."
                : "We use your postal code to show pros who serve your street."}
            </p>
            <Field
              label="Postal code"
              hint="Nevile is only in Nova Scotia for now (postal codes start with B)."
              error={postalProblem ?? undefined}
            >
              <Input
                name="postalCode"
                autoComplete="postal-code"
                autoCapitalize="characters"
                placeholder="B3H 1A1"
                maxLength={7}
                value={postalCode}
                onChange={(event) => {
                  setPostalCode(event.target.value);
                  if (postalProblem) setPostalProblem(null);
                }}
                className="uppercase"
              />
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-5">
            <p className="text-[16px] leading-relaxed text-muted">
              {isBusiness
                ? "Which services do you offer? Pick any; you can change this later."
                : "Pick the services you're likely to need. We'll put them first."}
            </p>
            <ul className="mt-4 flex flex-wrap gap-2.5">
              {categories.map((category) => {
                const selected = interests.includes(category.slug);
                return (
                  <li key={category.slug}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleInterest(category.slug)}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] font-medium transition duration-150 active:scale-95 motion-reduce:active:scale-100",
                        selected
                          ? "border-primary bg-primary text-on-primary"
                          : "border-border bg-surface text-ink hover:border-field",
                      )}
                    >
                      {selected ? (
                        <CheckIcon size={16} strokeWidth={2.5} />
                      ) : (
                        <Icon name={categoryIconName(category.slug)} size={16} />
                      )}
                      {category.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {save.error ? (
          <p role="alert" className="mt-4 text-sm font-medium text-danger">
            We couldn&apos;t save that. Check your answers and try again.
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          {step > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => setStep((current) => current - 1)}
              disabled={busy}
            >
              Back
            </Button>
          ) : null}
          {step < STEP_COUNT - 1 ? (
            <Button type="submit" size="lg" className="min-w-36">
              Continue
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              onClick={finish}
              disabled={busy}
              aria-busy={save.isPending}
              className="min-w-36"
            >
              {save.isPending ? "Saving…" : "Finish"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
