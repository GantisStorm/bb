import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserControlCancelMessage,
  BrowserControlRequestMessage,
  BrowserOpenTabRequestMessage,
  BrowserOpenTabResponseMessage,
} from "@bb/server-contract";

const socket = vi.hoisted(() => ({
  cancel: null as ((message: BrowserControlCancelMessage) => void) | null,
  connected: null as (() => void) | null,
  connectionState: "connected" as "connected" | "connecting" | "reconnecting",
  connectionStateChanged: null as (() => void) | null,
  openRequest: null as ((message: BrowserOpenTabRequestMessage) => void) | null,
  request: null as ((message: BrowserControlRequestMessage) => void) | null,
  sendBrowserClientState: vi.fn(),
  sendBrowserControlResponse: vi.fn(),
  sendBrowserOpenTabResponse:
    vi.fn<(message: BrowserOpenTabResponseMessage) => void>(),
}));

vi.mock("./ws", () => ({
  wsManager: {
    onBrowserControlCancel(
      listener: (message: BrowserControlCancelMessage) => void,
    ) {
      socket.cancel = listener;
      return () => undefined;
    },
    onBrowserOpenTabRequest(
      listener: (message: BrowserOpenTabRequestMessage) => void,
    ) {
      socket.openRequest = listener;
      return () => undefined;
    },
    onBrowserControlRequest(
      listener: (message: BrowserControlRequestMessage) => void,
    ) {
      socket.request = listener;
      return () => undefined;
    },
    onConnected(listener: () => void) {
      socket.connected = listener;
      return () => undefined;
    },
    onConnectionStateChange(listener: () => void) {
      socket.connectionStateChanged = listener;
      return () => undefined;
    },
    getConnectionState() {
      return socket.connectionState;
    },
    sendBrowserClientState: socket.sendBrowserClientState,
    sendBrowserControlResponse: socket.sendBrowserControlResponse,
    sendBrowserOpenTabResponse: socket.sendBrowserOpenTabResponse,
  },
}));

import {
  type BrowserControlOwnerRegistration,
  browserControlActivitySnapshot,
  registerBrowserControlOwner,
  registerBrowserControlTab,
  registerBrowserThreadOwnerActivator,
  subscribeBrowserControlActivity,
  waitForBrowserControlTab,
} from "./browser-control-client";

function request(overrides: Partial<BrowserControlRequestMessage> = {}) {
  const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
  const tab = state.tabs[0];
  return {
    type: "browser-control-request" as const,
    requestId: overrides.requestId ?? "request-a",
    target: {
      clientId: state.clientId,
      windowId: state.windowId,
      tabId: tab.tabId,
      navigationEpoch: tab.navigationEpoch,
    },
    action: overrides.action ?? {
      kind: "snapshot" as const,
      mode: "interactive" as const,
    },
    actionabilityPolicy: overrides.actionabilityPolicy ?? {
      timeoutMs: 1_000,
      pollIntervalMs: 50,
      stableFrameCount: 2,
    },
  };
}

describe("Browser control client", () => {
  beforeEach(() => {
    socket.connectionState = "connected";
    socket.sendBrowserClientState.mockClear();
    socket.sendBrowserControlResponse.mockClear();
    socket.sendBrowserOpenTabResponse.mockClear();
  });

  it("opens the first Browser tab through a registered panel owner", async () => {
    const stateBefore = socket.sendBrowserClientState.mock.calls.length;
    const openTab = vi.fn(async () => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId: "tab-first",
      navigationEpoch: 0,
    }));
    const registration = registerBrowserControlOwner({
      activateTab: vi.fn(async () => ({
        clientId: "client-a",
        windowId: "window-a",
        tabId: "tab-first",
        navigationEpoch: 0,
      })),
      closeTab: vi.fn(),
      active: true,
      openTab,
      ownerId: "owner-a",
      projectId: "project-a",
      threadId: "thread-a",
      tabs: [],
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
    expect(socket.sendBrowserClientState.mock.calls.length).toBe(
      stateBefore + 1,
    );
    expect(state).toMatchObject({
      tabs: [],
      owners: [
        {
          active: true,
          ownerId: "owner-a",
          projectId: "project-a",
          threadId: "thread-a",
        },
      ],
    });

    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "owner",
      requestId: "open-a",
      clientId: state.clientId,
      windowId: state.windowId,
      ownerId: "owner-a",
      url: "file:///Users/test/page.html",
    });

    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith({
        type: "browser-open-tab-response",
        requestId: "open-a",
        clientId: state.clientId,
        windowId: state.windowId,
        ownerId: "owner-a",
        ok: true,
        target: {
          clientId: "client-a",
          windowId: "window-a",
          tabId: "tab-first",
          navigationEpoch: 0,
        },
      }),
    );
    expect(openTab).toHaveBeenCalledWith("file:///Users/test/page.html");

    registration.dispose();
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({ owners: [] }),
    );
  });

  it("activates and mounts a requested thread before creating its first tab", async () => {
    const openTab = vi.fn(async () => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId: "tab-first",
      navigationEpoch: 0,
    }));
    let ownerRegistration: BrowserControlOwnerRegistration | undefined;
    const activate = vi.fn(async ({ projectId, threadId }) => {
      ownerRegistration = registerBrowserControlOwner({
        activateTab: vi.fn(),
        active: true,
        closeTab: vi.fn(),
        openTab,
        ownerId: `thread:${threadId}`,
        projectId,
        tabs: [],
        threadId,
      });
    });
    const activatorRegistration = registerBrowserThreadOwnerActivator({
      activate,
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];

    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "thread",
      requestId: "open-thread-a",
      clientId: state.clientId,
      windowId: state.windowId,
      threadId: "thread-a",
      projectId: "project-a",
      url: "https://example.test/thread-a",
    });

    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith({
        type: "browser-open-tab-response",
        requestId: "open-thread-a",
        clientId: state.clientId,
        windowId: state.windowId,
        ownerId: "thread:thread-a",
        ok: true,
        target: {
          clientId: "client-a",
          windowId: "window-a",
          tabId: "tab-first",
          navigationEpoch: 0,
        },
      }),
    );
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-a",
        threadId: "thread-a",
      }),
    );
    expect(openTab).toHaveBeenCalledWith("https://example.test/thread-a");

    ownerRegistration?.dispose();
    activatorRegistration.dispose();
  });

  it("cancels thread activation before a late owner can create a tab", async () => {
    const openTab = vi.fn();
    const activatorRegistration = registerBrowserThreadOwnerActivator({
      activate: vi.fn(async () => undefined),
    });
    const state = socket.sendBrowserClientState.mock.calls.at(-1)?.[0];
    socket.openRequest?.({
      type: "browser-open-tab-request",
      mode: "thread",
      requestId: "open-cancelled",
      clientId: state.clientId,
      windowId: state.windowId,
      threadId: "thread-late",
      projectId: "project-a",
      url: "https://example.test/late",
    });
    await vi.waitFor(() => expect(socket.cancel).not.toBeNull());
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "open-cancelled",
      reason: "timeout",
    });
    await vi.waitFor(() =>
      expect(socket.sendBrowserOpenTabResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "open-cancelled",
          ok: false,
          error: expect.objectContaining({ code: "AbortError" }),
        }),
      ),
    );

    const lateOwner = registerBrowserControlOwner({
      activateTab: vi.fn(),
      active: true,
      closeTab: vi.fn(),
      openTab,
      ownerId: "thread:thread-late",
      projectId: "project-a",
      tabs: [],
      threadId: "thread-late",
    });
    expect(openTab).not.toHaveBeenCalled();

    lateOwner.dispose();
    activatorRegistration.dispose();
  });

  it("advertises inactive owner tabs without making them actionable", () => {
    const registration = registerBrowserControlOwner({
      activateTab: vi.fn(),
      active: true,
      closeTab: vi.fn(),
      openTab: vi.fn(),
      ownerId: "owner-inactive",
      projectId: "project-a",
      tabs: [],
      threadId: "thread-a",
    });
    registration.updateTabs([
      {
        tabId: "tab-inactive",
        title: "Inactive",
        url: "https://inactive.example.test/",
      },
    ]);
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            tabId: "tab-inactive",
            connected: false,
            active: false,
            navigationEpoch: 0,
          }),
        ],
      }),
    );
    registration.dispose();
  });

  it("waits for native navigation state before returning a new target", async () => {
    const targetPromise = waitForBrowserControlTab("tab-ready");
    let settled = false;
    void targetPromise.then(() => {
      settled = true;
    });
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: { navigate: vi.fn() } as never,
      projectId: "project-a",
      state: {
        navigationEpoch: 0,
        tabId: "tab-ready",
        title: null,
        url: "https://example.test/",
      } as never,
      tabId: "tab-ready",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    registration.update({
      active: true,
      state: {
        navigationEpoch: 1,
        tabId: "tab-ready",
        title: "Ready",
        url: "https://example.test/",
      } as never,
      url: "https://example.test/",
    });
    await expect(targetPromise).resolves.toMatchObject({
      tabId: "tab-ready",
      navigationEpoch: 1,
    });
    registration.dispose();
  });

  it("runs tab lifecycle actions through a background thread owner", async () => {
    const openTab = vi.fn(async () => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId: "tab-sibling",
      navigationEpoch: 0,
    }));
    const activateTab = vi.fn(async (tabId: string) => ({
      clientId: "client-a",
      windowId: "window-a",
      tabId,
      navigationEpoch: 9,
    }));
    const closeTab = vi.fn();
    const ownerRegistration = registerBrowserControlOwner({
      activateTab,
      active: false,
      closeTab,
      openTab,
      ownerId: "owner-a",
      projectId: "project-a",
      threadId: "thread-a",
      tabs: [],
    });
    const tabRegistration = registerBrowserControlTab({
      active: false,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_closeBrowserTab: vi.fn(async () => ({
          navigationEpoch: 7,
        })),
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "open-sibling",
        action: { kind: "open-tab", url: "https://second.example.test/" },
      }),
    );

    await vi.waitFor(() =>
      expect(openTab).toHaveBeenCalledWith("https://second.example.test/"),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "open-sibling",
          ok: true,
          value: expect.objectContaining({ tabId: "tab-sibling" }),
        }),
      ),
    );
    socket.request?.(
      request({
        requestId: "activate-previous",
        action: { kind: "activate-tab", tabId: "tab-previous" },
      }),
    );
    await vi.waitFor(() =>
      expect(activateTab).toHaveBeenCalledWith("tab-previous"),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "activate-previous",
          ok: true,
          value: expect.objectContaining({
            tabId: "tab-previous",
            navigationEpoch: 9,
          }),
        }),
      ),
    );
    socket.request?.(
      request({
        requestId: "close-active",
        action: { kind: "close-tab" },
      }),
    );
    await vi.waitFor(() => expect(closeTab).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "close-active",
          ok: true,
          value: expect.objectContaining({
            closed: expect.objectContaining({ tabId: "tab-a" }),
          }),
        }),
      ),
    );

    tabRegistration.dispose();
    ownerRegistration.dispose();
  });

  it("publishes an exact tab target and runs a request through the isolated runtime", async () => {
    const run = vi.fn(
      async (_request: unknown, _options: { signal?: AbortSignal }) => ({
        requestId: "page-request",
        navigationEpoch: 7,
        value: { nodes: [{ name: "Invite member" }] },
      }),
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://fallback.test/",
    });

    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "browser-client-state",
        tabs: [
          expect.objectContaining({
            tabId: "tab-a",
            threadId: "thread-a",
            projectId: "project-a",
            navigationEpoch: 7,
          }),
        ],
      }),
    );

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      tabId: "tab-a",
      input: { kind: "snapshot", mode: "interactive" },
    });
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "request-a",
          ok: true,
          value: { nodes: [{ name: "Invite member" }] },
        }),
      ),
    );

    registration.update({
      active: false,
      state: {
        tabId: "tab-a",
        url: "https://example.test/next",
        title: "Next",
        navigationEpoch: 8,
      } as never,
      url: "https://example.test/next",
    });
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            url: "https://example.test/next",
            active: false,
            navigationEpoch: 8,
          }),
        ],
      }),
    );
    expect(
      socket.sendBrowserClientState.mock.calls
        .slice(0, -1)
        .some(
          (call) =>
            (call as unknown as [{ tabs: unknown[] }])[0].tabs.length === 0,
        ),
    ).toBe(false);

    registration.dispose();
    expect(socket.sendBrowserClientState).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabs: [] }),
    );
  });
  it("rejects blocked navigation before invoking the desktop bridge", async () => {
    const navigate = vi.fn();
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: { navigate } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });
    socket.request?.(
      request({
        requestId: "blocked-navigation",
        action: { kind: "navigate", url: "javascript:alert(1)" },
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "blocked-navigation",
          ok: false,
          error: expect.objectContaining({
            message: "Browser navigation URL is not allowed",
          }),
        }),
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
    registration.dispose();
  });

  it("lists, imports, and explicitly clears native browser profile cookies", async () => {
    const listCookieImportSources = vi.fn(async () => ({
      sources: [
        {
          family: "chrome",
          label: "Google Chrome",
          profiles: [{ id: "Default", label: "Default" }],
        },
      ],
    }));
    const importCookiesFromBrowser = vi.fn(async () => ({
      importedCookies: 12,
    }));
    const clearImportedCookies = vi.fn(async () => undefined);
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_clearImportedCookies: clearImportedCookies,
        experimental_importCookiesFromBrowser: importCookiesFromBrowser,
        experimental_listCookieImportSources: listCookieImportSources,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "list-cookie-sources",
        action: { kind: "list-cookie-import-sources" },
      }),
    );
    await vi.waitFor(() =>
      expect(listCookieImportSources).toHaveBeenCalledOnce(),
    );
    socket.request?.(
      request({
        requestId: "import-profile-cookies",
        action: {
          kind: "import-cookies-from-browser",
          family: "chrome",
          profileId: "Default",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(importCookiesFromBrowser).toHaveBeenCalledWith({
        tabId: "tab-a",
        family: "chrome",
        profileId: "Default",
      }),
    );
    socket.request?.(
      request({
        requestId: "clear-profile-cookies",
        action: { kind: "clear-imported-cookies", confirm: true },
      }),
    );
    await vi.waitFor(() =>
      expect(clearImportedCookies).toHaveBeenCalledWith({ tabId: "tab-a" }),
    );
    await vi.waitFor(() => {
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "import-profile-cookies",
          ok: true,
          value: { importedCookies: 12 },
        }),
      );
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "clear-profile-cookies",
          ok: true,
          value: { cleared: true },
        }),
      );
    });
    registration.dispose();
  });

  it("cancels one concurrent request and exposes visible per-tab activity", async () => {
    let observedSignal: AbortSignal | undefined;
    const run = vi.fn(
      async (_request: unknown, options: { signal?: AbortSignal }) => {
        observedSignal = options.signal;
        await new Promise((_resolve, reject) =>
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          ),
        );
        return null as never;
      },
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });
    const activity = vi.fn();
    const unsubscribe = subscribeBrowserControlActivity(activity);

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(browserControlActivitySnapshot("tab-a")).toBe(1);
    socket.cancel?.({
      type: "browser-control-cancel",
      requestId: "request-a",
      reason: "cancelled",
    });
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(browserControlActivitySnapshot("tab-a")).toBe(0),
    );
    expect(activity).toHaveBeenCalled();
    expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-a",
        ok: false,
        error: expect.objectContaining({ code: "AbortError" }),
      }),
    );

    unsubscribe();
    registration.dispose();
  });

  it("cancels active work when the Browser client disconnects", async () => {
    let observedSignal: AbortSignal | undefined;
    const run = vi.fn(
      async (_request: unknown, options: { signal?: AbortSignal }) => {
        observedSignal = options.signal;
        await new Promise((_resolve, reject) =>
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("disconnected", "AbortError")),
            { once: true },
          ),
        );
        return null as never;
      },
    );
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });

    socket.request?.(request());
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    socket.connectionState = "reconnecting";
    socket.connectionStateChanged?.();
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    await vi.waitFor(() =>
      expect(browserControlActivitySnapshot("tab-a")).toBe(0),
    );

    registration.dispose();
  });

  it("binds screenshots and explicit main-world scripts to one page revision", async () => {
    const run = vi.fn(async () => ({
      requestId: "page-request",
      navigationEpoch: 7,
      value: { component: "InviteButton" },
    }));
    const capture = vi.fn(async () => ({
      navigationEpoch: 7,
      dataUrl: "data:image/png;base64,aQ==",
      pixelSize: { width: 1200, height: 800 },
    }));
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
        experimental_captureBrowserPage: capture,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "script-request",
        action: {
          kind: "script",
          world: "main",
          source: "() => ({ component: 'InviteButton' })",
          input: null,
          timeoutMs: 1_000,
        },
      }),
    );
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "tab-a",
          world: "main",
          source: "() => ({ component: 'InviteButton' })",
        }),
        { signal: expect.any(AbortSignal) },
      ),
    );

    socket.request?.(
      request({
        requestId: "screenshot-request",
        action: { kind: "screenshot", format: "png" },
      }),
    );
    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        tabId: "tab-a",
        format: "png",
        quality: 85,
        expectedNavigationEpoch: 7,
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "screenshot-request",
          ok: true,
          value: expect.objectContaining({ navigationEpoch: 7 }),
        }),
      ),
    );

    registration.dispose();
  });

  it("checks through trusted native input without a DOM click fallback", async () => {
    const run = vi.fn(async () => ({
      requestId: "check-request",
      navigationEpoch: 7,
      value: {
        x: 120,
        y: 48,
        tag: "input",
        inputType: "checkbox",
        needsClick: true,
      },
    }));
    const sendTrusted = vi.fn(async () => ({ navigationEpoch: 7 }));
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
        experimental_sendBrowserTrustedInput: sendTrusted,
      } as never,
      projectId: "project-a",
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: "thread-a",
      url: "https://example.test/",
    });

    socket.request?.(
      request({
        requestId: "check-request",
        action: {
          kind: "check",
          locator: { selectors: ["input[type=checkbox]"] },
        },
      }),
    );

    await vi.waitFor(() =>
      expect(sendTrusted).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: "tab-a",
          expectedNavigationEpoch: 7,
          action: expect.objectContaining({ kind: "click", x: 120, y: 48 }),
        }),
        { signal: expect.any(AbortSignal) },
      ),
    );
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "check-request",
          ok: true,
          value: { checked: true, type: "checkbox" },
        }),
      ),
    );
    registration.dispose();
  });

  it("rejects a request for a stale navigation epoch", async () => {
    const run = vi.fn();
    const registration = registerBrowserControlTab({
      active: true,
      desktopBrowser: {
        navigate: vi.fn(),
        experimental_runBrowserPageScript: run,
      } as never,
      projectId: null,
      state: {
        tabId: "tab-a",
        url: "https://example.test/",
        title: "Example",
        navigationEpoch: 7,
      } as never,
      tabId: "tab-a",
      threadId: null,
      url: "https://example.test/",
    });
    const stale = request();
    const observedTarget = { ...stale.target, navigationEpoch: 7 };
    stale.target.navigationEpoch = 6;
    socket.request?.(stale);
    await vi.waitFor(() =>
      expect(socket.sendBrowserControlResponse).toHaveBeenCalledWith({
        type: "browser-control-response",
        requestId: "request-a",
        target: stale.target,
        observedTarget,
        ok: false,
        error: {
          code: "BrowserControlTargetChangedError",
          message: "The target Browser tab is no longer at that page revision",
        },
      }),
    );
    expect(run).not.toHaveBeenCalled();
    registration.dispose();
  });
});
