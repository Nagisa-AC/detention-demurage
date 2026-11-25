import type { RealPdfReason } from "dd-core";

export type ObjectHead = {
  contentLength: number;
  checksumSha256Base64: string | null;
};

/** Head, read, and copy. Rejected objects expire; nothing here removes them. */
export type ObjectStore = {
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<Uint8Array | null>;
  copy(sourceKey: string, destKey: string): Promise<void>;
};

export type SavedDocument = { id: string; duplicate: boolean };

export type RejectReason = "checksum" | "missing" | "not_synthetic" | "copy" | RealPdfReason;

export type IntakeDb = {
  customerExists(customerId: string): Promise<boolean>;
  acceptsRealDocuments(customerId: string): Promise<boolean>;
  findDocument(customerId: string, sha256: string): Promise<{ id: string } | null>;
  saveAccepted(row: {
    customerId: string;
    sha256: string;
    byteSize: number;
    storageKey: string;
    actor: string;
  }): Promise<SavedDocument>;
  reject(row: { customerId: string; actor: string; reason: RejectReason }): Promise<void>;
};
