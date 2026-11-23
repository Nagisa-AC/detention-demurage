"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { publishResults } from "./publish-results";

export function PublishButton({
  customerId,
  state,
}: {
  customerId: string;
  state: "none" | "ready" | "published";
}) {
  const [confirming, setConfirming] = useState(false);
  if (state === "published") {
    return (
      <button id="publish-to-customer" type="button" className="btn" disabled>
        Published
      </button>
    );
  }
  if (!confirming) {
    return (
      <button
        id="publish-to-customer"
        type="button"
        className="btn"
        disabled={state !== "ready"}
        onClick={() => setConfirming(true)}
      >
        Publish to customer
      </button>
    );
  }
  return (
    <form action={publishResults}>
      <input type="hidden" name="customerId" value={customerId} />
      <PublishControl />
    </form>
  );
}

function PublishControl() {
  const { pending } = useFormStatus();
  return (
    <button
      id="publish-confirm"
      type="submit"
      className="btn"
      disabled={pending}
      aria-busy={pending}
      title="The customer will see these findings."
    >
      {pending ? "Publishing…" : "Publish now"}
    </button>
  );
}
