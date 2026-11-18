"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { signIn } from "./actions";

const BOXES = [0, 1, 2, 3, 4, 5] as const;

export function SignInForm({ message }: { message: string | null }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [focus, setFocus] = useState(0);
  const [localError, setLocalError] = useState("");
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join("");

  useEffect(() => {
    if (step === 2) boxes.current[focus]?.focus();
  }, [focus, step]);

  function setDigit(index: number, value: string): void {
    const next = [...digits];
    next[index] = value;
    setDigits(next);
  }

  function onDigit(index: number, value: string): void {
    const cleaned = value.replace(/\D/g, "");
    if (cleaned.length > 1) {
      const next = [...digits];
      for (let offset = 0; offset < cleaned.length && index + offset < 6; offset += 1) {
        next[index + offset] = cleaned[offset] ?? "";
      }
      setDigits(next);
      setFocus(Math.min(index + cleaned.length, 5));
      return;
    }
    setDigit(index, cleaned);
    if (cleaned !== "" && index < 5) setFocus(index + 1);
  }

  return (
    <main className="signin">
      <form
        className="sbox"
        action={signIn}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          if (step !== 2 || code.length !== 6) event.preventDefault();
        }}
      >
        <div className="logo" style={{ marginBottom: 28 }}>
          D&D Recovery
        </div>
        <h1>Sign in</h1>
        {message === null ? null : <p className="signin-error">{message}</p>}
        {localError === "" ? null : <p className="signin-error">{localError}</p>}
        <div hidden={step !== 1}>
          <div className="step">Step 1 of 2 · email and password</div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <div className="input">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input">
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%", height: 42 }}
            onClick={() => {
              if (email.trim() === "" || password === "") {
                setLocalError("Enter your email and password.");
                return;
              }
              setLocalError("");
              setStep(2);
              setFocus(digits.findIndex((digit) => digit === "") === -1 ? 5 : digits.findIndex((digit) => digit === ""));
            }}
          >
            Continue
          </button>
        </div>
        <div hidden={step !== 2}>
          <div className="step">Step 2 of 2 · enter the 6-digit code from your authenticator app</div>
          <label className="sr" htmlFor="code-0">
            Authenticator code
          </label>
          <div className="otp" style={{ marginBottom: 22 }} role="group" aria-label="Authenticator code">
            {BOXES.map((index) => (
              <input
                key={index}
                id={index === 0 ? "code-0" : undefined}
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={index === 0 ? 6 : 1}
                ref={(node) => {
                  boxes.current[index] = node;
                }}
                className={focus === index ? "on" : undefined}
                value={digits[index]}
                aria-label={`Digit ${index + 1}`}
                onFocus={() => setFocus(index)}
                onChange={(event) => onDigit(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && digits[index] === "" && index > 0) {
                    setFocus(index - 1);
                    setDigit(index - 1, "");
                  }
                }}
                onPaste={(event) => {
                  const text = event.clipboardData.getData("text");
                  if (!/\d/.test(text)) return;
                  event.preventDefault();
                  onDigit(index, text);
                }}
              />
            ))}
          </div>
          <input type="hidden" name="code" value={code} />
          <button type="submit" className="btn primary" style={{ width: "100%", height: 42 }} disabled={code.length !== 6}>
            Verify
          </button>
          <div className="alt">
            Signed in as {email} ·{" "}
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setLocalError("");
              }}
            >
              Use a different account
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
