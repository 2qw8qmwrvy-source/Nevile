"use client";

import { type InputHTMLAttributes, useState } from "react";
import { Input } from "@/components/ui/field.tsx";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** Password field with a show/hide toggle. Field (the parent) supplies id and ARIA wiring. */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-[4.5rem]" />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-1.5 inline-flex min-h-9 -translate-y-1/2 cursor-pointer items-center rounded-lg px-2.5 text-sm font-semibold text-primary hover:bg-hover"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
