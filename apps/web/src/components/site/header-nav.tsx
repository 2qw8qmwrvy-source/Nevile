"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { CloseIcon, MailIcon, MenuIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { authRoutes } from "@/lib/routes.ts";
import { useAuthState } from "@/lib/use-auth-state.ts";
import { mainNav } from "./nav-items.ts";

function isCurrent(pathname: string, href: string): boolean {
  return !href.includes("#") && pathname === href;
}

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="ml-5 hidden items-center gap-0.5 md:flex">
      {mainNav.map((item) => {
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            // Primary pages are cheap to render, so prefetch them fully for instant clicks.
            prefetch
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full px-3.5 text-[15px] font-medium whitespace-nowrap text-ink no-underline transition-colors duration-150 hover:bg-hover hover:text-ink",
              current && "bg-hover",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Inbox with an unread badge, refreshed every minute and when the tab comes back. */
function InboxButton() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check on navigation.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/inbox/unread", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : { count: 0 }))
        .then((data: { count?: number }) => {
          if (!cancelled) setCount(data.count ?? 0);
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [pathname]);
  return (
    <Button href="/inbox" variant="ghost" className="relative px-2.5 sm:px-4" prefetch>
      {/* A compact icon on phones, so the signed-in header still fits 360px screens. */}
      <MailIcon size={20} className="sm:hidden" />
      <span className="sr-only sm:not-sr-only">Inbox</span>
      {count > 0 ? (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs font-bold text-on-primary">
          <span className="sr-only">, unread: </span>
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Button>
  );
}

/** Sign in / Sign up, or Bookings, Inbox and Account for a signed-in visitor. */
export function HeaderAccount({ hasSessionCookie }: { hasSessionCookie: boolean }) {
  const { status } = useAuthState(hasSessionCookie);
  // With a session cookie the person is almost always signed in: show their links straight
  // away rather than a placeholder that resizes when the session is confirmed.
  if (status === "signed-in" || status === "unknown") {
    return (
      <>
        {/* Display classes go on a wrapper: Button's own inline-flex would override "hidden". */}
        <span className="hidden sm:inline-flex">
          <Button href="/bookings" variant="ghost" prefetch>
            Bookings
          </Button>
        </span>
        <InboxButton />
        {/* On phones Account lives in the menu, so the header keeps room to breathe. */}
        <span className="hidden sm:inline-flex">
          <Button href="/account" variant="secondary" prefetch>
            Account
          </Button>
        </span>
      </>
    );
  }
  return (
    <>
      <span className="hidden sm:inline-flex">
        <Button href={authRoutes.signIn} variant="ghost">
          Sign in
        </Button>
      </span>
      <Button href={authRoutes.signUp}>Sign up</Button>
    </>
  );
}

/** Phone-width menu: a disclosure button and a panel below the header. */
export function MobileMenu({ hasSessionCookie }: { hasSessionCookie: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { status } = useAuthState(hasSessionCookie);

  // Close whenever the route changes (including hash links on the same page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-ink transition duration-150 hover:bg-hover active:scale-95 motion-reduce:active:scale-100"
      >
        {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="nv-pop-in absolute inset-x-0 top-full border-y border-border bg-surface shadow-pop"
      >
        <nav aria-label="Main" className="mx-auto flex max-w-[1280px] flex-col px-4 py-3">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={() => setOpen(false)}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
              className="flex min-h-12 items-center rounded-input px-3 text-base font-medium text-ink no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-hover"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/neighbours"
            onClick={() => setOpen(false)}
            aria-current={pathname === "/neighbours" ? "page" : undefined}
            className="flex min-h-12 items-center rounded-input px-3 text-base font-medium text-ink no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-hover"
          >
            Nevile Neighbours
          </Link>
          {status === "signed-in" ? (
            <Link
              href="/bookings"
              onClick={() => setOpen(false)}
              aria-current={pathname === "/bookings" ? "page" : undefined}
              className="flex min-h-12 items-center rounded-input px-3 text-base font-medium text-ink no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-hover"
            >
              Your bookings
            </Link>
          ) : null}
          {status === "signed-in" ? (
            <Link
              href="/quotes"
              onClick={() => setOpen(false)}
              aria-current={pathname === "/quotes" ? "page" : undefined}
              className="flex min-h-12 items-center rounded-input px-3 text-base font-medium text-ink no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-hover"
            >
              Your quotes
            </Link>
          ) : null}
          {status === "signed-in" ? (
            <Link
              href="/account"
              onClick={() => setOpen(false)}
              aria-current={pathname === "/account" ? "page" : undefined}
              className="flex min-h-12 items-center rounded-input px-3 text-base font-medium text-ink no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-hover"
            >
              Your account
            </Link>
          ) : null}
          {status === "signed-out" ? (
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Button
                href={authRoutes.signIn}
                variant="secondary"
                block
                onClick={() => setOpen(false)}
              >
                Sign in
              </Button>
              <Button href={authRoutes.signUp} block onClick={() => setOpen(false)}>
                Sign up
              </Button>
            </div>
          ) : null}
        </nav>
      </div>
    </div>
  );
}
