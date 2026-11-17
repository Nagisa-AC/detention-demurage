"use client";

import { useState, type FormEvent } from "react";

type Customer = { id: string; displayName: string };

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const EXPIRES = "This upload was not accepted. The incoming object expires within a day.";
const BROWSER_SEND = "The browser could not send the file.";

export function UploadForm({ customers }: { customers: Customer[] }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = event.currentTarget.elements.namedItem("pdf");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file === undefined) {
      setMessage("Choose a PDF.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Only a PDF can be uploaded.");
      return;
    }
    if (file.size < 1) {
      setMessage("Choose a PDF.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setMessage("This PDF is over 20 MiB. No upload was started.");
      return;
    }
    setBusy(true);
    setMessage("Checking the PDF.");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const issued = await postJson("/api/uploads", {
        customerId,
        sha256,
        byteSize: bytes.byteLength,
        contentType: "application/pdf",
      });
      if (!issued.ok) {
        setMessage(issued.message);
        return;
      }
      if (issued.value.duplicate === true && typeof issued.value.documentId === "string") {
        setMessage("This PDF is already stored.");
        return;
      }
      if (typeof issued.value.url !== "string" || typeof issued.value.uploadId !== "string") {
        setMessage("Upload is not configured.");
        return;
      }
      let put: Response;
      try {
        put = await fetch(issued.value.url, {
          method: "PUT",
          headers: {
            "content-type": "application/pdf",
            "x-amz-checksum-sha256": hexToBase64(sha256),
          },
          body: bytes,
        });
      } catch {
        setMessage(BROWSER_SEND);
        return;
      }
      if (!put.ok) {
        setMessage(EXPIRES);
        return;
      }
      const confirmed = await postJson("/api/uploads/confirm", {
        customerId,
        uploadId: issued.value.uploadId,
        sha256,
        byteSize: bytes.byteLength,
      });
      if (!confirmed.ok) {
        setMessage(confirmed.message);
        return;
      }
      setMessage(confirmed.value.duplicate === true ? "This PDF is already stored." : "The PDF is stored.");
    } catch {
      setMessage(EXPIRES);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="upload" onSubmit={onSubmit}>
      <p>Upload a PDF invoice.</p>
      {customers.length > 1 ? (
        <label>
          Customer
          <select name="customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>{customers[0]?.displayName}</p>
      )}
      <label>
        PDF
        <input name="pdf" type="file" accept="application/pdf,.pdf" />
      </label>
      <button type="submit" disabled={busy}>
        Upload
      </button>
      <p role="status">{message}</p>
    </form>
  );
}

async function postJson(path: string, body: unknown): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; message: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return { ok: false, message: EXPIRES };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: EXPIRES };
  const record = value as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : EXPIRES;
    return { ok: false, message };
  }
  return { ok: true, value: record };
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
