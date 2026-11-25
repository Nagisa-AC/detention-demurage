"use client";

import { useRef, useState, type FormEvent } from "react";
import { requestCode } from "./actions";
import { PASSKEY_FAILED, PASSKEY_WAITING, signInStep, WORK_EMAIL_FIRST } from "./email";

export function SignInForm({ emailNotice, passkeyNotice }: { emailNotice: boolean; passkeyNotice: boolean }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [emailError, setEmailError] = useState(emailNotice ? WORK_EMAIL_FIRST : "");
  const [passkeyError, setPasskeyError] = useState(passkeyNotice ? PASSKEY_FAILED : "");
  const [waiting, setWaiting] = useState(false);

  function onCode(event: FormEvent<HTMLFormElement>) {
    const step = signInStep("code", emailRef.current?.value ?? "");
    if (step.type === "email") {
      event.preventDefault();
      setEmailError(step.message);
      setPasskeyError("");
    }
  }

  async function onPasskey() {
    const step = signInStep("passkey", emailRef.current?.value ?? "");
    if (step.type !== "passkey") {
      setEmailError(step.message);
      setPasskeyError("");
      return;
    }
    setEmailError("");
    setPasskeyError("");
    setWaiting(true);
    try {
      const started = await fetch("/sign-in/passkey/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: step.email }),
      });
      if (!started.ok) {
        setPasskeyError(PASSKEY_FAILED);
        setWaiting(false);
        return;
      }
      const payload: unknown = await started.json();
      const options = typeof payload === "object" && payload !== null && "options" in payload ? payload.options : null;
      if (options === null || typeof PublicKeyCredential === "undefined") {
        setPasskeyError(PASSKEY_FAILED);
        setWaiting(false);
        return;
      }
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON);
      const credential = await navigator.credentials.get({ publicKey });
      if (credential === null || !("toJSON" in credential) || typeof credential.toJSON !== "function") {
        setPasskeyError(PASSKEY_FAILED);
        setWaiting(false);
        return;
      }
      const finished = await fetch("/sign-in/passkey/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential.toJSON()),
      });
      if (!finished.ok) {
        setPasskeyError(PASSKEY_FAILED);
        setWaiting(false);
        return;
      }
      const result: unknown = await finished.json();
      const next = typeof result === "object" && result !== null && "next" in result && typeof result.next === "string" ? result.next : "/";
      window.location.href = next === "/passkey" ? "/passkey" : "/";
    } catch {
      setPasskeyError(PASSKEY_FAILED);
      setWaiting(false);
    }
  }

  return (
    <form action={requestCode} noValidate onSubmit={onCode}>
      <label className="lbl" htmlFor="email">
        Work email
      </label>
      <input
        ref={emailRef}
        id="email"
        className="field"
        name="email"
        type="email"
        autoComplete="username"
        placeholder="you@company.com"
        autoFocus
        aria-invalid={emailError === "" ? undefined : true}
      />
      {emailError === "" ? null : <p className="field-note">{emailError}</p>}
      <button className="btn primary full" type="button" disabled={waiting} onClick={() => void onPasskey()}>
        {waiting ? PASSKEY_WAITING : "Continue with passkey"}
      </button>
      {passkeyError === "" ? null : <p className="field-note">{passkeyError}</p>}
      <div className="or">or</div>
      <button className="btn full" type="submit">
        Email me a sign-in code
      </button>
    </form>
  );
}
