import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app, session } from "electron";
import { importCookiesFromBrowserSource } from "../src/desktop-browser-cookie-import.js";

app.whenReady().then(async () => {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "bb-real-cookie-import-"));
  const profile = join(
    home,
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "Default",
  );
  mkdirSync(profile, { recursive: true });
  const database = new DatabaseSync(join(profile, "Cookies"));
  database.exec(`
    CREATE TABLE cookies (
      host_key TEXT NOT NULL,
      top_frame_site_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      samesite INTEGER NOT NULL,
      encrypted_value BLOB NOT NULL
    );
    INSERT INTO cookies VALUES (
      '.example.test', '', 'session', 'imported', '/', 0, 1, 1, 1, X''
    );
    INSERT INTO cookies VALUES (
      '.example.test', 'https://embedder.test', 'session', 'partitioned', '/', 0, 1, 1, 1, X''
    );
  `);
  database.close();
  process.env.HOME = home;
  try {
    const imported = importCookiesFromBrowserSource({
      family: "chrome",
      profileId: "Default",
    });
    const cookies = session.fromPartition(
      `persist:bb-real-cookie-probe-${Date.now()}`,
    ).cookies;
    await cookies.set({
      domain: "example.test",
      httpOnly: true,
      name: "session",
      path: "/",
      sameSite: "lax",
      secure: true,
      url: "https://example.test/",
      value: "old",
    });
    for (const cookie of await cookies.get({})) {
      const domain = cookie.domain;
      if (domain === undefined) throw new Error("Electron returned a cookie without a domain");
      await cookies.remove(
        `${cookie.secure ? "https" : "http"}://${domain.replace(/^\./, "")}${cookie.path}`,
        cookie.name,
      );
    }
    for (const cookie of imported) {
      const host = cookie.domain.startsWith(".")
        ? cookie.domain.slice(1)
        : cookie.domain;
      await cookies.set({
        ...(cookie.domain.startsWith(".") ? { domain: host } : {}),
        httpOnly: cookie.httpOnly,
        name: cookie.name,
        path: cookie.path,
        sameSite: cookie.sameSite,
        secure: cookie.secure,
        url: `https://${host}${cookie.path}`,
        value: cookie.value,
      });
    }
    const finalCookies = await cookies.get({ domain: "example.test" });
    process.stdout.write(
      JSON.stringify({
        finalCookies: finalCookies.map(({ httpOnly, name, value }) => ({
          httpOnly,
          name,
          value,
        })),
        importedCount: imported.length,
      }),
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { force: true, recursive: true });
    app.quit();
  }
});
