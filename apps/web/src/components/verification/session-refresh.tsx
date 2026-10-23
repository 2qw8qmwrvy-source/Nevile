"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client.ts";

/**
 * Asks the browser's session store to refetch once, e.g. right after the email was
 * confirmed, so the header and the confirmation banner update without a reload.
 */
export function SessionRefresh() {
  useEffect(() => {
    authClient.$store.notify("$sessionSignal");
  }, []);
  return null;
}
