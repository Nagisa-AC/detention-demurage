const LOCAL_TEST_URL = "postgres://postgres:postgres@127.0.0.1:5432/dd_test";

/** Tests never read DATABASE_URL. A Neon host is production. */
export function assertSafeTestDatabase(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("TEST_DATABASE_URL is not a database URL.");
  }
  if (host === "neon.tech" || host.endsWith(".neon.tech")) {
    throw new Error("Tests refuse a Neon host.");
  }
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? LOCAL_TEST_URL;
  assertSafeTestDatabase(url);
  return url;
}

export function appDatabaseUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = "dd_app";
  url.password = "dd_app_test";
  return url.toString();
}
