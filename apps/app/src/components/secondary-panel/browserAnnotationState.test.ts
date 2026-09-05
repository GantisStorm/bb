// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { Shape } from "./BrowserScreenshotAnnotation";
import {
  browserAnnotationSnapshot,
  clearBrowserAnnotationRecord,
  clearBrowserAnnotationRecordsForEnvironment,
  clearBrowserAnnotationRecordsForTab,
  clearBrowserAnnotationRecordsForThread,
  createEmptyBrowserScreenshotEditor,
  markBrowserAnnotationEpoch,
  resetBrowserAnnotationStore,
  setBrowserAnnotationElements,
  setBrowserAnnotationScreenshot,
  type BrowserAnnotationKey,
  type BrowserElementSession,
  type BrowserScreenshotSession,
} from "./browserAnnotationState";

const keyA: BrowserAnnotationKey = {
  environmentId: "env-1",
  tabId: "tab-a",
  threadId: "thread-a",
};
const keyB: BrowserAnnotationKey = {
  environmentId: "env-1",
  tabId: "tab-a",
  threadId: "thread-b",
};
const keyC: BrowserAnnotationKey = {
  environmentId: "env-2",
  tabId: "tab-a",
  threadId: "thread-a",
};
const keyD: BrowserAnnotationKey = {
  environmentId: "env-1",
  tabId: "tab-b",
  threadId: "thread-a",
};

const penShape: Shape = {
  color: "#ef4444",
  id: "shape-1",
  kind: "pen",
  points: [
    { x: 0, y: 0 },
    { x: 12, y: 12 },
  ],
  width: 4,
};

function screenshotSession(
  editor = createEmptyBrowserScreenshotEditor(),
): BrowserScreenshotSession {
  return { editor, screenshotUrl: "data:image/png;base64,screenshot" };
}

function elementsSession(
  review: BrowserElementSession["review"] = null,
): BrowserElementSession {
  return {
    notes: [],
    pageSnapshotUrl: "data:image/jpeg;base64,page",
    review,
  };
}

afterEach(() => {
  resetBrowserAnnotationStore();
  window.localStorage.clear();
});

describe("browserAnnotationState", () => {
  it("isolates records by environment, thread, and tab", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());

    expect(browserAnnotationSnapshot(keyA)?.screenshot).not.toBeNull();
    expect(browserAnnotationSnapshot(keyB)).toBeNull();
    expect(browserAnnotationSnapshot(keyC)).toBeNull();
    expect(browserAnnotationSnapshot(keyD)).toBeNull();
    expect(
      browserAnnotationSnapshot({
        environmentId: null,
        tabId: "tab-a",
        threadId: "thread-a",
      }),
    ).toBeNull();
  });

  it("returns immutable snapshots that stay stable between writes", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    expect(browserAnnotationSnapshot(keyA)).toBeNull();

    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    const first = browserAnnotationSnapshot(keyA);
    expect(first).not.toBeNull();
    expect(browserAnnotationSnapshot(keyA)).toBe(first);
    expect(first?.screenshot?.editor.shapes).toEqual([]);

    setBrowserAnnotationScreenshot(keyA, 7, {
      editor: {
        ...createEmptyBrowserScreenshotEditor(),
        shapes: [penShape],
        tool: "arrow",
      },
      screenshotUrl: "data:image/png;base64,screenshot",
    });
    const second = browserAnnotationSnapshot(keyA);
    expect(second).not.toBe(first);
    expect(second?.screenshot?.editor.shapes).toEqual([penShape]);
    expect(second?.screenshot?.editor.tool).toBe("arrow");
  });

  it("rejects writes whose epoch does not match the current target", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    expect(browserAnnotationSnapshot(keyA)?.navigationEpoch).toBe(7);

    markBrowserAnnotationEpoch(keyA, 8);
    clearBrowserAnnotationRecord(keyA);
    expect(browserAnnotationSnapshot(keyA)).toBeNull();

    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    expect(browserAnnotationSnapshot(keyA)).toBeNull();

    setBrowserAnnotationScreenshot(keyA, 8, screenshotSession());
    expect(browserAnnotationSnapshot(keyA)?.screenshot).not.toBeNull();
    expect(browserAnnotationSnapshot(keyA)?.navigationEpoch).toBe(8);
  });

  it("replaces a stale record when a new epoch writes instead of merging into it", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    setBrowserAnnotationElements(keyA, 7, elementsSession());
    expect(browserAnnotationSnapshot(keyA)?.elements).not.toBeNull();

    markBrowserAnnotationEpoch(keyA, 8);
    setBrowserAnnotationScreenshot(keyA, 8, screenshotSession());

    const record = browserAnnotationSnapshot(keyA);
    expect(record?.navigationEpoch).toBe(8);
    expect(record?.elements).toBeNull();
    expect(record?.screenshot).not.toBeNull();
  });

  it("closes screenshot and element sessions independently", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    setBrowserAnnotationElements(keyA, 7, elementsSession());
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());

    setBrowserAnnotationScreenshot(keyA, 7, null);
    const afterScreenshotClose = browserAnnotationSnapshot(keyA);
    expect(afterScreenshotClose?.screenshot).toBeNull();
    expect(afterScreenshotClose?.elements?.pageSnapshotUrl).toBe(
      "data:image/jpeg;base64,page",
    );

    setBrowserAnnotationElements(keyA, 7, null);
    expect(browserAnnotationSnapshot(keyA)).toBeNull();
  });

  it("keeps an untouched session reference stable across writes", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    setBrowserAnnotationElements(keyA, 7, elementsSession());
    const elementsRef = browserAnnotationSnapshot(keyA)?.elements;

    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    expect(browserAnnotationSnapshot(keyA)?.elements).toBe(elementsRef);
  });

  it("removes the whole record when a tab closes and rejects late writes", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    markBrowserAnnotationEpoch(keyD, 7);
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    setBrowserAnnotationScreenshot(keyD, 7, screenshotSession());

    clearBrowserAnnotationRecordsForTab("tab-a");

    expect(browserAnnotationSnapshot(keyA)).toBeNull();
    expect(browserAnnotationSnapshot(keyD)?.screenshot).not.toBeNull();

    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    expect(browserAnnotationSnapshot(keyA)).toBeNull();
  });

  it("bulk-removes records for a deleted thread only", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    markBrowserAnnotationEpoch(keyB, 7);
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    setBrowserAnnotationScreenshot(keyB, 7, screenshotSession());

    clearBrowserAnnotationRecordsForThread("thread-a");

    expect(browserAnnotationSnapshot(keyA)).toBeNull();
    expect(browserAnnotationSnapshot(keyB)?.screenshot).not.toBeNull();

    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    expect(browserAnnotationSnapshot(keyA)).toBeNull();
  });

  it("bulk-removes records for a deleted environment only", () => {
    markBrowserAnnotationEpoch(keyA, 7);
    markBrowserAnnotationEpoch(keyC, 7);
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    setBrowserAnnotationScreenshot(keyC, 7, screenshotSession());

    clearBrowserAnnotationRecordsForEnvironment("env-2");

    expect(browserAnnotationSnapshot(keyA)?.screenshot).not.toBeNull();
    expect(browserAnnotationSnapshot(keyC)).toBeNull();

    setBrowserAnnotationScreenshot(keyC, 7, screenshotSession());
    expect(browserAnnotationSnapshot(keyC)).toBeNull();
  });

  it("never writes annotation data to localStorage", () => {
    expect(window.localStorage.length).toBe(0);
    markBrowserAnnotationEpoch(keyA, 7);
    setBrowserAnnotationScreenshot(keyA, 7, screenshotSession());
    setBrowserAnnotationElements(keyA, 7, elementsSession());
    expect(window.localStorage.length).toBe(0);
    const persistedKeys = Object.keys(window.localStorage);
    expect(
      persistedKeys.some((key) => key.includes("browser-annotation")),
    ).toBe(false);
  });
});
