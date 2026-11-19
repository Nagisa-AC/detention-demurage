"use client";

import { useActionState } from "react";
import { saveFirm, type FirmFormState } from "./save-firm";

const initial: FirmFormState = { message: "" };

export function FirmForm({
  firmName,
  cityState,
  replyTo,
  signerName,
  signerTitle,
}: {
  firmName: string;
  cityState: string;
  replyTo: string;
  signerName: string;
  signerTitle: string;
}) {
  const [state, action, pending] = useActionState(saveFirm, initial);
  return (
    <form className="settings-form" action={action}>
      <p>Save a new version. Earlier versions stay as they were.</p>
      <label>
        Firm name
        <input name="firmName" defaultValue={firmName} autoComplete="organization" />
      </label>
      <label>
        City and state
        <input name="cityState" defaultValue={cityState} autoComplete="address-level2" />
      </label>
      <label>
        Reply-to email
        <input name="replyTo" defaultValue={replyTo} autoComplete="email" />
      </label>
      <label>
        Signer
        <input name="signerName" defaultValue={signerName} autoComplete="name" />
      </label>
      <label>
        Title
        <input name="signerTitle" defaultValue={signerTitle} autoComplete="organization-title" />
      </label>
      <button type="submit" className="btn primary" disabled={pending}>
        Save firm profile
      </button>
      {state.message === "" ? null : <p role="status">{state.message}</p>}
    </form>
  );
}
