"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { authClient } from "@/lib/auth-client.ts";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="grid gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          setFailed(false);
          const { error } = await authClient.signOut();
          if (error) {
            setPending(false);
            setFailed(true);
            return;
          }
          router.replace("/");
          router.refresh();
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm font-medium text-danger">
          We couldn&apos;t sign you out. Please try again.
        </p>
      ) : null}
    </div>
  );
}
