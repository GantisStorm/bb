// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
const clipboardMock = vi.hoisted(() => ({
  copyToClipboardWithToast: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast: clipboardMock.copyToClipboardWithToast,
}));

import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { AppToaster } from "@/components/AppToaster";
import { appToast } from "@/components/ui/app-toast";
import { BrowserTabContent } from "./BrowserTabContent";
import { BrowserCookieImportWizard } from "./BrowserCookieImportWizard";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { setBrowserCookieImportRecord } from "@/lib/browser-cookie-import-state";
import {
  browserAnnotationSnapshot,
  resetBrowserAnnotationStore,
} from "./browserAnnotationState";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

interface BrowserChromeHarness {
  api: BbDesktopBrowserApi;
  emitState: (state: BbDesktopBrowserState) => void;
  emitSnapshot: (snapshot: { dataUrl: string | null; tabId: string }) => void;
  emitNativeFocus: (tabId: string) => void;
  focus: ReturnType<typeof vi.fn>;
  goBack: ReturnType<typeof vi.fn>;
  trustLocalhostCertificate: Mock;
  stop: ReturnType<typeof vi.fn>;
  setBounds: Mock;
  setVisible: ReturnType<typeof vi.fn>;
}
interface BrowserCookieImportHarness {
  importCookiesFromBrowser: NonNullable<
    BbDesktopBrowserApi["experimental_importCookiesFromBrowser"]
  >;
  listCookieImportSources: NonNullable<
    BbDesktopBrowserApi["experimental_listCookieImportSources"]
  >;
}

function createBrowserChromeHarness(
  runPageScript?: BbDesktopBrowserApi["experimental_runBrowserPageScript"],
  cookieImportHarness?: BrowserCookieImportHarness,
  capturePage?: NonNullable<
    BbDesktopBrowserApi["experimental_captureBrowserPage"]
  >,
): BrowserChromeHarness {
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const focusListeners = new Set<(tabId: string) => void>();
  const snapshotListeners = new Set<
    (snapshot: { dataUrl: string | null; tabId: string }) => void
  >();
  const focus = vi.fn();
  const goBack = vi.fn();
  const stop = vi.fn();
  const setBounds = vi.fn();
  const setVisible = vi.fn();
  const trustLocalhostCertificate = vi.fn();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    focus,
    stop,
    setBounds,
    setVisible,
    experimental_trustLocalhostCertificate: trustLocalhostCertificate,
    ...(runPageScript
      ? {
          experimental_browserPageRuntimeVersion: 1 as const,
          experimental_runBrowserPageScript: runPageScript,
        }
      : {}),
    ...(cookieImportHarness
      ? {
          experimental_importCookies: vi
            .fn()
            .mockResolvedValue({ importedCookies: 0 }),
          experimental_importCookiesFromBrowser:
            cookieImportHarness.importCookiesFromBrowser,
          experimental_listCookieImportSources:
            cookieImportHarness.listCookieImportSources,
        }
      : {}),
    ...(capturePage
      ? {
          experimental_captureBrowserPage: capturePage,
        }
      : {}),
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onFocus(listener) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };
  return {
    api,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    emitSnapshot(snapshot) {
      for (const listener of snapshotListeners) listener(snapshot);
    },
    emitNativeFocus(tabId) {
      for (const listener of focusListeners) listener(tabId);
    },
    focus,
    goBack,
    stop,
    setBounds,
    setVisible,
    trustLocalhostCertificate,
  };
}

function registrationSet(
  browserActions: PluginRegistrationSet["browserActions"],
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    browserActions,
  };
}

function browserState(
  overrides: Partial<BbDesktopBrowserState> = {},
): BbDesktopBrowserState {
  return {
    tabId: "browser:test",
    url: "https://example.com/docs",
    title: "Example docs",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}
interface BrowserPickerResult {
  navigationEpoch: number;
  requestId: string;
  value: null;
}

interface PendingBrowserPicker {
  promise: Promise<BrowserPickerResult>;
  reject(reason?: unknown): void;
}

function createPendingBrowserPicker(): PendingBrowserPicker {
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<BrowserPickerResult>((_resolve, nextReject) => {
    reject = nextReject;
  });
  return { promise, reject };
}

function renderBrowserChrome(
  harness: BrowserChromeHarness,
  initialUrl = "",
  options: {
    canHandleBrowserCommands?: boolean;
    canShowNativeBrowserView?: boolean;
    onNativeFocus?: () => void;
    onSelectionAddToChat?: (text: string) => void;
    threadId?: string;
    tabId?: string;
    environmentId?: string | null;
  } = {},
) {
  window.bbDesktop = createBbDesktopApi(desktopInfo, harness.api);
  return render(
    <TooltipProvider delayDuration={0}>
      <BrowserTabContent
        tabId={options.tabId ?? "browser:test"}
        initialUrl={initialUrl}
        addressFocusRequest={null}
        onSelectionAddToChat={options.onSelectionAddToChat}
        canHandleBrowserCommands={options.canHandleBrowserCommands}
        canShowNativeBrowserView={options.canShowNativeBrowserView ?? false}
        onNativeFocus={options.onNativeFocus}
        visibilityCoordinator={createBrowserViewVisibilityCoordinator(
          harness.api,
        )}
        environmentId={options.environmentId ?? null}
        threadId={options.threadId ?? "thread-1"}
        projectId="project-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </TooltipProvider>,
  );
}

function expectChromeVisible(): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe("expanded");
  return chrome;
}

describe("BrowserTabContent persistent navigation", () => {
  afterEach(() => {
    cleanup();
    clipboardMock.copyToClipboardWithToast.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--ring");
    window.localStorage.clear();
    setBrowserCookieImportRecord(null);
    resetBrowserAnnotationStore();
    resetPluginSlotStoreForTest();
    delete window.bbDesktop;
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "setPointerCapture");
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "hasPointerCapture");
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "releasePointerCapture");
  });

  it("keeps the top navigation visible through pointer and focus changes", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    const chrome = expectChromeVisible();

    fireEvent.pointerLeave(chrome);
    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    expectChromeVisible();
    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
  });
  it("forwards native viewport input while browser chrome remains in the renderer", async () => {
    const harness = createBrowserChromeHarness();
    const sendPointerInput = vi.fn().mockResolvedValue({
      dispatched: 1,
      navigationEpoch: 7,
    });
    harness.api.experimental_sendBrowserPointerInput = sendPointerInput;
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));
    const viewport = document.querySelector<HTMLDivElement>(
      "[data-browser-viewport]",
    );
    if (viewport === null) {
      throw new Error("Expected browser viewport.");
    }
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(100, 80, 500, 350),
    });

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 140,
      clientY: 120,
      detail: 1,
      pointerType: "mouse",
    });
    fireEvent.wheel(viewport, {
      clientX: 140,
      clientY: 120,
      deltaX: 0,
      deltaY: 80,
    });

    await waitFor(() =>
      expect(sendPointerInput).toHaveBeenNthCalledWith(1, {
        expectedNavigationEpoch: 7,
        events: [
          {
            button: "left",
            clickCount: 1,
            type: "mouseDown",
            x: 40,
            y: 40,
          },
        ],
        tabId: "browser:test",
      }),
    );
    expect(sendPointerInput).toHaveBeenLastCalledWith({
      expectedNavigationEpoch: 7,
      events: [{ deltaX: 0, deltaY: 80, type: "mouseWheel", x: 40, y: 40 }],
      tabId: "browser:test",
    });
    expect(harness.focus).toHaveBeenCalledWith("browser:test");
  });

  it("restores the renderer while a resize snapshot replaces the native view", async () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));

    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    act(() =>
      harness.emitSnapshot({
        dataUrl: "data:image/jpeg;base64,resize",
        tabId: "browser:test",
      }),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    act(() => harness.emitSnapshot({ dataUrl: null, tabId: "browser:test" }));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
  });


  it("removes the native hit target before rendering recovery actions", async () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://localhost:8443/", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    harness.setBounds.mockClear();
    harness.setVisible.mockClear();

    act(() =>
      harness.emitState(
        browserState({
          errorText: "ERR_CERT_AUTHORITY_INVALID",
          url: "https://localhost:8443/",
        }),
      ),
    );

    await waitFor(() =>
      expect(harness.setBounds).toHaveBeenLastCalledWith({
        bounds: { height: 0, width: 0, x: 0, y: 0 },
        tabId: "browser:test",
      }),
    );
  });
  it("trusts a loopback certificate only from the recovery action", async () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://localhost:8443/", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });

    act(() =>
      harness.emitState(
        browserState({
          errorText: "ERR_CERT_AUTHORITY_INVALID",
          url: "https://localhost:8443/",
        }),
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Trust and reload" }),
    );

    expect(
      document.querySelector("[data-browser-load-error]")?.className,
    ).toContain("z-10");
    expect(harness.trustLocalhostCertificate).toHaveBeenCalledWith({
      tabId: "browser:test",
    });
  });
  it("hides the native view while another thread is active and restores it on return", async () => {
    const harness = createBrowserChromeHarness();
    const threadA = renderBrowserChrome(harness, "https://example.com/a", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      tabId: "browser:thread-a",
      threadId: "thread-a",
    });
    act(() =>
      harness.emitState(
        browserState({ tabId: "browser:thread-a", navigationEpoch: 7 }),
      ),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:thread-a",
        visible: true,
      }),
    );

    threadA.unmount();
    expect(harness.setVisible).toHaveBeenLastCalledWith({
      tabId: "browser:thread-a",
      visible: false,
    });

    const threadB = renderBrowserChrome(harness, "https://example.com/b", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      tabId: "browser:thread-b",
      threadId: "thread-b",
    });
    act(() =>
      harness.emitState(
        browserState({ tabId: "browser:thread-b", navigationEpoch: 7 }),
      ),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:thread-b",
        visible: true,
      }),
    );

    threadB.unmount();
    const restoredThreadA = renderBrowserChrome(
      harness,
      "https://example.com/a",
      {
        canHandleBrowserCommands: true,
        canShowNativeBrowserView: true,
        tabId: "browser:thread-a",
        threadId: "thread-a",
      },
    );
    act(() =>
      harness.emitState(
        browserState({ tabId: "browser:thread-a", navigationEpoch: 7 }),
      ),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:thread-a",
        visible: true,
      }),
    );
    restoredThreadA.unmount();
  });

  it("uses a page snapshot while a toast overlays the native browser", async () => {
    vi.stubGlobal(
      "Image",
      class {
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    const capturePage = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,toast-stand-in",
      navigationEpoch: 7,
      pixelSize: { height: 600, width: 800 },
    });
    const harness = createBrowserChromeHarness(
      undefined,
      undefined,
      capturePage,
    );
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    render(<AppToaster position="bottom-right" />);
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    const annotateButton = await screen.findByRole("button", {
      name: "Annotate screenshot",
    });
    expect(annotateButton.hasAttribute("disabled")).toBe(false);

    act(() => {
      appToast.success("Object copied", { duration: 50 });
    });

    expect(await screen.findByText("Object copied")).not.toBeNull();
    await waitFor(() => expect(capturePage).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        document
          .querySelector("[data-browser-toast-snapshot]")
          ?.getAttribute("src"),
      ).toBe("data:image/png;base64,toast-stand-in"),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    expect(annotateButton.hasAttribute("disabled")).toBe(false);
    await waitFor(
      () =>
        expect(harness.setVisible).toHaveBeenLastCalledWith({
          tabId: "browser:test",
          visible: true,
        }),
      { timeout: 1_000 },
    );
    expect(document.querySelector("[data-browser-toast-snapshot]")).toBeNull();
  });

  it("keeps the native view visible until a screenshot overlay is decoded", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    let finishDecode: (() => void) | null = null;
    const decodePromise = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    vi.stubGlobal(
      "Image",
      class {
        public src = "";
        decode(): Promise<void> {
          return decodePromise;
        }
      },
    );
    const capturePage = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,screenshot",
      navigationEpoch: 7,
      pixelSize: { height: 600, width: 800 },
    });
    const harness = createBrowserChromeHarness(
      undefined,
      undefined,
      capturePage,
    );
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));
    const annotateButton = await screen.findByRole("button", {
      name: "Annotate screenshot",
    });
    await waitFor(() =>
      expect(annotateButton.hasAttribute("disabled")).toBe(false),
    );

    fireEvent.click(annotateButton);
    await waitFor(() => expect(capturePage).toHaveBeenCalledOnce());
    expect(harness.setVisible).toHaveBeenLastCalledWith({
      tabId: "browser:test",
      visible: true,
    });

    act(() => finishDecode?.());
    await screen.findByRole("region", { name: "Screenshot annotation" });
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
  });

  it("keeps navigation visible while loading and preserves the stop action", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    act(() => harness.emitState(browserState({ isLoading: true })));
    expectChromeVisible();

    const stopButton = screen.getByRole("button", { name: "Stop loading" });
    fireEvent.click(stopButton);
    expect(harness.stop).toHaveBeenCalledWith("browser:test");
  });

  it("preserves browser navigation actions", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    expectChromeVisible();

    act(() => harness.emitState(browserState({ canGoBack: true })));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(harness.goBack).toHaveBeenCalledWith("browser:test");
  });

  it("imports cookies from a detected desktop browser profile", async () => {
    const listCookieImportSources = vi.fn().mockResolvedValue({
      sources: [
        {
          family: "chrome" as const,
          label: "Google Chrome",
          profiles: [{ id: "Default", label: "Default" }],
        },
      ],
    });
    const importCookiesFromBrowser = vi
      .fn()
      .mockResolvedValue({ importedCookies: 2 });
    const harness = createBrowserChromeHarness(undefined, {
      importCookiesFromBrowser,
      listCookieImportSources,
    });
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState()));
    const importButton = await screen.findByRole("button", {
      name: "Import browser session",
    });
    expect(importButton.textContent).toContain("Import");
    fireEvent.click(importButton);
    await screen.findByRole("region", { name: "Import browser session" });
    expect(
      screen
        .getByRole("listitem", { name: "Choose source" })
        .getAttribute("aria-current"),
    ).toBe("step");
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    const importFromChrome = await screen.findByRole("button", {
      name: /Google Chrome/,
    });
    expect(listCookieImportSources).toHaveBeenCalledWith({
      tabId: "browser:test",
    });

    fireEvent.click(importFromChrome);
    expect(
      screen
        .getByRole("listitem", { name: "Review import" })
        .getAttribute("aria-current"),
    ).toBe("step");
    await screen.findByText("Review this import");
    fireEvent.click(screen.getByRole("button", { name: "Import session" }));
    await waitFor(() =>
      expect(importCookiesFromBrowser).toHaveBeenCalledWith({
        family: "chrome",
        profileId: "Default",
        tabId: "browser:test",
      }),
    );
    await screen.findByText("Imported 2 cookies from Google Chrome");
    fireEvent.click(
      screen.getByRole("button", { name: "Close import wizard" }),
    );
    expect(
      screen.queryByRole("region", { name: "Import browser session" }),
    ).toBeNull();
    expect(
      screen.queryByText("Imported 2 cookies from Google Chrome"),
    ).toBeNull();
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
  });

  it("announces cookie import failures with the destructive status treatment", () => {
    render(
      <BrowserCookieImportWizard
        currentImport={null}
        isClearing={false}
        isImporting={false}
        isLoadingSources={false}
        message="Could not import browser session"
        messageTone="error"
        onClose={vi.fn()}
        onClear={vi.fn()}
        onImportFromBrowser={vi.fn()}
        onImportFromFile={vi.fn()}
        sources={[]}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Could not import browser session");
    expect(alert.className).toContain("text-destructive");
  });

  it("shows the current import and offers clear or overwrite actions", () => {
    const onClear = vi.fn();
    const onImportFromBrowser = vi.fn();
    render(
      <BrowserCookieImportWizard
        currentImport={{
          family: "chrome",
          importedCookies: 42,
          kind: "browser",
          profileId: "Default",
          profileLabel: "Person 1",
          sourceLabel: "Google Chrome",
        }}
        isClearing={false}
        isImporting={false}
        isLoadingSources={false}
        message={null}
        messageTone={null}
        onClear={onClear}
        onClose={vi.fn()}
        onImportFromBrowser={onImportFromBrowser}
        onImportFromFile={vi.fn()}
        sources={[]}
      />,
    );

    const currentImport = screen.getByRole("region", {
      name: "Currently imported session",
    });
    expect(currentImport.textContent).toContain("42 cookies");
    fireEvent.click(screen.getByRole("button", { name: "Clear import" }));
    expect(onClear).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Reimport" }));
    fireEvent.click(screen.getByRole("button", { name: "Reimport session" }));
    expect(onImportFromBrowser).toHaveBeenCalledWith("chrome", "Default");
  });

  it("restores native focus to the logical pane and reports page focus", async () => {
    const harness = createBrowserChromeHarness();
    const onNativeFocus = vi.fn();
    renderBrowserChrome(harness, "https://example.com/docs", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      onNativeFocus,
    });

    act(() => harness.emitState(browserState()));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    act(() => harness.emitNativeFocus("browser:other"));
    expect(onNativeFocus).not.toHaveBeenCalled();
    act(() => harness.emitNativeFocus("browser:test"));
    expect(onNativeFocus).toHaveBeenCalledTimes(1);
  });

  it("binds generic page scripts to the exact Browser tab", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    const runPageScript = vi.fn(async (request) => ({
      requestId: request.requestId,
      navigationEpoch: 2,
      value: { title: "Docs" },
    }));
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        {
          id: "inspect",
          title: "Inspect page",
          component: (props) => {
            slotProps = props;
            return <button type="button">Inspect page</button>;
          },
        },
      ]),
    );
    const harness = createBrowserChromeHarness(runPageScript);
    renderBrowserChrome(harness, "https://example.com/docs");
    act(() => harness.emitState(browserState({ navigationEpoch: 2 })));

    const controller = new AbortController();
    const capturedProps = slotProps as PluginBrowserActionProps | null;
    expect(capturedProps).not.toBeNull();
    await expect(
      capturedProps!.experimental_runPageContentScript(
        {
          expectedNavigationEpoch: 2,
          source: "() => ({ title: document.title })",
          input: { intent: "inspect" },
        },
        { signal: controller.signal },
      ),
    ).resolves.toEqual({
      navigationEpoch: 2,
      value: { title: "Docs" },
    });
    expect(runPageScript).toHaveBeenCalledWith(
      {
        tabId: "browser:test",
        expectedNavigationEpoch: 2,
        requestId: expect.any(String),
        source: "() => ({ title: document.title })",
        input: { intent: "inspect" },
        timeoutMs: 30_000,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(capturedProps!.experimental_pageContentScriptsAvailable).toBe(true);
  });

  it("rejects clearly when the desktop page-runtime capability is missing", async () => {
    let slotProps: PluginBrowserActionProps | null = null;
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        {
          id: "inspect",
          title: "Inspect page",
          component: (props) => {
            slotProps = props;
            return <button type="button">Inspect page</button>;
          },
        },
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    await expect(
      slotProps!.experimental_runPageContentScript(
        { expectedNavigationEpoch: 2, source: "() => null" },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({
      name: "ExperimentalBrowserPageScriptsUnavailableError",
      message: expect.stringMatching(/newer BB desktop app/),
    });
  });

  it("suppresses and restores the native view for a plugin overlay", async () => {
    function OverlayAction(props: PluginBrowserActionProps) {
      return (
        <>
          <button
            type="button"
            aria-label="Open inspector"
            onClick={() => props.experimental_setOverlayOpen(true)}
          />
          <button
            type="button"
            aria-label="Close inspector"
            onClick={() => props.experimental_setOverlayOpen(false)}
          />
        </>
      );
    }
    setPluginSlotRegistrations(
      "context",
      registrationSet([
        { id: "inspect", title: "Inspect page", component: OverlayAction },
      ]),
    );
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs", {
      canShowNativeBrowserView: true,
    });

    act(() => harness.emitState(browserState()));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open inspector" }));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: true,
      }),
    );
  });

  it("contains a crashing Browser action without losing native controls", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      registrationSet([
        {
          id: "broken",
          title: "Broken",
          component: () => {
            throw new Error("broken action");
          },
        },
      ]),
    );
    setPluginSlotRegistrations(
      "working",
      registrationSet([
        {
          id: "working",
          title: "Working",
          component: () => <button type="button" aria-label="Working action" />,
        },
      ]),
    );
    renderBrowserChrome(
      createBrowserChromeHarness(),
      "https://example.com/docs",
    );

    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Working action" }),
    ).not.toBeNull();
  });
  it("collects element annotations and sends one sanitized batch to chat", async () => {
    const runPageScript = vi.fn(async (request) => ({
      requestId: request.requestId,
      navigationEpoch: 7,
      value: {
        accessibility: {
          description: null,
          name: "Purchase a subscription",
          role: "button",
        },
        ancestorPath: ["main", "body"],
        dom: {
          attributes: { role: "button" },
          classes: ["purchase"],
          id: "subscribe",
          selector: "button#subscribe",
          tag: "button",
        },
        editable: false,
        fullDomPath: "body > main > button#subscribe",
        html: '<button id="subscribe">Purchase a subscription</button>',
        reactComponents: "<PurchaseButton> <Pricing>",
        sourceFile: "/app/frontend/src/pricing.tsx:42:3",
        rect: { height: 32, width: 180, x: 24, y: 48 },
        capturedAt: "2026-08-31T00:00:00.000Z",
        devicePixelRatio: 2,
        nearbyElements: [],
        rectPage: { height: 32, width: 180, x: 24, y: 48 },
        scroll: { x: 0, y: 0 },
        selectedText: null,
        styles: {
          backgroundColor: "rgb(0, 0, 0)",
          color: "rgb(255, 255, 255)",
          display: "inline-flex",
          fontSize: "14px",
          fontWeight: "600",
          opacity: "1",
          position: "relative",
        },
        text: "Purchase a subscription",
        title: "Pricing",
        url: "https://example.com/pricing?checkout=secret#plans",
        viewport: { height: 900, width: 1440 },
      },
    }));
    vi.stubGlobal(
      "Image",
      class {
        public naturalHeight = 900;
        public naturalWidth = 1440;
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    const canvasContext = Object.create(null);
    canvasContext.drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,clipped-element",
    );
    const capturePage = vi.fn().mockResolvedValue({
      dataUrl: "data:image/jpeg;base64,full-page",
      navigationEpoch: 7,
      pixelSize: { height: 900, width: 1440 },
    });
    const onSelectionAddToChat = vi.fn();
    const harness = createBrowserChromeHarness(
      runPageScript,
      undefined,
      capturePage,
    );
    renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      onSelectionAddToChat,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));
    document.documentElement.style.setProperty("--ring", "rgb(12, 34, 56)");

    const pickerButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(pickerButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(pickerButton);
    await screen.findByRole("dialog", { name: "Add page annotation" });
    const addPreview = screen.getByAltText("Selected page element");
    expect(addPreview.getAttribute("src")).toBe(
      "data:image/jpeg;base64,clipped-element",
    );
    expect(screen.getByText("button#subscribe")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Move this CTA above the fold." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(runPageScript).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedNavigationEpoch: 7,
          source: expect.stringContaining("removeAllRanges"),
          tabId: "browser:test",
          timeoutMs: 5_000,
          world: "isolated",
        }),
        {},
      ),
    );

    await screen.findByRole("complementary", { name: "Page annotations" });
    const annotationTray = screen.getByRole("complementary", {
      name: "Page annotations",
    });
    expect(annotationTray.className).toContain("absolute");
    expect(annotationTray.className).toContain("right-3");
    expect(annotationTray.className).toContain("bottom-3");
    const browserViewport = document.querySelector("[data-browser-viewport]");
    expect(browserViewport?.className).toContain("inset-0");
    expect(browserViewport?.className).not.toContain("right-88");
    fireEvent.click(screen.getByRole("button", { name: "Add annotation" }));
    await screen.findByRole("dialog", { name: "Add page annotation" });
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Why is this action disabled?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Question" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("2 annotations")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit annotation 1" }));
    await screen.findByRole("dialog", { name: "Edit page annotation" });
    const editPreview = screen.getByAltText("Selected page element");
    expect(editPreview.getAttribute("src")).toBe(
      "data:image/jpeg;base64,clipped-element",
    );
    expect(screen.getByText("button#subscribe")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Move this CTA beneath the plan details." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(runPageScript).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser:test",
        input: {
          fillColor: "color-mix(in oklab, rgb(12, 34, 56) 14%, transparent)",
          outlineColor: "rgb(12, 34, 56)",
        },
        world: "isolated",
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      expect.stringContaining("## Design Feedback: /pricing"),
    );
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      expect.stringContaining("**Intent:** change"),
    );
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      expect.stringContaining("**Intent:** question"),
    );
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      expect.stringContaining(
        "**Feedback:** Move this CTA beneath the plan details.",
      ),
    );
    expect(onSelectionAddToChat).toHaveBeenCalledWith(
      expect.stringContaining("**URL:** https://example.com/pricing"),
    );
    expect(onSelectionAddToChat).not.toHaveBeenCalledWith(
      expect.stringContaining("checkout=secret"),
    );
  });

  it("copies a selected element without opening a side panel", async () => {
    const runPageScript = vi.fn(async (request) => ({
      requestId: request.requestId,
      navigationEpoch: 7,
      value: {
        accessibility: { description: null, name: "Purchase", role: "button" },
        ancestorPath: ["main", "body"],
        dom: {
          attributes: { role: "button" },
          classes: [],
          id: "purchase",
          selector: "button#purchase",
          tag: "button",
        },
        editable: false,
        fullDomPath: "body > main > button#purchase",
        html: '<button id="purchase">Purchase</button>',
        reactComponents: "<PurchaseButton> <Pricing>",
        sourceFile: "/app/frontend/src/pricing.tsx:42:3",
        rect: { height: 32, width: 120, x: 24, y: 48 },
        capturedAt: "2026-08-31T00:00:00.000Z",
        devicePixelRatio: 2,
        nearbyElements: [],
        rectPage: { height: 32, width: 120, x: 24, y: 48 },
        scroll: { x: 0, y: 0 },
        selectedText: null,
        styles: {
          backgroundColor: "rgb(0, 0, 0)",
          color: "rgb(255, 255, 255)",
          display: "inline-flex",
          fontSize: "14px",
          fontWeight: "600",
          opacity: "1",
          position: "relative",
        },
        text: "Purchase",
        title: "Pricing",
        url: "https://example.com/pricing",
        viewport: { height: 900, width: 1440 },
      },
    }));
    const harness = createBrowserChromeHarness(runPageScript);
    renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));

    const grabButton = await screen.findByRole("button", {
      name: "Grab page element",
    });
    await waitFor(() =>
      expect(grabButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(grabButton);

    await waitFor(() =>
      expect(clipboardMock.copyToClipboardWithToast).toHaveBeenCalledWith(
        expect.stringContaining(
          "Attached browser context from https://example.com/pricing",
        ),
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "Grabbed page element" }),
    ).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Page annotations" }),
    ).toBeNull();
  });

  it("cancels only the active annotation picker and removes its page overlay", async () => {
    const selected = createPendingBrowserPicker();
    const runPageScript = vi.fn(
      (
        request: { source: string },
        options: { signal?: AbortSignal } = {},
      ): Promise<BrowserPickerResult> => {
        if (request.source.includes("__bbBrowserElementPickerCleanup?.()")) {
          return Promise.resolve({
            navigationEpoch: 7,
            requestId: "cleanup",
            value: null,
          });
        }
        options.signal?.addEventListener("abort", () => {
          selected.reject(new DOMException("cancelled", "AbortError"));
        });
        return selected.promise;
      },
    );
    const harness = createBrowserChromeHarness(runPageScript);
    renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));

    const annotateButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(annotateButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(annotateButton);

    expect(
      screen.getByRole("button", { name: "Cancel element annotation" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Grab page element" }),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel element annotation" }),
    );

    await waitFor(() =>
      expect(runPageScript).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.stringContaining(
            "__bbBrowserElementPickerCleanup?.()",
          ),
        }),
        {},
      ),
    );
    expect(
      screen.getByRole("button", {
        name: "Select and annotate page element",
      }),
    ).not.toBeNull();
  });

  it("cancels the picker when the Browser page changes", async () => {
    const selected = createPendingBrowserPicker();
    let pickerSignal: AbortSignal | null = null;
    const runPageScript = vi.fn(
      (
        _request: unknown,
        options: { signal?: AbortSignal } = {},
      ): Promise<BrowserPickerResult> => {
        if (options.signal !== undefined) pickerSignal = options.signal;
        pickerSignal?.addEventListener("abort", () => {
          selected.reject(new DOMException("cancelled", "AbortError"));
        });
        return selected.promise;
      },
    );
    const harness = createBrowserChromeHarness(runPageScript);
    renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));

    const pickerButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(pickerButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(pickerButton);
    act(() =>
      harness.emitState(
        browserState({
          navigationEpoch: 8,
          url: "https://example.com/two",
        }),
      ),
    );

    await waitFor(() => expect(pickerSignal?.aborted).toBe(true));
  });
  it("cancels the picker when its tab closes", async () => {
    const selected = createPendingBrowserPicker();
    let pickerSignal: AbortSignal | null = null;
    const runPageScript = vi.fn(
      (
        request: { source: string },
        options: { signal?: AbortSignal } = {},
      ): Promise<BrowserPickerResult> => {
        if (request.source.includes("__bbBrowserElementPickerCleanup?.()")) {
          return Promise.resolve({
            navigationEpoch: 7,
            requestId: "cleanup",
            value: null,
          });
        }
        pickerSignal = options.signal ?? null;
        pickerSignal?.addEventListener("abort", () => {
          selected.reject(new DOMException("cancelled", "AbortError"));
        });
        return selected.promise;
      },
    );
    const harness = createBrowserChromeHarness(runPageScript);
    const view = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
    });
    act(() => harness.emitState(browserState({ navigationEpoch: 7 })));

    const pickerButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(pickerButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(pickerButton);
    view.unmount();

    await waitFor(() => expect(pickerSignal?.aborted).toBe(true));
  });
  it("restores the screenshot annotation across a thread switch without a second capture", async () => {
    vi.stubGlobal(
      "Image",
      class {
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "releasePointerCapture",
      { configurable: true, value: vi.fn() },
    );
    const capturePage = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,thread-a-shot",
      navigationEpoch: 7,
      pixelSize: { height: 600, width: 800 },
    });
    const harness = createBrowserChromeHarness(undefined, undefined, capturePage);

    const viewA = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    const annotateButton = await screen.findByRole("button", {
      name: "Annotate screenshot",
    });
    await waitFor(() =>
      expect(annotateButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(annotateButton);
    await screen.findByRole("region", { name: "Screenshot annotation" });
    expect(capturePage).toHaveBeenCalledOnce();

    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 12,
      clientY: 12,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 48, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(false);

    viewA.unmount();
    const viewB = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-b",
      tabId: "browser:tab-b",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-b" }),
      ),
    );
    expect(
      screen.queryByRole("region", { name: "Screenshot annotation" }),
    ).toBeNull();
    expect(capturePage).toHaveBeenCalledOnce();

    viewB.unmount();
    const viewA2 = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    await screen.findByRole("region", { name: "Screenshot annotation" });
    expect(capturePage).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Arrow" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled"),
    ).toBe(true);
    viewA2.unmount();
  });

  it("restores the page-element review draft and tray across a thread switch", async () => {
    const capture = {
      accessibility: { description: null, name: "Purchase", role: "button" },
      ancestorPath: ["main", "body"],
      dom: {
        attributes: { role: "button" },
        classes: [],
        id: "purchase",
        selector: "button#purchase",
        tag: "button",
      },
      editable: false,
      fullDomPath: "body > main > button#purchase",
      html: '<button id="purchase">Purchase</button>',
      reactComponents: "<PurchaseButton> <Pricing>",
      sourceFile: "/app/frontend/src/pricing.tsx:42:3",
      rect: { height: 32, width: 120, x: 24, y: 48 },
      capturedAt: "2026-08-31T00:00:00.000Z",
      devicePixelRatio: 2,
      nearbyElements: [],
      rectPage: { height: 32, width: 120, x: 24, y: 48 },
      scroll: { x: 0, y: 0 },
      selectedText: null,
      styles: {
        backgroundColor: "rgb(0, 0, 0)",
        color: "rgb(255, 255, 255)",
        display: "inline-flex",
        fontSize: "14px",
        fontWeight: "600",
        opacity: "1",
        position: "relative",
      },
      text: "Purchase",
      title: "Pricing",
      url: "https://example.com/pricing",
      viewport: { height: 900, width: 1440 },
    };
    const runPageScript = vi.fn(async (request) => ({
      requestId: request.requestId,
      navigationEpoch: 7,
      value: capture,
    }));
    vi.stubGlobal(
      "Image",
      class {
        public naturalHeight = 900;
        public naturalWidth = 1440;
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    const canvasContext = Object.create(null);
    canvasContext.drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,clipped-element",
    );
    const capturePage = vi.fn().mockResolvedValue({
      dataUrl: "data:image/jpeg;base64,full-page",
      navigationEpoch: 7,
      pixelSize: { height: 900, width: 1440 },
    });
    const harness = createBrowserChromeHarness(
      runPageScript,
      undefined,
      capturePage,
    );

    const viewA = renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    const pickerButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(pickerButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(pickerButton);
    await screen.findByRole("dialog", { name: "Add page annotation" });
    const preview = screen.getByAltText("Selected page element");
    expect(preview.getAttribute("src")).toBe(
      "data:image/jpeg;base64,clipped-element",
    );
    expect(screen.getByText("button#purchase")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Move the CTA above the fold." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));

    viewA.unmount();
    const viewB = renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-b",
      tabId: "browser:tab-b",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-b" }),
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "Add page annotation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Page annotations" }),
    ).toBeNull();

    viewB.unmount();
    const viewA2 = renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    await screen.findByRole("dialog", { name: "Add page annotation" });
    const restoredPreview = screen.getByAltText("Selected page element");
    expect(restoredPreview.getAttribute("src")).toBe(
      "data:image/jpeg;base64,clipped-element",
    );
    expect(screen.getByText("button#purchase")).not.toBeNull();
    const feedback = screen.getByLabelText(
      "Feedback",
    ) as HTMLTextAreaElement;
    expect(feedback.value).toBe("Move the CTA above the fold.");
    expect(
      screen.getByRole("button", { name: "Fix" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("complementary", { name: "Page annotations" });

    viewA2.unmount();
    const viewA3 = renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    await screen.findByRole("complementary", { name: "Page annotations" });
    expect(screen.getByText("1 annotation")).not.toBeNull();
    expect(screen.getByText("Move the CTA above the fold.")).not.toBeNull();
    viewA3.unmount();
  });

  it("aborts a pending picker on thread switch and never restarts it", async () => {
    const picker = { signal: null as AbortSignal | null };
    const cleanupCalls: Array<{
      expectedNavigationEpoch: number;
      tabId: string;
    }> = [];
    const runPageScript = vi.fn(
      (
        request: { source: string; tabId: string; expectedNavigationEpoch: number },
        options: { signal?: AbortSignal } = {},
      ): Promise<BrowserPickerResult> => {
        if (request.source.includes("__bbBrowserElementPickerCleanup?.()")) {
          cleanupCalls.push({
            expectedNavigationEpoch: request.expectedNavigationEpoch,
            tabId: request.tabId,
          });
          return Promise.resolve({
            navigationEpoch: request.expectedNavigationEpoch,
            requestId: "cleanup",
            value: null,
          });
        }
        const pending = createPendingBrowserPicker();
        picker.signal = options.signal ?? null;
        picker.signal?.addEventListener("abort", () => {
          pending.reject(new DOMException("cancelled", "AbortError"));
        });
        return pending.promise;
      },
    );
    const harness = createBrowserChromeHarness(runPageScript);

    const viewA = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    const annotateButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(annotateButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(annotateButton);
    await waitFor(() => expect(picker.signal).not.toBeNull());
    const firstSignal = picker.signal;

    viewA.unmount();
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    expect(cleanupCalls).toEqual([
      { expectedNavigationEpoch: 7, tabId: "browser:tab-a" },
    ]);

    const viewA2 = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    const grabButton = await screen.findByRole("button", {
      name: "Grab page element",
    });
    await waitFor(() =>
      expect(grabButton.hasAttribute("disabled")).toBe(false),
    );
    const pickerCallsBeforeGrab = runPageScript.mock.calls.length;
    fireEvent.click(grabButton);
    await waitFor(() =>
      expect(runPageScript.mock.calls.length).toBe(pickerCallsBeforeGrab + 1),
    );
    const secondSignal = picker.signal;
    viewA2.unmount();
    await waitFor(() => expect(secondSignal?.aborted).toBe(true));
    expect(cleanupCalls).toHaveLength(2);
    expect(cleanupCalls[1]).toEqual({
      expectedNavigationEpoch: 7,
      tabId: "browser:tab-a",
    });

    const callsAfterReturn = runPageScript.mock.calls.length;
    const viewA3 = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Select and annotate page element" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(
      screen.queryByRole("button", { name: "Cancel element annotation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Cancel element selection" }),
    ).toBeNull();
    expect(runPageScript.mock.calls.length).toBe(callsAfterReturn);
    viewA3.unmount();
  });

  it("drops stored screenshot sessions on navigation and rejects stale captures", async () => {
    let finishCapture:
      | ((result: {
          dataUrl: string;
          navigationEpoch: number;
          pixelSize: { height: number; width: number };
        }) => void)
      | null = null;
    const pendingCapture = new Promise<{
      dataUrl: string;
      navigationEpoch: number;
      pixelSize: { height: number; width: number };
    }>((resolve) => {
      finishCapture = resolve;
    });
    const capturePage = vi.fn().mockImplementationOnce(() => pendingCapture);
    vi.stubGlobal(
      "Image",
      class {
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    const harness = createBrowserChromeHarness(undefined, undefined, capturePage);

    const view = renderBrowserChrome(harness, "https://example.com/one", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    const annotateButton = await screen.findByRole("button", {
      name: "Annotate screenshot",
    });
    await waitFor(() =>
      expect(annotateButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(annotateButton);
    await waitFor(() => expect(capturePage).toHaveBeenCalledOnce());

    act(() =>
      harness.emitState(
        browserState({
          navigationEpoch: 8,
          tabId: "browser:tab-a",
          url: "https://example.com/two",
        }),
      ),
    );
    expect(
      screen.queryByRole("region", { name: "Screenshot annotation" }),
    ).toBeNull();

    await act(async () => {
      finishCapture?.({
        dataUrl: "data:image/png;base64,stale-shot",
        navigationEpoch: 7,
        pixelSize: { height: 600, width: 800 },
      });
    });
    expect(
      screen.queryByRole("region", { name: "Screenshot annotation" }),
    ).toBeNull();
    expect(
      browserAnnotationSnapshot({
        environmentId: null,
        tabId: "browser:tab-a",
        threadId: "thread-a",
      }),
    ).toBeNull();

    view.unmount();
    const view2 = renderBrowserChrome(harness, "https://example.com/two", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({
          navigationEpoch: 8,
          tabId: "browser:tab-a",
          url: "https://example.com/two",
        }),
      ),
    );
    expect(
      screen.queryByRole("region", { name: "Screenshot annotation" }),
    ).toBeNull();
    expect(capturePage).toHaveBeenCalledOnce();
    view2.unmount();
  });

  it("drops the page-element tray when the URL changes and does not restore it", async () => {
    const runPageScript = vi.fn(async (request) => ({
      requestId: request.requestId,
      navigationEpoch: 7,
      value: {
        accessibility: { description: null, name: "Purchase", role: "button" },
        ancestorPath: ["main", "body"],
        dom: {
          attributes: { role: "button" },
          classes: [],
          id: "purchase",
          selector: "button#purchase",
          tag: "button",
        },
        editable: false,
        fullDomPath: "body > main > button#purchase",
        html: '<button id="purchase">Purchase</button>',
        reactComponents: "<PurchaseButton> <Pricing>",
        sourceFile: "/app/frontend/src/pricing.tsx:42:3",
        rect: { height: 32, width: 120, x: 24, y: 48 },
        capturedAt: "2026-08-31T00:00:00.000Z",
        devicePixelRatio: 2,
        nearbyElements: [],
        rectPage: { height: 32, width: 120, x: 24, y: 48 },
        scroll: { x: 0, y: 0 },
        selectedText: null,
        styles: {
          backgroundColor: "rgb(0, 0, 0)",
          color: "rgb(255, 255, 255)",
          display: "inline-flex",
          fontSize: "14px",
          fontWeight: "600",
          opacity: "1",
          position: "relative",
        },
        text: "Purchase",
        title: "Pricing",
        url: "https://example.com/pricing",
        viewport: { height: 900, width: 1440 },
      },
    }));
    vi.stubGlobal(
      "Image",
      class {
        public naturalHeight = 900;
        public naturalWidth = 1440;
        public src = "";
        async decode(): Promise<void> {}
      },
    );
    const canvasContext = Object.create(null);
    canvasContext.drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,clipped-element",
    );
    const capturePage = vi.fn().mockResolvedValue({
      dataUrl: "data:image/jpeg;base64,full-page",
      navigationEpoch: 7,
      pixelSize: { height: 900, width: 1440 },
    });
    const harness = createBrowserChromeHarness(
      runPageScript,
      undefined,
      capturePage,
    );

    const view = renderBrowserChrome(harness, "https://example.com/pricing", {
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      threadId: "thread-a",
      tabId: "browser:tab-a",
    });
    act(() =>
      harness.emitState(
        browserState({ navigationEpoch: 7, tabId: "browser:tab-a" }),
      ),
    );
    const pickerButton = await screen.findByRole("button", {
      name: "Select and annotate page element",
    });
    await waitFor(() =>
      expect(pickerButton.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(pickerButton);
    await screen.findByRole("dialog", { name: "Add page annotation" });
    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Why is this action disabled?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("complementary", { name: "Page annotations" });

    act(() =>
      harness.emitState(
        browserState({
          navigationEpoch: 7,
          tabId: "browser:tab-a",
          url: "https://example.com/pricing?page=two",
        }),
      ),
    );
    expect(
      screen.queryByRole("complementary", { name: "Page annotations" }),
    ).toBeNull();
    expect(
      browserAnnotationSnapshot({
        environmentId: null,
        tabId: "browser:tab-a",
        threadId: "thread-a",
      }),
    ).toBeNull();

    view.unmount();
    const view2 = renderBrowserChrome(
      harness,
      "https://example.com/pricing?page=two",
      {
        canHandleBrowserCommands: true,
        canShowNativeBrowserView: true,
        threadId: "thread-a",
        tabId: "browser:tab-a",
      },
    );
    act(() =>
      harness.emitState(
        browserState({
          navigationEpoch: 7,
          tabId: "browser:tab-a",
          url: "https://example.com/pricing?page=two",
        }),
      ),
    );
    expect(
      screen.queryByRole("complementary", { name: "Page annotations" }),
    ).toBeNull();
    view2.unmount();
  });
});
