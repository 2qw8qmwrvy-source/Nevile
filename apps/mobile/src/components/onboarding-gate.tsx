import { router, usePathname, useRootNavigationState } from "expo-router";
import { useEffect } from "react";

import { useMe } from "@/lib/me.ts";

// Once per app launch: closing the welcome with the system back gesture shouldn't make it
// pop up again until the next launch.
let shownThisLaunch = false;

/**
 * SPEC §16: the optional welcome opens after sign-up and again on the next launch until
 * it is finished or skipped. Renders nothing.
 */
export function OnboardingGate() {
  const { me } = useMe();
  const pathname = usePathname();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const pending = me.data ? !me.data.onboarding.completed : false;

  useEffect(() => {
    if (shownThisLaunch || !navigationReady || !pending) return;
    // Already there (straight after sign-up), or in the middle of signing in.
    if (pathname === "/welcome" || pathname.startsWith("/sign-")) {
      if (pathname === "/welcome") shownThisLaunch = true;
      return;
    }
    shownThisLaunch = true;
    router.push("/welcome");
  }, [navigationReady, pending, pathname]);

  return null;
}
