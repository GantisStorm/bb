import { z } from "zod";

const browserCookieImportRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      family: z.string().min(1).max(64),
      importedCookies: z.number().int().nonnegative(),
      kind: z.literal("browser"),
      profileId: z.string().min(1).max(256),
      profileLabel: z.string().min(1).max(256),
      sourceLabel: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      fileName: z.string().min(1).max(1_024),
      importedCookies: z.number().int().nonnegative(),
      kind: z.literal("file"),
    })
    .strict(),
]);

export type BrowserCookieImportRecord = z.infer<
  typeof browserCookieImportRecordSchema
>;

const STORAGE_KEY = "bb.browser.cookie-import";
const listeners = new Set<() => void>();
let initialized = false;
let currentRecord: BrowserCookieImportRecord | null = null;

function parseBrowserCookieImportRecord(
  value: string | null,
): BrowserCookieImportRecord | null {
  if (value === null) return null;
  try {
    const parsed = browserCookieImportRecordSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}


function initialize(): void {
  if (initialized || typeof localStorage === "undefined") return;
  initialized = true;
  currentRecord = parseBrowserCookieImportRecord(
    localStorage.getItem(STORAGE_KEY),
  );
  window.addEventListener("storage", (event) => {
    if (
      event.storageArea !== localStorage ||
      (event.key !== STORAGE_KEY && event.key !== null)
    ) {
      return;
    }
    currentRecord = parseBrowserCookieImportRecord(event.newValue);
    for (const listener of listeners) listener();
  });
}

export function browserCookieImportRecordSnapshot(): BrowserCookieImportRecord | null {
  initialize();
  return currentRecord;
}

export function subscribeBrowserCookieImportRecord(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setBrowserCookieImportRecord(
  record: BrowserCookieImportRecord | null,
): void {
  initialize();
  currentRecord = record;
  if (typeof localStorage !== "undefined") {
    if (record === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }
  for (const listener of listeners) listener();
}
