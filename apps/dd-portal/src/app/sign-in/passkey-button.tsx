"use client";

export function PasskeyButton() {
  async function start(): Promise<void> {
    const email = document.querySelector<HTMLInputElement>("#email")?.value.trim().toLowerCase() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      window.location.href = "/sign-in?notice=email";
      return;
    }
    const started = await fetch("/sign-in/passkey/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!started.ok) {
      window.location.href = "/sign-in?notice=passkey";
      return;
    }
    const payload: unknown = await started.json();
    const options = typeof payload === "object" && payload !== null && "options" in payload ? payload.options : null;
    if (options === null || typeof PublicKeyCredential === "undefined") {
      window.location.href = "/sign-in?notice=passkey";
      return;
    }
    try {
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON);
      const credential = await navigator.credentials.get({ publicKey });
      if (credential === null || !("toJSON" in credential) || typeof credential.toJSON !== "function") {
        window.location.href = "/sign-in?notice=passkey";
        return;
      }
      const finished = await fetch("/sign-in/passkey/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential.toJSON()),
      });
      if (!finished.ok) {
        window.location.href = "/sign-in?notice=passkey";
        return;
      }
      const result: unknown = await finished.json();
      const next = typeof result === "object" && result !== null && "next" in result && typeof result.next === "string" ? result.next : "/";
      window.location.href = next === "/passkey" ? "/passkey" : "/";
    } catch {
      window.location.href = "/sign-in?notice=passkey";
    }
  }

  return (
    <button className="btn primary full" type="button" onClick={() => void start()}>
      Sign in with passkey
    </button>
  );
}
