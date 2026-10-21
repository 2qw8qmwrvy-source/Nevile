"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { CloseIcon, MenuIcon } from "@/components/ui/icons.tsx";
import { cn } from "@/lib/cn.ts";
import { authRoutes } from "@/lib/routes.ts";
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
            aria-current={current ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full px-3.5 text-[15px] font-medium whitespace-nowrap text-ink no-underline hover:bg-hover hover:text-ink",
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

/** Phone-width menu: a disclosure button and a panel below the header. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

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
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-ink hover:bg-hover"
      >
        {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-y border-border bg-surface shadow-pop"
      >
        <nav aria-label="Main" className="mx-auto flex max-w-[1280px] flex-col px-4 py-3">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
              className="flex min-h-12 items-center rounded-input px-3 text-base font-medium text-ink no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-hover"
            >
              {item.label}
            </Link>
          ))}
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
        </nav>
      </div>
    </div>
  );
}
