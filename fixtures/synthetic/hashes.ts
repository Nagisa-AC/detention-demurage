/** SHA-256 of the eight committed synthetic PDFs. */
export const SYNTHETIC_DOCUMENTS: readonly { id: string; sha256: string }[] = [
  { id: "arithmetic", sha256: "8fad5bef177f3010f31270ac3e7bdd297e03ffa0584a744f7e743aaab7f290c8" },
  { id: "clean", sha256: "472d39b37c1e8c653c51c89c4281054839f12cd3c761ce48bac596107f71b678" },
  { id: "duplicate_a", sha256: "ed3f1445d415d7a32371b1458ffd0f000c1198d52e72b235ca97cd4e6658e25e" },
  { id: "duplicate_b", sha256: "d363fd1491a8d427e3115bbc2cbc2bfc7e8c552423e33343f68099a54f29076d" },
  { id: "free_time_overbill", sha256: "0a41c25239871ea017d5cda07cb0cf76678bdc5bacd6d4049d7f709cfb06f625" },
  { id: "late_37", sha256: "c941925fc5130fa85e130efaebfd7ce97280b3fca33a13f5ab2c628c4bcc0926" },
  { id: "missing_elements", sha256: "ef74ebcac09baa318afb5caca5a3e4a8274e6ae869a5b712b29437c85dd7c3d4" },
  { id: "split_row", sha256: "f449b285ed7ab7ff47bea95ab1729bbc6621366f43e815886c799eef72938a11" },
];

export function syntheticAllowlist(): ReadonlySet<string> {
  return new Set(SYNTHETIC_DOCUMENTS.map((document) => document.sha256));
}
