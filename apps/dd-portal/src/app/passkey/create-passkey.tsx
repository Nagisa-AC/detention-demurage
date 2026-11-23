"use client";

export function CreatePasskey() {
  async function create(): Promise<void> {
    const started = await fetch("/passkey/start", { method: "POST" });
    if (!started.ok) return;
    const payload: unknown = await started.json();
    const options = typeof payload === "object" && payload !== null && "options" in payload ? payload.options : null;
    if (options === null || typeof PublicKeyCredential === "undefined") return;
    try {
      const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options as PublicKeyCredentialCreationOptionsJSON);
      const credential = await navigator.credentials.create({ publicKey });
      if (credential === null || !("toJSON" in credential) || typeof credential.toJSON !== "function") return;
      const finished = await fetch("/passkey/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential.toJSON()),
      });
      if (finished.ok) window.location.href = "/passkey?ready=1";
    } catch {
      // The browser prompt was dismissed. Staying on this page is the skip path.
    }
  }

  return (
    <button className="btn primary full" type="button" onClick={() => void create()}>
      Create passkey
    </button>
  );
}
