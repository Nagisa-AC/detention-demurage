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
  const tone = state.message.startsWith("Saved version") || state.message === "No change to save." ? "ok" : "err";
  return (
    <form className="firm-form" action={action}>
      <Field label="Firm name" name="firmName" defaultValue={firmName} autoComplete="organization" help="Printed at the top of the client's report." />
      <Field label="City and state" name="cityState" defaultValue={cityState} autoComplete="address-level2" help="Printed with the firm name." />
      <Field label="Reply-to email" name="replyTo" defaultValue={replyTo} autoComplete="email" help="The address on the report." />
      <Field label="Signer" name="signerName" defaultValue={signerName} autoComplete="name" help="The name in the report signature." />
      <Field label="Title" name="signerTitle" defaultValue={signerTitle} autoComplete="organization-title" help="The title under the signature." />
      <button type="submit" className="btn primary" disabled={pending}>
        Save firm profile
      </button>
      {state.message === "" ? null : (
        <p className={`form-status ${tone}`} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  autoComplete,
  help,
}: {
  label: string;
  name: string;
  defaultValue: string;
  autoComplete: string;
  help: string;
}) {
  return (
    <div className="fld">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={defaultValue} autoComplete={autoComplete} />
      <p className="help">{help}</p>
    </div>
  );
}
