import { router } from "expo-router";
import { useEffect } from "react";

/**
 * `nevile://payout-return`, the link at the end of payout setup started in the app. The
 * setup sheet usually catches it and closes itself; if the app opens it instead, go back to
 * where the business was (the payouts screen).
 */
export default function PayoutReturnRoute() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/business/payouts");
  }, []);
  return null;
}
