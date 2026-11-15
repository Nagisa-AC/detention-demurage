export type ObjectHead = {
  contentLength: number;
  checksumSha256Base64: string | null;
};

/** Head and copy only. Rejected objects expire; nothing here removes them. */
export type ObjectStore = {
  head(key: string): Promise<ObjectHead | null>;
  copy(sourceKey: string, destKey: string): Promise<void>;
};

export type SavedDocument = { id: string; duplicate: boolean };

export type RejectReason = "checksum" | "missing" | "not_synthetic" | "copy";

export type IntakeDb = {
  customerExists(customerId: string): Promise<boolean>;
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
