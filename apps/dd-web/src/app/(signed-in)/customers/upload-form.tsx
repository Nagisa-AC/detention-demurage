"use client";

import { useState, type FormEvent } from "react";

type Customer = { id: string; displayName: string };

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const EXPIRES = "This upload was not accepted. The incoming object expires within a day.";
const BROWSER_SEND = "The browser could not send the file.";

export function UploadForm({ customers, maxBytes = MAX_PDF_BYTES }: { customers: Customer[]; maxBytes?: number }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [over, setOver] = useState(false);

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
    if (file.size > maxBytes) {
      const size =
        maxBytes === MAX_PDF_BYTES ? "This PDF is over 20 MiB." : `This PDF is over ${Math.round(maxBytes / (1024 * 1024))} MB.`;
      setMessage(`${size} No upload was started.`);
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

  const tone = messageTone(message);
  return (
    <form className="upload" onSubmit={onSubmit}>
      {customers.length > 1 ? (
        <div className="fld">
          <label htmlFor="upload-customer">Customer</label>
          <select id="upload-customer" name="customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <label
        className={over ? "drop over" : "drop"}
        onDragEnter={() => setOver(true)}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <input
          name="pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        />
        <strong>{fileName === "" ? "Drop a PDF here" : fileName}</strong>
        <span className="help">{fileName === "" ? "or choose a file" : "Ready to upload"}</span>
      </label>
      <p className="help">
        {maxBytes === MAX_PDF_BYTES ? "PDF only, up to 20 MiB." : `PDF only, up to ${Math.round(maxBytes / (1024 * 1024))} MB.`}
        {customers.length === 1 && customers[0] !== undefined ? ` For ${customers[0].displayName}.` : ""}
      </p>
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </button>
      {message === "" ? null : (
        <p className={tone === "" ? "form-status" : `form-status ${tone}`} role="status">
          {message}
        </p>
      )}
    </form>
  );
}

function messageTone(message: string): "ok" | "err" | "" {
  if (message === "" || message === "Checking the PDF.") return "";
  if (message === "The PDF is stored." || message === "This PDF is already stored.") return "ok";
  return "err";
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
