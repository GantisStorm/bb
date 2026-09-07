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
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
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
  vi.restoreAllMocks();
  setBrowserCookieImportRecord(null);
  vi.unstubAllGlobals();
});

function mountImport(
  overrides: Partial<
    NonNullable<
      ExperimentalBrowserControllerProps["experimental_sessionImport"]
    >
  > = {},
  compact = false,
) {
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
  const importCookies = vi.fn(async () => ({ importedCookies: 1 }));
  const clear = vi.fn(async () => {});
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
      importCookies,
      importFromBrowser,
      clear,
      ...overrides,
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
  const view = render(
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <BrowserImportController {...props} />
      <BrowserImportAction
        tabId="tab"
        navigationEpoch={1}
        threadId="thread"
        projectId={null}
        url={props.url}
      />
    </CompactViewportOverrideProvider>,
  );
  return { lifecycle, importFromBrowser, importCookies, clear, props, view };
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
  fireEvent.click(screen.getByRole("button", { name: "Close import wizard" }));
  expect(
    screen.queryByRole("dialog", { name: "Import browser session" }),
  ).toBeNull();
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    kind: "browser",
    importedCookies: 2,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Clear import" }));
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

it("keeps pending import results when closed and prevents reopening from restarting the operation", async () => {
  const host = mountImport();
  const pending = Promise.withResolvers<{ importedCookies: number }>();
  host.importFromBrowser.mockImplementation(() => pending.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Google Chrome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import session" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  expect(host.importFromBrowser).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close import wizard" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    pending.resolve({ importedCookies: 2 });
  });
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    kind: "browser",
    importedCookies: 2,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  const clearButton = await screen.findByRole("button", {
    name: "Clear import",
  });
  expect(clearButton).toHaveProperty("disabled", false);
});

it("closes with Escape during import without losing the committed result", async () => {
  const host = mountImport();
  const pending = Promise.withResolvers<{ importedCookies: number }>();
  host.importFromBrowser.mockImplementation(() => pending.promise);
  const trigger = screen.getByRole("button", {
    name: "Import browser session",
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: /Google Chrome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import session" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => {
    pending.resolve({ importedCookies: 2 });
  });
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    importedCookies: 2,
  });
});

it("does not reopen for stale profile results after closing while loading", async () => {
  const pending = Promise.withResolvers<{ sources: [] }>();
  mountImport({ listSources: () => pending.promise });
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  await screen.findByText("Finding browser profiles…");
  fireEvent.click(screen.getByRole("button", { name: "Close import wizard" }));
  await act(async () => {
    pending.resolve({ sources: [] });
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows an empty state when browser families contain no profiles", async () => {
  mountImport({
    listSources: async () => ({
      sources: [{ family: "chrome", label: "Chrome", profiles: [] }],
    }),
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  await screen.findByText("No local profiles found");
  expect(
    screen.getByRole("button", { name: /Import a cookie JSON file/ }),
  ).toHaveProperty("disabled", false);
});

it("preserves the prior session on failed reimport or clear and allows correction", async () => {
  setBrowserCookieImportRecord({
    kind: "browser",
    family: "chrome",
    profileId: "Default",
    profileLabel: "Default",
    sourceLabel: "Google Chrome",
    importedCookies: 4,
  });
  const host = mountImport();
  host.importFromBrowser.mockRejectedValueOnce(new Error("Profile is locked"));
  host.clear.mockRejectedValueOnce(new Error("Clear failed"));
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Reimport" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Choose another profile" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reimport" }));
  fireEvent.click(screen.getByRole("button", { name: "Reimport session" }));
  await screen.findByText("Profile is locked");
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    importedCookies: 4,
  });
  fireEvent.click(screen.getByRole("button", { name: "Reimport session" }));
  await waitFor(() =>
    expect(browserCookieImportRecordSnapshot()).toMatchObject({
      importedCookies: 2,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear import" }));
  await screen.findByText("Clear failed");
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    importedCookies: 2,
  });
  fireEvent.click(screen.getByRole("button", { name: "Clear import" }));
  await waitFor(() => expect(browserCookieImportRecordSnapshot()).toBeNull());
});

function chooseCookieFile(text: string, name = "cookies.json") {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Cookie JSON file"), {
    target: { files: [file] },
  });
}

it("imports files despite profile discovery failure and supports choosing a file again", async () => {
  const host = mountImport({
    listSources: async () => {
      throw new Error("Profile discovery denied");
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  await screen.findByText("Profile discovery denied");
  const input = screen.getByLabelText("Cookie JSON file");
  const filePicker = vi.spyOn(input, "click");
  fireEvent.click(
    screen.getByRole("button", { name: /Import a cookie JSON file/ }),
  );
  expect(filePicker).toHaveBeenCalledOnce();
  chooseCookieFile(
    JSON.stringify({
      cookies: [
        {
          name: "session",
          value: "fixture",
          domain: "example.test",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ],
    }),
  );
  await waitFor(() =>
    expect(browserCookieImportRecordSnapshot()).toMatchObject({
      kind: "file",
      fileName: "cookies.json",
      importedCookies: 1,
    }),
  );
  expect(host.importCookies).toHaveBeenCalledWith([
    expect.objectContaining({ value: "fixture", sameSite: "lax" }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Choose file again" }));
  expect(filePicker).toHaveBeenCalledTimes(2);
  chooseCookieFile(
    JSON.stringify([
      {
        name: "session",
        value: "",
        domain: "example.test",
        secure: false,
        httpOnly: false,
      },
    ]),
    "replacement.json",
  );
  await waitFor(() =>
    expect(browserCookieImportRecordSnapshot()).toMatchObject({
      fileName: "replacement.json",
    }),
  );
  expect(host.importCookies).toHaveBeenLastCalledWith([
    expect.objectContaining({ value: "" }),
  ]);
});

it("rejects malformed files without changing the existing session and recovers with a valid file", async () => {
  setBrowserCookieImportRecord({
    kind: "file",
    fileName: "existing.json",
    importedCookies: 5,
  });
  const host = mountImport();
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  chooseCookieFile("{broken");
  await screen.findByRole("alert");
  expect(host.importCookies).not.toHaveBeenCalled();
  chooseCookieFile(
    JSON.stringify([
      { name: "session", domain: "example.test", secure: true, httpOnly: true },
    ]),
  );
  await screen.findByText("Cookie 1 has no string value");
  expect(host.importCookies).not.toHaveBeenCalled();
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    fileName: "existing.json",
  });
  chooseCookieFile(
    JSON.stringify([
      {
        name: "session",
        value: "valid",
        domain: "example.test",
        secure: true,
        httpOnly: true,
      },
    ]),
  );
  await waitFor(() =>
    expect(browserCookieImportRecordSnapshot()).toMatchObject({
      fileName: "cookies.json",
      importedCookies: 1,
    }),
  );
});

it("keeps compact drawer import and close actions available", async () => {
  mountImport({}, true);
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Google Chrome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: /Google Chrome/ }));
  fireEvent.click(screen.getByRole("button", { name: "Import session" }));
  await waitFor(() =>
    expect(browserCookieImportRecordSnapshot()).toMatchObject({
      importedCookies: 2,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close import wizard" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  await screen.findByRole("button", { name: "Close import wizard" });
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    importedCookies: 2,
  });
});

it("does not start a native file import after disposal during file reading", async () => {
  const host = mountImport();
  const pending = Promise.withResolvers<string>();
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  const file = new File([], "cookies.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => pending.promise });
  fireEvent.change(screen.getByLabelText("Cookie JSON file"), {
    target: { files: [file] },
  });
  act(() => host.lifecycle.abort());
  await act(async () => {
    pending.resolve(
      JSON.stringify([
        {
          name: "session",
          value: "valid",
          domain: "example.test",
          secure: true,
          httpOnly: true,
        },
      ]),
    );
  });
  expect(host.importCookies).not.toHaveBeenCalled();
  expect(browserCookieImportRecordSnapshot()).toBeNull();
});

it("keeps file-import success visible when profile discovery fails later", async () => {
  const discovery = Promise.withResolvers<{ sources: [] }>();
  mountImport({ listSources: () => discovery.promise });
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  chooseCookieFile(
    JSON.stringify([
      {
        name: "session",
        value: "valid",
        domain: "example.test",
        secure: true,
        httpOnly: true,
      },
    ]),
  );
  await screen.findByText("Imported 1 cookie");
  await act(async () => {
    discovery.reject(new Error("Profile discovery denied"));
  });
  expect(screen.getByText("Imported 1 cookie")).not.toBeNull();
  expect(screen.getByText("Profile discovery denied")).not.toBeNull();
  expect(browserCookieImportRecordSnapshot()).toMatchObject({
    importedCookies: 1,
  });
});

it("records a completed clear even after the dialog is dismissed", async () => {
  setBrowserCookieImportRecord({
    kind: "file",
    fileName: "cookies.json",
    importedCookies: 5,
  });
  const host = mountImport();
  const pending = Promise.withResolvers<void>();
  host.clear.mockImplementation(() => pending.promise);
  fireEvent.click(
    screen.getByRole("button", { name: "Import browser session" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear import" }));
  fireEvent.click(screen.getByRole("button", { name: "Close import wizard" }));
  await act(async () => {
    pending.resolve();
  });
  expect(browserCookieImportRecordSnapshot()).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
