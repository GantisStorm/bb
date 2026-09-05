import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { importCookiesFromBrowserSource } from "../src/desktop-browser-cookie-import.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "test-secret\n"),
}));

describe("desktop browser cookie import", () => {
  it("imports Chromium expiration timestamps beyond JavaScript's safe integer range", () => {
    const previousHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "bb-cookie-import-home-"));
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
      CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
      INSERT INTO meta VALUES ('version', '24');
      CREATE TABLE cookies (
        host_key TEXT NOT NULL,
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
        '.example.com',
        'session',
        'plain-value',
        '/',
        13467177743557433,
        1,
        1,
        2,
        X''
      );
      INSERT INTO cookies VALUES (
        '.none.test',
        'none',
        'none-value',
        '/',
        0,
        0,
        0,
        0,
        X''
      );
      INSERT INTO cookies VALUES (
        '.expired.test',
        'expired',
        'expired-value',
        '/',
        13000000000000000,
        0,
        0,
        -1,
        X''
      );
    `);
    const key = pbkdf2Sync("test-secret", "saltysalt", 1003, 16, "sha1");
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    const encryptedValue = Buffer.concat([
      Buffer.from("v10"),
      cipher.update(
        Buffer.concat([
          createHash("sha256").update(".encrypted.test").digest(),
          Buffer.from("encrypted-value"),
        ]),
      ),
      cipher.final(),
    ]);
    database
      .prepare("INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(".encrypted.test", "encrypted", "", "/", 0, 0, 0, 1, encryptedValue);
    database.close();
    process.env.HOME = home;

    try {
      expect(
        importCookiesFromBrowserSource({
          family: "chrome",
          profileId: "Default",
        }),
      ).toEqual([
        {
          domain: ".example.com",
          expirationDate: 1_822_704_143,
          httpOnly: true,
          name: "session",
          path: "/",
          sameSite: "strict",
          secure: true,
          value: "plain-value",
        },
        {
          domain: ".none.test",
          expirationDate: null,
          httpOnly: false,
          name: "none",
          path: "/",
          sameSite: "no_restriction",
          secure: false,
          value: "none-value",
        },
        {
          domain: ".encrypted.test",
          expirationDate: null,
          httpOnly: false,
          name: "encrypted",
          path: "/",
          sameSite: "lax",
          secure: false,
          value: "encrypted-value",
        },
      ]);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("skips Chromium partitioned cookies the Electron API cannot represent", () => {
    const previousHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "bb-cookie-import-home-"));
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
        '.example.com', '', 'session', 'unpartitioned', '/', 0, 1, 1, 1, X''
      );
      INSERT INTO cookies VALUES (
        '.example.com', 'https://embedder.example', 'session', 'partitioned', '/', 0, 1, 1, 1, X''
      );
    `);
    database.close();
    process.env.HOME = home;

    try {
      expect(
        importCookiesFromBrowserSource({
          family: "chrome",
          profileId: "Default",
        }),
      ).toEqual([
        {
          domain: ".example.com",
          expirationDate: null,
          httpOnly: true,
          name: "session",
          path: "/",
          sameSite: "lax",
          secure: true,
          value: "unpartitioned",
        },
      ]);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("skips Firefox partitioned cookies the Electron API cannot represent", () => {
    const previousHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "bb-cookie-import-home-"));
    const profile = join(
      home,
      "Library",
      "Application Support",
      "Firefox",
      "Profiles",
      "test.default",
    );
    mkdirSync(profile, { recursive: true });
    const database = new DatabaseSync(join(profile, "cookies.sqlite"));
    database.exec(`
      CREATE TABLE moz_cookies (
        originAttributes TEXT NOT NULL DEFAULT '',
        name TEXT,
        value TEXT,
        host TEXT,
        path TEXT,
        expiry INTEGER,
        isSecure INTEGER,
        isHttpOnly INTEGER,
        sameSite INTEGER
      );
      INSERT INTO moz_cookies VALUES (
        '', 'session', 'unpartitioned', '.example.com', '/', 0, 1, 1, 1
      );
      INSERT INTO moz_cookies VALUES (
        '^partitionKey=%28https%2Cembedder.example%29',
        'session',
        'partitioned',
        '.example.com',
        '/',
        0,
        1,
        1,
        1
      );
    `);
    database.close();
    process.env.HOME = home;

    try {
      expect(
        importCookiesFromBrowserSource({
          family: "firefox",
          profileId: "test.default",
        }),
      ).toEqual([
        {
          domain: ".example.com",
          expirationDate: null,
          httpOnly: true,
          name: "session",
          path: "/",
          sameSite: "lax",
          secure: true,
          value: "unpartitioned",
        },
      ]);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { force: true, recursive: true });
    }
  });
});
