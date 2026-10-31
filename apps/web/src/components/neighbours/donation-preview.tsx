"use client";

import type { DonationChoice } from "@nevile/core";
import { useState } from "react";
import { DonationPicker } from "./donation-picker.tsx";

/** A working preview of the checkout donation step, on an example $73.21 booking. */
export function DonationPreview({ orderTotalCents }: { orderTotalCents: number }) {
  const [choice, setChoice] = useState<DonationChoice>({ kind: "none" });
  return <DonationPicker orderTotalCents={orderTotalCents} value={choice} onChange={setChoice} />;
}
