import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type BbDesktopBrowserCookieImport,
  type BbDesktopBrowserCookieImportSource,
} from "@bb/desktop-contract";
import { z } from "zod";

interface BrowserDefinition {
  family: string;
  label: string;
  linuxKeyringApplication?: string;
  macKeychainAccount: string;
  macKeychainService: string;
  macRoot?: string;
  linuxRoot?: string;
}

interface BrowserProfile {
  id: string;
  label: string;
}

interface CookieImportSource {
  definition: BrowserDefinition;
  profile: BrowserProfile;
}

const CHROMIUM_BROWSERS: readonly BrowserDefinition[] = [
  {
    family: "chrome",
    label: "Google Chrome",
    macKeychainAccount: "Chrome",
    macKeychainService: "Chrome Safe Storage",
    macRoot: "Google/Chrome",
    linuxKeyringApplication: "chrome",
    linuxRoot: "google-chrome",
  },
  {
    family: "edge",
    label: "Microsoft Edge",
    macKeychainAccount: "Microsoft Edge",
    macKeychainService: "Microsoft Edge Safe Storage",
    macRoot: "Microsoft Edge",
    linuxKeyringApplication: "chromium",
    linuxRoot: "microsoft-edge",
  },
  {
    family: "arc",
    label: "Arc",
    macKeychainAccount: "Arc",
    macKeychainService: "Arc Safe Storage",
    macRoot: "Arc/User Data",
  },
  {
    family: "brave",
    label: "Brave",
    macKeychainAccount: "Brave",
    macKeychainService: "Brave Safe Storage",
    macRoot: "BraveSoftware/Brave-Browser",
    linuxKeyringApplication: "brave",
    linuxRoot: "BraveSoftware/Brave-Browser",
  },
  {
    family: "comet",
    label: "Comet",
    macKeychainAccount: "Comet",
    macKeychainService: "Comet Safe Storage",
    macRoot: "Comet",
  },
  {
    family: "helium",
    label: "Helium",
    macKeychainAccount: "Helium",
    macKeychainService: "Helium Storage Key",
    macRoot: "net.imput.helium",
  },
];

const browserLocalStateSchema = z.object({
  profile: z
    .object({
      info_cache: z.record(
        z.string(),
        z.object({ name: z.string().optional() }),
      ),
    })
    .optional(),
});

const chromiumCookieRowSchema = z.object({
  encrypted_value: z.instanceof(Uint8Array),
  expiration_unix: z.number(),
  host_key: z.string(),
  is_httponly: z.number(),
  is_secure: z.number(),
  name: z.string(),
  path: z.string(),
  samesite: z.number(),
  value: z.string(),
});

const chromiumMetaVersionSchema = z.object({
  value: z.union([z.number(), z.string()]),
});

const firefoxCookieRowSchema = z.object({
  expiry: z.number(),
  host: z.string(),
  isHttpOnly: z.number(),
  isSecure: z.number(),
  name: z.string(),
  path: z.string(),
  sameSite: z.number(),
  value: z.string(),
});

function isSafeProfileId(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    !value.includes("\0") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..")
  );
}

function browserRoot(definition: BrowserDefinition): string | null {
  const home = process.env.HOME ?? "";
  if (process.platform === "darwin") {
    return definition.macRoot === undefined
      ? null
      : join(home, "Library", "Application Support", definition.macRoot);
  }
  if (process.platform === "linux") {
    if (definition.linuxRoot === undefined) return null;
    const configHome = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
    return join(configHome, definition.linuxRoot);
  }
  return null;
}

function chromiumCookiePath(profilePath: string): string | null {
  for (const candidate of [
    join(profilePath, "Network", "Cookies"),
    join(profilePath, "Cookies"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function chromiumProfiles(root: string): readonly BrowserProfile[] {
  const localStatePath = join(root, "Local State");
  try {
    const parsed = browserLocalStateSchema.safeParse(
      JSON.parse(readFileSync(localStatePath, "utf8")),
    );
    const infoCache = parsed.success
      ? parsed.data.profile?.info_cache
      : undefined;
    if (infoCache === undefined) {
      return [{ id: "Default", label: "Default" }];
    }
    const profiles: BrowserProfile[] = [];
    for (const [id, detail] of Object.entries(infoCache)) {
      if (isSafeProfileId(id)) {
        profiles.push({ id, label: detail.name ?? id });
      }
    }
    return profiles.length > 0
      ? profiles
      : [{ id: "Default", label: "Default" }];
  } catch {
    return [{ id: "Default", label: "Default" }];
  }
}

function firefoxProfilesRoot(): string | null {
  const home = process.env.HOME ?? "";
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Firefox", "Profiles");
  }
  if (process.platform === "linux") return join(home, ".mozilla", "firefox");
  return null;
}

function firefoxProfiles(): readonly BrowserProfile[] {
  const root = firefoxProfilesRoot();
  if (root === null || !existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSafeProfileId(entry.name))
      .map((entry) => {
        const suffix = entry.name.split(".").slice(1).join(".");
        return {
          id: entry.name,
          label: suffix.length > 0 ? suffix : entry.name,
        };
      })
      .filter((profile) => existsSync(join(root, profile.id, "cookies.sqlite")))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

function sources(): readonly CookieImportSource[] {
  const detected: CookieImportSource[] = [];
  for (const definition of CHROMIUM_BROWSERS) {
    const root = browserRoot(definition);
    if (root === null) continue;
    for (const profile of chromiumProfiles(root)) {
      if (chromiumCookiePath(join(root, profile.id)) !== null) {
        detected.push({ definition, profile });
      }
    }
  }
  for (const profile of firefoxProfiles()) {
    detected.push({
      definition: {
        family: "firefox",
        label: "Firefox",
        macKeychainAccount: "",
        macKeychainService: "",
      },
      profile,
    });
  }
  return detected;
}

export function listBrowserCookieImportSources(): readonly BbDesktopBrowserCookieImportSource[] {
  const grouped = new Map<string, BbDesktopBrowserCookieImportSource>();
  for (const source of sources()) {
    const current = grouped.get(source.definition.family);
    if (current === undefined) {
      grouped.set(source.definition.family, {
        family: source.definition.family,
        label: source.definition.label,
        profiles: [{ id: source.profile.id, label: source.profile.label }],
      });
      continue;
    }
    current.profiles.push({
      id: source.profile.id,
      label: source.profile.label,
    });
  }
  return [...grouped.values()];
}

function copyDatabase(sourcePath: string): {
  databasePath: string;
  directory: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "bb-browser-cookies-"));
  const databasePath = join(directory, "cookies.sqlite");
  copyFileSync(sourcePath, databasePath);
  for (const suffix of ["-shm", "-wal"]) {
    const sidecar = `${sourcePath}${suffix}`;
    if (existsSync(sidecar)) copyFileSync(sidecar, `${databasePath}${suffix}`);
  }
  return { databasePath, directory };
}

interface ChromiumKeys {
  v10: readonly Buffer[];
  v11: readonly Buffer[];
}

function linuxKeyringSecret(definition: BrowserDefinition): string | null {
  if (definition.linuxKeyringApplication === undefined) return null;
  const attempts = [
    [
      "lookup",
      "xdg:schema",
      "chrome_libsecret_os_crypt_password_v2",
      "application",
      definition.linuxKeyringApplication,
    ],
    [
      "lookup",
      "xdg:schema",
      "chrome_libsecret_os_crypt_password_v1",
      "application",
      definition.linuxKeyringApplication,
    ],
    [
      "lookup",
      "service",
      definition.macKeychainService,
      "account",
      definition.macKeychainAccount,
    ],
  ];
  for (const args of attempts) {
    try {
      const secret = execFileSync("secret-tool", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      }).trim();
      if (secret.length > 0) return secret;
    } catch {}
  }
  return null;
}

function chromiumKeys(definition: BrowserDefinition): ChromiumKeys | null {
  if (process.platform === "darwin") {
    try {
      const secret = execFileSync(
        "security",
        [
          "find-generic-password",
          "-w",
          "-s",
          definition.macKeychainService,
          "-a",
          definition.macKeychainAccount,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return {
        v10: [pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1")],
        v11: [],
      };
    } catch {
      return null;
    }
  }
  if (process.platform === "linux") {
    const keyringSecret = linuxKeyringSecret(definition);
    return {
      v10: [pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1")],
      v11: [
        ...(keyringSecret === null
          ? []
          : [pbkdf2Sync(keyringSecret, "saltysalt", 1, 16, "sha1")]),
        pbkdf2Sync("", "saltysalt", 1, 16, "sha1"),
      ],
    };
  }
  return null;
}

function decryptChromiumCookie(args: {
  domain: string;
  hasDomainHash: boolean;
  keys: ChromiumKeys | null;
  value: Buffer;
}): string | null {
  if (args.value.length === 0) return "";
  const version = args.value.subarray(0, 3).toString("utf8");
  if (version !== "v10" && version !== "v11") return null;
  const keys = args.keys?.[version] ?? [];
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(
        "aes-128-cbc",
        key,
        Buffer.alloc(16, 0x20),
      );
      let plaintext = Buffer.concat([
        decipher.update(args.value.subarray(3)),
        decipher.final(),
      ]);
      if (args.hasDomainHash) {
        const expectedHash = createHash("sha256").update(args.domain).digest();
        if (
          plaintext.length <= expectedHash.length ||
          !plaintext.subarray(0, expectedHash.length).equals(expectedHash)
        ) {
          continue;
        }
        plaintext = plaintext.subarray(expectedHash.length);
      }
      return plaintext.toString("utf8");
    } catch {}
  }
  return null;
}

function sameSite(
  value: number | null,
  family: "chromium" | "firefox",
): BbDesktopBrowserCookieImport["sameSite"] {
  if (family === "firefox") {
    if (value === 0) return "no_restriction";
    if (value === 1) return "lax";
    if (value === 2) return "strict";
    return "unspecified";
  }
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

function toCookie(args: {
  domain: string | null;
  expirationDate: number | null;
  httpOnly: boolean;
  name: string | null;
  path: string | null;
  sameSite: BbDesktopBrowserCookieImport["sameSite"];
  secure: boolean;
  value: string | null;
}): BbDesktopBrowserCookieImport | null {
  if (
    args.domain === null ||
    args.name === null ||
    args.path === null ||
    args.value === null ||
    args.domain.length === 0 ||
    args.name.length === 0 ||
    args.path.length === 0
  ) {
    return null;
  }
  return {
    domain: args.domain,
    expirationDate: args.expirationDate,
    httpOnly: args.httpOnly,
    name: args.name,
    path: args.path,
    sameSite: args.sameSite,
    secure: args.secure,
    value: args.value,
  };
}

function readChromiumCookies(
  source: CookieImportSource,
): readonly BbDesktopBrowserCookieImport[] {
  const root = browserRoot(source.definition);
  if (root === null) throw new Error("Browser not found on this computer");
  const sourcePath = chromiumCookiePath(join(root, source.profile.id));
  if (sourcePath === null)
    throw new Error("Browser profile not found on this computer");
  const snapshot = copyDatabase(sourcePath);
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(snapshot.databasePath, { readOnly: true });
    let rawRows: unknown[];
    try {
      rawRows = database
        .prepare(
          "SELECT host_key, name, value, path, CAST(expires_utc / 1000000 - 11644473600 AS INTEGER) AS expiration_unix, is_secure, is_httponly, samesite, encrypted_value FROM cookies WHERE top_frame_site_key = ''",
        )
        .all();
    } catch {
      rawRows = database
        .prepare(
          "SELECT host_key, name, value, path, CAST(expires_utc / 1000000 - 11644473600 AS INTEGER) AS expiration_unix, is_secure, is_httponly, samesite, encrypted_value FROM cookies",
        )
        .all();
    }
    const rows = chromiumCookieRowSchema.array().parse(rawRows);
    let hasDomainHash = false;
    try {
      const metaVersion = chromiumMetaVersionSchema.safeParse(
        database.prepare("SELECT value FROM meta WHERE key = 'version'").get(),
      );
      hasDomainHash =
        metaVersion.success && Number(metaVersion.data.value) >= 24;
    } catch {}
    const keys = rows.some(
      (row) => row.value.length === 0 && row.encrypted_value.length > 0,
    )
      ? chromiumKeys(source.definition)
      : null;
    const cookies: BbDesktopBrowserCookieImport[] = [];
    for (const row of rows) {
      const value =
        row.value.length > 0
          ? row.value
          : decryptChromiumCookie({
              domain: row.host_key,
              hasDomainHash,
              keys,
              value: Buffer.from(row.encrypted_value),
            });
      const expirationDate =
        row.expiration_unix > 0 ? row.expiration_unix : null;
      if (
        expirationDate !== null &&
        expirationDate <= Math.floor(Date.now() / 1_000)
      ) {
        continue;
      }
      const cookie = toCookie({
        domain: row.host_key,
        expirationDate:
          expirationDate !== null && expirationDate > 0 ? expirationDate : null,
        httpOnly: row.is_httponly === 1,
        name: row.name,
        path: row.path,
        sameSite: sameSite(row.samesite, "chromium"),
        secure: row.is_secure === 1,
        value,
      });
      if (cookie !== null) cookies.push(cookie);
    }
    return cookies;
  } catch {
    throw new Error("Could not read cookies from the selected browser profile");
  } finally {
    database?.close();
    rmSync(snapshot.directory, { force: true, recursive: true });
  }
}

function readFirefoxCookies(
  source: CookieImportSource,
): readonly BbDesktopBrowserCookieImport[] {
  const root = firefoxProfilesRoot();
  if (root === null)
    throw new Error("Firefox is not available on this computer");
  const sourcePath = join(root, source.profile.id, "cookies.sqlite");
  if (!existsSync(sourcePath))
    throw new Error("Firefox profile not found on this computer");
  const snapshot = copyDatabase(sourcePath);
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(snapshot.databasePath, { readOnly: true });
    let rawRows: unknown[];
    try {
      rawRows = database
        .prepare(
          "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes NOT LIKE '%partitionKey=%'",
        )
        .all();
    } catch {
      rawRows = database
        .prepare(
          "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies",
        )
        .all();
    }
    const rows = firefoxCookieRowSchema.array().parse(rawRows);
    const cookies: BbDesktopBrowserCookieImport[] = [];
    for (const row of rows) {
      if (row.expiry > 0 && row.expiry <= Math.floor(Date.now() / 1_000)) {
        continue;
      }
      const cookie = toCookie({
        domain: row.host,
        expirationDate: row.expiry > 0 ? Math.floor(row.expiry) : null,
        httpOnly: row.isHttpOnly === 1,
        name: row.name,
        path: row.path,
        sameSite: sameSite(row.sameSite, "firefox"),
        secure: row.isSecure === 1,
        value: row.value,
      });
      if (cookie !== null) cookies.push(cookie);
    }
    return cookies;
  } catch {
    throw new Error("Could not read cookies from the selected Firefox profile");
  } finally {
    database?.close();
    rmSync(snapshot.directory, { force: true, recursive: true });
  }
}

export function importCookiesFromBrowserSource(args: {
  family: string;
  profileId: string;
}): readonly BbDesktopBrowserCookieImport[] {
  const source = sources().find(
    (candidate) =>
      candidate.definition.family === args.family &&
      candidate.profile.id === args.profileId,
  );
  if (source === undefined)
    throw new Error("Browser profile not found on this computer");
  return source.definition.family === "firefox"
    ? readFirefoxCookies(source)
    : readChromiumCookies(source);
}
