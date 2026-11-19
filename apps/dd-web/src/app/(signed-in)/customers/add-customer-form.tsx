"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { checkConfigId, type ConfigIdStatus } from "./check-config-id";
import { CONFIG_ID, suggestConfigId } from "./config-id";
import { createCustomer, type CustomerFormState } from "./create-customer";

const initial: CustomerFormState = { message: "" };

export function AddCustomerDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(createCustomer, initial);
  const [name, setName] = useState("");
  const [configId, setConfigId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [availability, setAvailability] = useState<ConfigIdStatus | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const configFieldId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose, pending]);

  useEffect(() => {
    const id = configId.trim();
    if (!open || !CONFIG_ID.test(id)) return;
    let cancel = false;
    const timer = setTimeout(() => {
      checkConfigId(id)
        .then((status) => {
          if (!cancel) setAvailability(status);
        })
        .catch(() => {
          if (!cancel) setAvailability(null);
        });
    }, 250);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [configId, open]);

  if (!open) return null;

  const trimmed = configId.trim();
  const formatOk = CONFIG_ID.test(trimmed);
  const taken = formatOk && availability === "taken";
  const available = formatOk && availability === "available";
  const nameOk = name.trim().length >= 1 && name.trim().length <= 120;
  const canSubmit = nameOk && formatOk && !taken && !pending;
  const nameError = state.message === "Enter a display name." ? state.message : "";
  const idError = idMessage(state.message, trimmed, formatOk, taken);

  return (
    <>
      <button type="button" className="scrim" aria-label="Close" disabled={pending} onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <form action={action}>
          <div className="dh">
            <div className="k mono">New customer</div>
            <h2 id={titleId}>Add a customer</h2>
            <p>An importer whose D&amp;D invoices you will audit.</p>
          </div>
          <div className="db">
            <div className="fld">
              <label htmlFor="company-name">Company name</label>
              <input
                id="company-name"
                ref={nameRef}
                name="displayName"
                type="text"
                required
                maxLength={120}
                autoComplete="off"
                value={name}
                aria-invalid={nameError !== ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!idEdited) {
                    setConfigId(suggestConfigId(value));
                    setAvailability(null);
                  }
                }}
              />
              {nameError === "" ? <p className="help">How it appears in the app and on the client&apos;s report.</p> : <p className="err">{nameError}</p>}
            </div>
            <div className="fld">
              <label htmlFor={configFieldId}>Customer ID</label>
              <input
                id={configFieldId}
                className="mono"
                name="configId"
                type="text"
                required
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                value={configId}
                aria-invalid={idError !== ""}
                onChange={(event) => {
                  setIdEdited(true);
                  setConfigId(event.target.value);
                  setAvailability(null);
                }}
              />
              {available ? (
                <p className="ok">{idEdited ? "✓ Available" : "✓ Available · filled from the name, you can edit it"}</p>
              ) : null}
              {idError === "" ? null : <p className="err">{idError}</p>}
              <p className="help">Permanent. Lowercase letters, numbers and underscores. The customer&apos;s settings must use this same id.</p>
            </div>
            <div className="next">
              <strong>Next:</strong> add settings (fee, authorization, carriers, contract terms), then upload invoices. You can do both from the customer&apos;s page.
            </div>
            {state.message !== "" && nameError === "" && idError === "" ? <p className="form-status err">{state.message}</p> : null}
          </div>
          <div className="df">
            <button type="button" className="btn" disabled={pending} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!canSubmit}>
              Add customer
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function idMessage(message: string, trimmed: string, formatOk: boolean, taken: boolean): string {
  if (taken || message === "A customer with that config id already exists.") return "Already taken";
  if (trimmed !== "" && !formatOk) return "Enter a config id like harbor_home.";
  if (message === "Enter a config id like harbor_home.") return message;
  return "";
}
