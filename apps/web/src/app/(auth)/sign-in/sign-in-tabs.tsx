"use client";

import { type KeyboardEvent, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn.ts";
import { EmailSignInForm } from "./email-sign-in-form.tsx";
import { PhoneSignInForm } from "./phone-sign-in-form.tsx";

export type SignInMethod = "email" | "phone";

const TABS: ReadonlyArray<{ id: SignInMethod; label: string }> = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone code" },
];

/** WAI-ARIA tabs: arrow keys move between tabs, only the selected tab is a tab stop. */
export function SignInTabs({ initialMethod, next }: { initialMethod: SignInMethod; next: string }) {
  const [method, setMethod] = useState<SignInMethod>(initialMethod);
  const baseId = useId();
  const tabRefs = useRef<Record<SignInMethod, HTMLButtonElement | null>>({
    email: null,
    phone: null,
  });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((tab) => tab.id === method);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    const target = nextIndex === null ? undefined : TABS[nextIndex];
    if (!target) return;
    event.preventDefault();
    setMethod(target.id);
    tabRefs.current[target.id]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Sign-in method"
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-1 rounded-full bg-ground p-1"
      >
        {TABS.map((tab) => {
          const selected = tab.id === method;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setMethod(tab.id)}
              className={cn(
                "min-h-11 cursor-pointer rounded-full px-4 text-[15px] font-semibold transition-colors",
                selected ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== method}
          className="pt-5"
        >
          {tab.id === method ? (
            tab.id === "email" ? (
              <EmailSignInForm next={next} />
            ) : (
              <PhoneSignInForm next={next} />
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}
