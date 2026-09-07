// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserCookieImportRecordSnapshot,
  setBrowserCookieImportRecord,
  subscribeBrowserCookieImportRecord,
} from "./browser-cookie-import-state.js";

afterEach(() => {
  vi.restoreAllMocks();
  setBrowserCookieImportRecord(null);
  window.localStorage.clear();
});

describe("browser cookie import state", () => {
  it("updates the global import record when another app window changes it", () => {
    browserCookieImportRecordSnapshot();
    const listener = vi.fn();
    const unsubscribe = subscribeBrowserCookieImportRecord(listener);
    const record = {
      family: "chrome",
      importedCookies: 4,
      kind: "browser" as const,
      profileId: "Default",
      profileLabel: "Default",
      sourceLabel: "Google Chrome",
    };

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "bb.browser.cookie-import",
        newValue: JSON.stringify(record),
        storageArea: window.localStorage,
      }),
    );

    expect(browserCookieImportRecordSnapshot()).toEqual(record);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("removes the global import record when another app window clears storage", () => {
    setBrowserCookieImportRecord({
      fileName: "cookies.json",
      importedCookies: 2,
      kind: "file",
    });
    browserCookieImportRecordSnapshot();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: null,
        newValue: null,
        storageArea: window.localStorage,
      }),
    );

    expect(browserCookieImportRecordSnapshot()).toBeNull();
  });

  it("updates subscribers even when import-history persistence is unavailable", () => {
    const updates: Array<string | null> = [];
    const unsubscribe = subscribeBrowserCookieImportRecord(() => {
      const record = browserCookieImportRecordSnapshot();
      updates.push(record?.kind === "file" ? record.fileName : null);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    try {
      setBrowserCookieImportRecord({
        kind: "file",
        fileName: "cookies.json",
        importedCookies: 2,
      });
      setBrowserCookieImportRecord(null);
      expect(updates).toEqual(["cookies.json", null]);
    } finally {
      unsubscribe();
    }
  });
});
