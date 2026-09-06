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
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { AppToaster } from "@/components/AppToaster";
import { appToast } from "@/components/ui/app-toast";
import { BrowserTabContent } from "./BrowserTabContent";
import { createBrowserViewVisibilityCoordinator } from "./browserViewVisibilityCoordinator";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";

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

function createBrowserChromeHarness(
  runPageScript?: BbDesktopBrowserApi["experimental_runBrowserPageScript"],
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
    experimental_trustLocalhostCertificate: (request: {
      tabId: string;
      expectedNavigationEpoch: number;
    }) => {
      trustLocalhostCertificate(request);
      return Promise.resolve({
        navigationEpoch: request.expectedNavigationEpoch,
        trustedOrigin: "localhost",
      });
    },
    ...(runPageScript
      ? {
          experimental_browserControlVersion: 2 as const,
          experimental_runBrowserPageScript: runPageScript,
        }
      : {}),
    ...(capturePage
      ? {
          experimental_browserControlVersion: 2 as const,
          experimental_captureBrowserPage: capturePage,
          experimental_readBrowserCaptureChunk: (readRequest: {
            captureId: string;
            tabId: string;
            offset: number;
            length: number;
          }) =>
            Promise.resolve({
              captureId: readRequest.captureId,
              offset: 0,
              base64: "c2NyZWVuc2hvdC1ieXRlcw==",
              eof: true,
            }),
          experimental_releaseBrowserCapture: (releaseRequest: {
            captureId: string;
            tabId: string;
          }): Promise<void> => Promise.resolve(),
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
function renderBrowserChrome(
  harness: BrowserChromeHarness,
  initialUrl = "",
  options: {
    canHandleBrowserCommands?: boolean;
    canShowNativeBrowserView?: boolean;
    onNativeFocus?: () => void;
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--ring");
    window.localStorage.clear();
    resetPluginSlotStoreForTest();
    delete window.bbDesktop;
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
      expect(sendPointerInput).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
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
      ),
    );
    expect(sendPointerInput).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedNavigationEpoch: 7,
        events: [{ deltaX: 0, deltaY: 80, type: "mouseWheel", x: 40, y: 40 }],
        tabId: "browser:test",
      }),
    );
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
          navigationEpoch: 7,
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
          navigationEpoch: 7,
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
      expectedNavigationEpoch: 7,
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
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:toast");
    const capturePage = vi.fn().mockResolvedValue({
      captureId: "cap-toast",
      format: "png",
      byteLength: 16,
      navigationEpoch: 7,
      pixelSize: { height: 600, width: 800 },
    });
    const harness = createBrowserChromeHarness(undefined, capturePage);
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
      ).toBe("blob:toast"),
    );
    await waitFor(() =>
      expect(harness.setVisible).toHaveBeenLastCalledWith({
        tabId: "browser:test",
        visible: false,
      }),
    );
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

  it.each(["Stop", "Take over"])(
    "releases native control with %s",
    async (action) => {
      const harness = createBrowserChromeHarness();
      const releaseControl = vi.fn();
      harness.api.releaseControl = releaseControl;
      harness.api.getControl = async () => ({
        tabId: "browser:test",
        threadId: "thread-1",
        control: {
          leaseId: "lease-1",
          controllerLabel: "Browser agent",
          expiresAt: Date.now() + 60_000,
        },
      });
      renderBrowserChrome(harness, "https://example.com/docs");
      const button = await screen.findByRole("button", {
        name: action,
      });
      harness.focus.mockClear();
      fireEvent.click(button);
      expect(releaseControl).toHaveBeenCalledWith("browser:test");
      if (action === "Take over")
        expect(harness.focus).toHaveBeenCalledWith("browser:test");
      else expect(harness.focus).not.toHaveBeenCalled();
    },
  );

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

  it("passes Browser actions passive tab identity only", () => {
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
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    act(() => harness.emitState(browserState({ navigationEpoch: 2 })));

    expect(slotProps).toEqual({
      tabId: "browser:test",
      navigationEpoch: 2,
      threadId: "thread-1",
      projectId: "project-1",
      url: "https://example.com/docs",
    });
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
});
