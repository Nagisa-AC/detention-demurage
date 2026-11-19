"use client";

import { useFormStatus } from "react-dom";
import { rerunChecks } from "./rerun-checks";

export function RerunForm({ customerId }: { customerId: string }) {
  return (
    <form action={rerunChecks}>
      <input type="hidden" name="customerId" value={customerId} />
      <RerunButton />
    </form>
  );
}

function RerunButton() {
  const { pending } = useFormStatus();
  return (
    <button id="run-checks" type="submit" className="btn" disabled={pending} aria-busy={pending}>
      {pending ? "Running…" : "Run checks"}
    </button>
  );
}
