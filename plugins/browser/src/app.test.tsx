/// <reference lib="es2024.promise" />
// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExperimentalBrowserControllerProps } from "@get-bb/plugin-sdk/app";
import { BrowserImportAction, BrowserImportController } from "./app";
import {
  browserCookieImportRecordSnapshot,
  setBrowserCookieImportRecord,
} from "./browser-cookie-import-state";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: (factory: unknown) => factory,
}));
afterEach(() => {
  cleanup();
  setBrowserCookieImportRecord(null);
  vi.unstubAllGlobals();
});

function mountImport() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  const lifecycle = new AbortController();
  const importFromBrowser = vi.fn(async () => ({ importedCookies: 2 }));
  const props: ExperimentalBrowserControllerProps = {
    target: {
      clientId: "client",
      windowId: "window",
      tabId: "tab",
      navigationEpoch: 1,
    },
    environmentId: null,
    threadId: "thread",
    projectId: null,
    url: "https://example.test",
    isVisible: true,
    experimental_browserControlAvailable: true,
    experimental_sessionImport: {
      listSources: async () => ({
        sources: [
          {
            family: "chrome",
            label: "Google Chrome",
            profiles: [{ id: "Default", label: "Default" }],
          },
        ],
      }),
      importCookies: async () => ({ importedCookies: 1 }),
      importFromBrowser,
      clear: async () => {},
    },
    experimental_lifecycleSignal: lifecycle.signal,
    experimental_onLifecycle: () => () => {},
    experimental_registerRequestHandler: () => () => {},
    experimental_capturePage: async () => {
      throw new Error("unused");
    },
    experimental_createImageResource: async () => {
      throw new Error("unused");
    },
    experimental_runBrowserPageScript: async () => {
      throw new Error("unused");
    },
    experimental_setOverlayOpen: vi.fn(),
    experimental_overlayRoot: document.body,
  };
  render(
    <>
      <BrowserImportController {...props} />
      <BrowserImportAction
        tabId="tab"
        navigationEpoch={1}
        threadId="thread"
        projectId={null}
        url={props.url}
      />
    </>,
  );
  return { lifecycle, importFromBrowser };
}

it("imports a profile from an empty record and clears the resulting provenance", async () => {
  mountImport();
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Google Chrome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import session" }));
  await waitFor(() =>
    expect(browserCookieImportRecordSnapshot()).toMatchObject({
      kind: "browser",
      family: "chrome",
      importedCookies: 2,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose another profile" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear import" }));
  await waitFor(() => expect(browserCookieImportRecordSnapshot()).toBeNull());
});

it("does not publish a pending import after its controller is disposed", async () => {
  const host = mountImport();
  const pending = Promise.withResolvers<{ importedCookies: number }>();
  host.importFromBrowser.mockImplementation(() => pending.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Google Chrome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import session" }));
  act(() => host.lifecycle.abort());
  await act(async () => {
    pending.resolve({ importedCookies: 2 });
  });
  expect(browserCookieImportRecordSnapshot()).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
