// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";

import type { rpcContract } from "./server";
import {
  COMPONENT_SPECIMENS,
  MOCK_VIEWS,
  OVERLAY_SPECIMENS,
  STYLESHEET_SPECIMEN_IDS,
} from "./taxonomy";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

type Catalog = Awaited<ReturnType<PluginRpcTestHandlers<typeof rpcContract>["themeCatalog"]>>;
const LINKED = { sidebarRow: "linked", shadowColor: { light: "linked", dark: "linked" } } as const;
const CUSTOM_LINKS = { sidebarRow: "custom", shadowColor: { light: "custom", dark: "linked" } } as const;

const DEFAULT_CATALOG: Catalog = {
  activeThemeId: "default",
  revision: 0,
  themes: [
    {
      id: "default",
      name: "Default",
      source: "builtin",
      light: null,
      dark: null,
      links: LINKED,
    },
    {
      id: "plugin:endless:endless-color",
      name: "Endless Color",
      source: "plugin",
      light: null,
      dark: null,
      links: LINKED,
    },
  ],
};

const ENDLESS_CATALOG: Catalog = {
  ...DEFAULT_CATALOG,
  activeThemeId: "plugin:endless:endless-color",
};

const LONG_THEME_NAME = "Endless Color copy with a deliberately descriptive name";
const LONG_NAME_CATALOG: Catalog = {
  activeThemeId: "long-theme",
  revision: 0,
  themes: [
    ...DEFAULT_CATALOG.themes,
    { id: "long-theme", name: LONG_THEME_NAME, source: "custom", light: null, dark: null, links: LINKED },
  ],
};

const FORKED_CATALOG: Catalog = {
  activeThemeId: "default-copy",
  revision: 1,
  themes: [
    ...DEFAULT_CATALOG.themes,
    { id: "default-copy", name: "Default copy", source: "custom", light: null, dark: null, links: LINKED },
  ],
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

let panel: Awaited<ReturnType<typeof loadPluginApp>>["navPanels"][number];

beforeAll(async () => {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  // Radix Select relies on pointer-capture and scroll APIs jsdom lacks.
  Object.assign(HTMLElement.prototype, {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
  const root = document.documentElement.style;
  const tokens: Record<string, string> = {
    canvas: "#ffffff", ink: "#222222", sidebar: "#f5f5f5", "sidebar-foreground": "#222222",
    primary: "#444444", "timeline-accent": "#4779a8", success: "#3b966c", warning: "#b56b2c",
    attention: "#c49a32", destructive: "#b6383f", "pr-merged": "#7550a8", "font-sans": "Inter, sans-serif",
    "font-mono": "Menlo, monospace", "text-sm": "13px", spacing: "4px", "tracking-normal": "0em",
    "bb-sidebar-row-height": "28px", "icon-stroke-width": "1.75", radius: "8px", "shadow-x": "0px",
    "shadow-y": "2px", "shadow-blur": "0px", "shadow-spread": "0px", "shadow-color": "#333333",
    "shadow-opacity": "0.15",
  };
  for (const [name, value] of Object.entries(tokens)) root.setProperty(`--${name}`, value);
  const app = await loadPluginApp(() => import("./app"));
  const registered = app.navPanels.find(({ id }) => id === "preview");
  if (!registered) throw new Error("Theme Preview panel was not registered");
  panel = registered;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  document.documentElement.classList.remove("dark");
  localStorage.removeItem("bb.theme");
});

type TestRpc = Omit<PluginRpcTestHandlers<typeof rpcContract>, "editTheme" | "undoThemeFork"> &
  Partial<Pick<PluginRpcTestHandlers<typeof rpcContract>, "editTheme" | "undoThemeFork">>;

function withEditHandler(rpc: TestRpc): PluginRpcTestHandlers<typeof rpcContract> {
  return {
    editTheme: ({ themeId, edit }) => ({
      catalog: DEFAULT_CATALOG,
      themeId,
      forkedFrom: null,
      undoToken: null,
      committedEdit: edit,
      adjustments: [],
      links: LINKED,
    }),
    undoThemeFork: () => DEFAULT_CATALOG,
    ...rpc,
  };
}

function renderPreview(rpc: TestRpc) {
  return renderSlot(panel, { subPath: "thread" }, { rpc: withEditHandler(rpc) });
}

function themeControl(): HTMLButtonElement {
  const control = document.querySelector<HTMLButtonElement>("[data-tp-theme-control]");
  if (!control) throw new Error("Theme picker control was not rendered");
  return control;
}

function openThemeMenu(): void {
  // Without a real pointer (jsdom), Radix's select takes its touch path:
  // the trigger opens and items commit on click.
  fireEvent.click(themeControl());
}

function pickOption(option: HTMLElement): void {
  fireEvent.click(option);
}

async function chooseEndlessDark(): Promise<void> {
  const control = themeControl();
  await waitFor(() => expect(control.textContent).toContain("Default"));
  // Selecting the theme is the one setTheme call these tests exercise; the
  // mode switch is a separate control with its own call.
  openThemeMenu();
  const options = await screen.findAllByRole("option");
  const endless = options.find((option) => option.textContent?.includes("Endless Color"));
  if (!endless) throw new Error("Endless Color option was not rendered");
  pickOption(endless);
}

describe("Theme Preview", () => {
  it("keeps the chrome free of implementation notes and personal identity", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      await waitFor(() => expect(document.querySelector("[data-tp-band=desktop]")).not.toBeNull());
      expect(screen.queryByText(/amber = sidebar override/i)).toBeNull();
      expect(screen.queryByText(/preview only/i)).toBeNull();
      expect(screen.queryByText(/live values/i)).toBeNull();
      expect(screen.queryByText(/theme applies live/i)).toBeNull();
      expect(screen.queryByText("brsbl")).toBeNull();
    } finally {
      width.mockRestore();
    }
  });

  it("navigates views with bb's tabs and offers themes with bb's select", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });

    const tabs = within(screen.getByRole("tablist", { name: "Preview view" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Thread", "New thread", "Split", "Settings"]);
    const threadTab = screen.getByRole("tab", { name: "Thread" });
    expect(threadTab.className).toContain("focus-visible:outline-none");
    expect(threadTab.className).toContain("focus-visible:ring-2");
    expect(threadTab.className).toContain("cursor-pointer");

    const control = themeControl();
    expect(control.getAttribute("role")).toBe("combobox");
    expect(control.className).toContain("focus:outline-none");
    expect(control.className).toContain("focus:ring-1");
  });

  it("keeps the thread table of contents open and interactive", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      const toc = await waitFor(() => {
        const found = document.querySelector<HTMLElement>("[data-tp-thread-toc]");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      const tabs = within(toc).getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent)).toEqual(["Agent", "You"]);
      expect(within(toc).getByRole("tab", { name: "You" }).getAttribute("aria-selected")).toBe("true");
      expect(within(toc).getByRole("button", { name: /Make the blacklight variant/i }).getAttribute("aria-current")).toBe("true");

      fireEvent.click(within(toc).getByRole("tab", { name: "Agent" }));
      const second = within(toc).getByRole("button", { name: /Selection now reads/i });
      fireEvent.click(second);
      expect(second.getAttribute("aria-current")).toBe("true");
    } finally {
      width.mockRestore();
    }
  });

  it("lists every theme in both modes as real select options", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });

    const control = themeControl();
    await waitFor(() => expect(control.textContent).toContain("Default"));
    // The mode switch carries the accessible labels instead of repeating them
    // per row. Checked before opening: an open select aria-hides the page.
    expect(screen.getByRole("button", { name: "Light mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Dark mode" }).getAttribute("aria-pressed")).toBe("false");
    openThemeMenu();

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    // One row per theme; mode is a separate switch, not a repeated label.
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.textContent)).toEqual(["Default", "Endless Color"]);
    expect(listbox.textContent).not.toMatch(/light|dark/i);
    const active = options.find((option) => option.getAttribute("aria-selected") === "true");
    expect(active?.textContent).toContain("Default");
  });

  it("keeps short names intrinsic and truncates long names only at the available-width boundary", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      const short = renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      await waitFor(() => expect(themeControl().textContent).toContain("Default"));
      const shortControl = themeControl();
      expect(shortControl.style.width).toBe("fit-content");
      expect(shortControl.style.maxWidth).toBe("100%");
      expect(shortControl.className).not.toContain("max-w-52");
      expect(document.querySelector<HTMLElement>("[data-tp-theme-picker-row]")?.style.width).toBe("fit-content");
      short.lifecycle.unmount();
      cleanup();

      width.mockReturnValue(360);
      renderPreview({
        themeCatalog: () => LONG_NAME_CATALOG,
        setTheme: () => LONG_NAME_CATALOG,
      });

      await waitFor(() => expect(document.querySelector("[data-tp-band=mobile]")).not.toBeNull());
      const longControl = await screen.findByRole("combobox", { name: new RegExp(LONG_THEME_NAME) });
      const longName = document.querySelector<HTMLElement>("[data-tp-theme-name]");
      expect(longName?.textContent).toBe(LONG_THEME_NAME);
      expect(longName?.style.textOverflow).toBe("ellipsis");
      expect(longName?.style.minWidth).toBe("0px");
      expect(longControl.className).toContain("overflow-hidden");
      expect(document.querySelector<HTMLElement>("[data-tp-theme-picker-row]")?.style.maxWidth).toBe("100%");
    } finally {
      width.mockRestore();
    }
  });

  it("uses light and dark icons while preserving keyboard mode selection", async () => {
    const selections: Array<{ themeId: string; mode: "light" | "dark" }> = [];
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: (selection) => {
        selections.push(selection);
        return DEFAULT_CATALOG;
      },
    });

    await screen.findByRole("combobox", { name: /Default light/i });
    const light = screen.getByRole("button", { name: "Light mode" });
    const dark = screen.getByRole("button", { name: "Dark mode" });
    expect(light.querySelector('[data-tp-mode-icon="light"]')).not.toBeNull();
    expect(dark.querySelector('[data-tp-mode-icon="dark"]')).not.toBeNull();
    expect(light.getAttribute("aria-pressed")).toBe("true");
    expect(dark.getAttribute("aria-pressed")).toBe("false");

    dark.focus();
    expect(document.activeElement).toBe(dark);
    fireEvent.click(dark, { detail: 0 });
    await waitFor(() => expect(selections).toEqual([{ themeId: "default", mode: "dark" }]));
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    expect(light.getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("bb.theme")).toBe("dark");

    light.focus();
    fireEvent.click(light, { detail: 0 });
    await waitFor(() => expect(selections).toEqual([
      { themeId: "default", mode: "dark" },
      { themeId: "default", mode: "light" },
    ]));
    expect(light.getAttribute("aria-pressed")).toBe("true");
    expect(dark.getAttribute("aria-pressed")).toBe("false");
  });

  it("restacks the main areas on mobile without a standalone derived-values inventory", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      await waitFor(() => expect(document.querySelector("[data-tp-band=mobile]")).not.toBeNull());
      expect(screen.queryByRole("button", { name: /full style guide/i })).toBeNull();
      // The compact interaction areas stay together before the style sheet.
      const areas = [...document.querySelectorAll("[data-tp-area]")].map((el) => el.getAttribute("data-tp-area"));
      expect(areas).toEqual(["mock", "overlays", "components", "stylesheet"]);
      expect(screen.queryByText("Derived values")).toBeNull();
      expect(document.querySelector("[data-tp-derived-values]")).toBeNull();
      expect(document.querySelector("[data-tp-derived=radius-ladder]")).toBeNull();
      expect(document.querySelector("[data-tp-shadow-preview]")).toBeNull();
    } finally {
      width.mockRestore();
    }
  });

  it("renders the complete taxonomy inventory at desktop widths", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });
      await waitFor(() => expect(document.querySelector("[data-tp-band=desktop]")).not.toBeNull());

      // Area 1: one tab per mock view.
      for (const view of MOCK_VIEWS) {
        expect(screen.getByRole("tab", { name: view.label })).toBeDefined();
      }
      // Area 2: every style-sheet specimen is one discrete, targetable element.
      expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
      expect(document.querySelector("[data-tp-editor-tier=advanced]")).not.toBeNull();
      for (const specimenId of STYLESHEET_SPECIMEN_IDS) {
        expect(
          document.querySelectorAll(`[data-tp-specimen="${specimenId}"]`),
          specimenId,
        ).toHaveLength(1);
      }
      // Area 3: every static component block renders.
      for (const specimen of COMPONENT_SPECIMENS) {
        expect(document.querySelector(`[data-tp-block="${specimen.id}"]`), specimen.id).not.toBeNull();
      }
      // The mock already carries representative sidebar rows; there is no
      // redundant standalone thread-list card in the rail.
      expect(document.querySelector("[data-tp-thread-list]")).toBeNull();
      // Area 4: every overlay has its launcher (in the rail at this width).
      for (const overlay of OVERLAY_SPECIMENS) {
        expect(screen.getByRole("button", { name: overlay.label })).toBeDefined();
      }
    } finally {
      width.mockRestore();
    }
  });

  it("keeps shadow color solid when the source shadow token is translucent", async () => {
    const root = document.documentElement.style;
    const previous = root.getPropertyValue("--shadow-color");
    root.setProperty("--shadow-color", "#3333331a");
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      const input = await waitFor(() => {
        const found = screen.getByLabelText("Shadow color") as HTMLInputElement;
        expect(found.disabled).toBe(false);
        return found;
      });
      expect(input.value).toBe("#222222");
    } finally {
      root.setProperty("--shadow-color", previous);
    }
  });

  it("commits an active-mode color family, announces the durable fork, and undoes only that copy", async () => {
    const pending = deferred<Awaited<ReturnType<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>>>();
    const undoPending = deferred<Awaited<ReturnType<PluginRpcTestHandlers<typeof rpcContract>["undoThemeFork"]>>>();
    const edits: Parameters<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>[0][] = [];
    const undoCalls: Parameters<PluginRpcTestHandlers<typeof rpcContract>["undoThemeFork"]>[0][] = [];
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
      editTheme: (input) => {
        edits.push(input);
        return pending.promise;
      },
      undoThemeFork: (input) => {
        undoCalls.push(input);
        return undoPending.promise;
      },
    });

    const canvas = await waitFor(() => {
      const input = screen.getByLabelText("Canvas color") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.value).toBe("#ffffff");
      return input;
    });

    fireEvent.change(canvas, { target: { value: "#112233" } });
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({
      themeId: "default",
      mode: "light",
      edit: {
        kind: "colors",
        target: "canvas",
        canvas: "#112233",
        ink: "#222222",
        sidebar: "#f5f5f5",
        sidebarForeground: "#222222",
        primary: "#444444",
        timelineAccent: "#4779a8",
        success: "#3b966c",
        warning: "#b56b2c",
        attention: "#c49a32",
        destructive: "#b6383f",
        prMerged: "#7550a8",
      },
    });

    expect(canvas.disabled).toBe(true);
    expect(canvas.className).toContain("disabled:opacity-100");
    expect((screen.getByRole("combobox", { name: /Saving Default/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("combobox", { name: /Saving Default/i }).className).toContain("disabled:opacity-100");
    expect(edits).toHaveLength(1);

    await act(async () => pending.resolve({
      catalog: FORKED_CATALOG,
      themeId: "default-copy",
      forkedFrom: "default",
      undoToken: "ec0ce536-87aa-49a8-908c-f0a4a99d3b40",
      committedEdit: edits[0]!.edit,
      adjustments: [],
      links: LINKED,
    }));

    expect(await screen.findByRole("combobox", { name: /Default copy/i })).toBeDefined();
    expect(document.querySelector("[data-tp-save-feedback=saved]")?.textContent).toContain("Saved");
    const notice = await screen.findByRole("button", { name: "Theme copy created: Default copy. Press Enter or Space to undo" });
    notice.focus();
    expect(document.activeElement).toBe(notice);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("Created Default copy");
    expect(tooltip.textContent).toContain("Default is unchanged");
    expect(toast.success).not.toHaveBeenCalled();

    const undo = within(tooltip).getByRole("button", { name: "Undo" });
    fireEvent.click(notice, { detail: 0 });
    expect(undoCalls).toEqual([{ undoToken: "ec0ce536-87aa-49a8-908c-f0a4a99d3b40" }]);
    expect((within(tooltip).getByRole("button", { name: "Undoing…" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => undoPending.resolve(DEFAULT_CATALOG));
    expect(await screen.findByRole("combobox", { name: /Default light/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Theme copy created/i })).toBeNull();
    expect(document.querySelector("[data-tp-fork-status]")?.textContent).toContain("Removed Default copy. Restored Default.");
  });

  it("rolls back only the failed control and retries the same edit inline", async () => {
    const calls: Parameters<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>[0][] = [];
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
      editTheme: (input) => {
        calls.push(input);
        if (calls.length === 1) throw new Error("write failed");
        return {
          catalog: { ...DEFAULT_CATALOG, revision: 1 },
          themeId: input.themeId,
          forkedFrom: null,
          undoToken: null,
          committedEdit: input.edit,
          adjustments: [],
          links: LINKED,
        };
      },
    });

    const canvas = await waitFor(() => {
      const input = screen.getByLabelText("Canvas color") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      return input;
    });
    fireEvent.change(canvas, { target: { value: "#112233" } });

    expect((await screen.findByRole("alert")).textContent).toContain("Couldn’t save");
    expect(screen.getByRole("alert").textContent).toContain("write failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByLabelText("Canvas color") as HTMLInputElement).value).toBe("#ffffff"));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual(calls[0]);
    await waitFor(() => expect((screen.getByLabelText("Canvas color") as HTMLInputElement).value).toBe("#112233"));
    expect(document.querySelector("[data-tp-save-feedback=saved]")?.textContent).toContain("Saved");
  });

  it("shows authoritative projections and keeps their explanation available", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
      editTheme: (input) => {
        if (input.edit.kind !== "colors") throw new Error("Expected a color edit");
        const committedEdit = { ...input.edit, primary: "#111111" };
        return {
          catalog: { ...DEFAULT_CATALOG, revision: 1 },
          themeId: input.themeId,
          forkedFrom: null,
          undoToken: null,
          committedEdit,
          adjustments: [{
            control: "color:primary",
            label: "Primary",
            scope: "light" as const,
            from: input.edit.primary,
            to: committedEdit.primary,
            invariant: "Primary controls stays at 4.5:1 or better",
          }],
          links: LINKED,
        };
      },
    });

    const canvas = await waitFor(() => {
      const input = screen.getByLabelText("Canvas color") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      return input;
    });
    fireEvent.change(canvas, { target: { value: "#9fa2a8" } });

    const details = await screen.findByRole("button", { name: "Saved with 1 automatic adjustment. Show details" });
    expect((screen.getByLabelText("Canvas color") as HTMLInputElement).value).toBe("#9fa2a8");
    expect((screen.getByLabelText("Primary color") as HTMLInputElement).value).toBe("#111111");
    fireEvent.click(details);
    const popover = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-tp-adjustment-details]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(popover.textContent).toContain("Primary");
    expect(popover.textContent).toContain("#444444 → #111111");
    expect(popover.textContent).toContain("4.5:1 or better");
  });

  it("restores durable Sidebar row and mode-specific Shadow color links", async () => {
    let catalog: Catalog = {
      ...DEFAULT_CATALOG,
      themes: DEFAULT_CATALOG.themes.map((theme) => theme.id === "default" ? { ...theme, links: CUSTOM_LINKS } : theme),
    };
    const edits: Parameters<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>[0][] = [];
    renderPreview({
      themeCatalog: () => catalog,
      setTheme: () => catalog,
      editTheme: (input) => {
        edits.push(input);
        const links = input.edit.kind === "restore-link" && input.edit.target === "sidebar-row"
          ? { ...CUSTOM_LINKS, sidebarRow: "linked" as const }
          : { sidebarRow: "linked" as const, shadowColor: { light: "linked" as const, dark: "linked" as const } };
        catalog = {
          ...catalog,
          revision: catalog.revision + 1,
          themes: catalog.themes.map((theme) => theme.id === input.themeId ? { ...theme, links } : theme),
        };
        return {
          catalog,
          themeId: input.themeId,
          forkedFrom: null,
          undoToken: null,
          committedEdit: input.edit,
          adjustments: [],
          links,
        };
      },
    });

    const rowReset = await screen.findByRole("button", { name: "Reset Sidebar row to Density" });
    expect(edits).toHaveLength(0);
    fireEvent.click(rowReset);
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toMatchObject({ mode: "light", edit: { kind: "restore-link", target: "sidebar-row" } });

    const shadowReset = await screen.findByRole("button", { name: "Reset Shadow color to Ink" });
    fireEvent.click(shadowReset);
    await waitFor(() => expect(edits).toHaveLength(2));
    expect(edits[1]).toMatchObject({ mode: "light", edit: { kind: "restore-link", target: "shadow-color" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reset Shadow color to Ink" })).toBeNull());
  });

  it("composes the mock from natural panels instead of scaling a desktop window", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      const frame = await waitFor(() => {
        const found = document.querySelector<HTMLElement>("[data-tp-frame]");
        expect(found).not.toBeNull();
        return found as HTMLElement;
      });
      // No zoom/scale and no hardcoded desktop width — the frame is fluid.
      expect(frame.style.zoom ?? "").toBe("");
      expect(frame.style.transform).toBe("");
      expect(frame.style.width).toBe("100%");
      const container = frame.closest<HTMLElement>("[data-tp-mock-container]");
      expect(container?.style.width).toBe("100%");
      expect(container?.style.maxWidth).toBe("100%");
      expect(container?.style.boxSizing).toBe("border-box");
      expect(container?.style.padding).toBe("16px");
      // At a phone-width pane the sidebar and info panel stay out.
      expect(screen.queryByText("bb-plugins")).toBeNull();
      expect(screen.queryByText("Pull request")).toBeNull();
    } finally {
      width.mockRestore();
    }
  });

  it("removes generated-only style sheet samples", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });

    await waitFor(() => expect(screen.getByText("Essentials")).toBeDefined());
    expect(document.querySelector("[data-tp-shadow-preview]")).toBeNull();
    expect(document.querySelector("[data-tp-derived=type-steps]")).toBeNull();
    expect(document.querySelector("[data-tp-derived=row-previews]")).toBeNull();
    expect(document.querySelector("[data-tp-derived=radius-ladder]")).toBeNull();
    expect(document.querySelector("[data-tp-editor-tier=advanced]")).not.toBeNull();
  });

  it("includes the sidebar and info panel once the pane is wide enough", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      await waitFor(() => expect(screen.queryByText("bb-plugins")).not.toBeNull());
      expect(screen.getByText("Pull request")).toBeDefined();
    } finally {
      width.mockRestore();
    }
  });

  it("keeps the transient bb surfaces deliberately inspectable in the overlays block", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });

    expect(screen.getByText("Overlays")).toBeDefined();
    for (const name of ["Menu", "Dialog", "Popover", "Tooltip", "Hover card", "Toast"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }

    // The dialog opens as a real bb dialog with its scrim and footer actions.
    fireEvent.click(screen.getByRole("button", { name: "Dialog" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Archive thread?")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // One at a time: the menu opens as a real bb dropdown menu.
    fireEvent.pointerDown(screen.getByRole("button", { name: "Menu" }), { button: 0, ctrlKey: false });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Rename…",
      "Open in split",
      "Copy link",
      "Archive",
    ]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    // Hover-only surfaces still answer a click, so no specimen button is silent.
    fireEvent.click(screen.getByRole("button", { name: "Tooltip" }));
    expect(await screen.findByRole("tooltip")).toBeDefined();
  });

  it("keeps Components directly below Overlays as a sibling in the desktop rail", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });
      await waitFor(() => expect(document.querySelector("[data-tp-band=desktop]")).not.toBeNull());

      const rail = document.querySelector("[data-tp-section=rail]");
      const areas = [...(rail?.children ?? [])].filter((element) => element.hasAttribute("data-tp-area"));
      expect(areas.map((area) => area.getAttribute("data-tp-area"))).toEqual(["overlays", "components"]);
      expect(areas[0]?.nextElementSibling).toBe(areas[1]);
      expect(areas[0]?.contains(areas[1] ?? null)).toBe(false);
      expect(within(areas[1] as HTMLElement).getByRole("heading", { name: "Components", level: 2 })).toBeDefined();
    } finally {
      width.mockRestore();
    }
  });

  it("keeps badges on one row and groups each color label, picker, and value", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });
      await waitFor(() => expect(document.querySelector("[data-tp-band=desktop]")).not.toBeNull());

      const badges = document.querySelector<HTMLElement>("[data-tp-badge-row]");
      expect(badges?.style.flexWrap).toBe("nowrap");
      expect(badges?.style.overflowX).toBe("auto");

      const canvas = screen.getByLabelText("Canvas color") as HTMLInputElement;
      expect(canvas.className).toContain("h-4");
      expect(canvas.className).toContain("w-6");
      expect(canvas.className).toContain("rounded");
      expect(canvas.className).toContain("border-0");
      expect(canvas.className).toContain("enabled:hover:ring-2");
      const specimen = canvas.closest<HTMLElement>("[data-tp-specimen='color:canvas']");
      expect(specimen?.tagName).toBe("DIV");
      expect(specimen?.style.display).toBe("grid");
      expect(specimen?.style.gridTemplateColumns).toBe("minmax(0, max-content) 24px max-content");
      expect(specimen?.style.columnGap).toBe("6px");
      expect(specimen?.querySelectorAll("input, button, [role=button]")).toHaveLength(1);

      const shadowColor = screen.getByLabelText("Shadow color") as HTMLInputElement;
      expect(shadowColor.closest("label")).toBeNull();
      expect(shadowColor.closest("[data-tp-specimen='shadow:color']")?.tagName).toBe("DIV");

      expect(document.querySelector("[data-tp-base-contrast]")).toBeNull();

      const components = document.querySelector<HTMLElement>("[data-tp-components]");
      expect(components?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
      expect(components?.style.columnGap).toBe("16px");
      expect(components?.style.rowGap).toBe("16px");
      expect(document.querySelector<HTMLElement>("[data-tp-button-grid]")?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
      for (const block of document.querySelectorAll<HTMLElement>("[data-tp-block=switch], [data-tp-block=checkbox]")) {
        expect(block.style.paddingBlock).toBe("12px");
        expect(block.style.paddingInline).toBe("");
        expect(block.querySelector<HTMLElement>("[data-tp-toggle-controls]")?.style.paddingInline).toBe("");
      }

      expect(document.querySelector("[data-tp-derived=radius-ladder]")).toBeNull();
      expect(document.querySelector("[data-tp-derived-values]")).toBeNull();
      expect(document.querySelector("[data-tp-shadow-ladder]")).toBeNull();
    } finally {
      width.mockRestore();
    }
  });

  it("shows a BB tooltip when a responsive color label is truncated", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });
    const label = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-tp-specimen='color:attention'] [data-tp-truncated='true']");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(label.tabIndex).toBe(0);
    fireEvent.focus(label);
    expect((await screen.findByRole("tooltip")).textContent).toContain("Attention / pending");
  });

  it("gives each split pane its own conversation", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderSlot(panel, { subPath: "split" }, {
        rpc: withEditHandler({
          themeCatalog: () => DEFAULT_CATALOG,
          setTheme: () => DEFAULT_CATALOG,
        }),
      });

      await waitFor(() => expect(screen.queryAllByText(/lay the specimen sheet out as a grid/i)).toHaveLength(1));
      // The blacklight transcript appears only in the first pane.
      expect(screen.getAllByText(/Three blacks were fragmenting the frame/i)).toHaveLength(1);
    } finally {
      width.mockRestore();
    }
  });

  it("keeps the hover card dismissible and its controls usable", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });

    const trigger = document.querySelector<HTMLButtonElement>("[data-tp-hovercard-trigger]");
    if (!trigger) throw new Error("Hover card trigger was not rendered");

    // Hover is Radix's own lifecycle (delayed open, close once the pointer has
    // left trigger AND content), so the trigger must not force it open itself.
    expect(trigger.getAttribute("data-state")).toBe("closed");

    // Click is an explicit toggle, so a second click dismisses.
    fireEvent.click(trigger);
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>("[data-tp-hovercard-content]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    // The card carries real controls, and using one must not dismiss it.
    const copy = within(card).getByRole("button", { name: "Copy branch" });
    expect(within(card).getByRole("button", { name: "Open in split" })).toBeDefined();
    fireEvent.click(copy);
    expect(document.querySelector("[data-tp-hovercard-content]")).not.toBeNull();

    fireEvent.click(trigger);
    await waitFor(() => expect(document.querySelector("[data-tp-hovercard-content]")).toBeNull());
  });

  it("keeps preview controls genuinely interactive", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });

    // Input accepts typing.
    const search = await screen.findByRole("textbox", { name: "Search threads" });
    fireEvent.change(search, { target: { value: "endless color" } });
    expect((search as HTMLInputElement).value).toBe("endless color");
    expect(screen.queryByRole("textbox", { name: "Filter" })).toBeNull();

    // Switch and checkbox toggle, and expose checked state.
    const notifications = screen.getByRole("switch", { name: "Notifications" });
    const before = notifications.getAttribute("aria-checked");
    fireEvent.click(notifications);
    expect(notifications.getAttribute("aria-checked")).not.toBe(before);

    const drafts = screen.getByRole("checkbox", { name: "Include drafts" });
    const checkedBefore = drafts.getAttribute("aria-checked");
    fireEvent.click(drafts);
    expect(drafts.getAttribute("aria-checked")).not.toBe(checkedBefore);

    // Disabled states are real, not painted.
    expect((screen.getByRole("button", { name: "Disabled" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives the tooltip a dismissal delay and keyboard focus support", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });
    const trigger = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>("[data-tp-tooltip-trigger]");
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Keyboard focus opens it, not just hover.
    fireEvent.focus(trigger);
    await waitFor(() => expect(document.querySelector("[data-tp-tooltip-content]")).not.toBeNull());

    // Pointer-out does not dismiss immediately: it survives normal movement.
    fireEvent.mouseLeave(trigger);
    await act(async () => { await sleep(250); });
    expect(document.querySelector("[data-tp-tooltip-content]")).not.toBeNull();

    // ...and is gone once the dismissal delay elapses.
    await act(async () => { await sleep(700); });
    await waitFor(() => expect(document.querySelector("[data-tp-tooltip-content]")).toBeNull());
  });

  it("keeps the style sheet focused on direct controls and contextual previews", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });
      await waitFor(() => expect(document.querySelector("[data-tp-band=desktop]")).not.toBeNull());

      const sheet = document.querySelector("[data-tp-area=stylesheet]");
      const blocks = [...(sheet?.querySelectorAll("[data-tp-block]") ?? [])].map((el) => el.getAttribute("data-tp-block"));
      expect(blocks.slice(0, 2)).toEqual(["colors", "systems"]);
      expect(screen.getByText("Essentials")).toBeDefined();
      expect(screen.getByText("Advanced")).toBeDefined();
      expect(screen.queryByText("Foundation · surfaces")).toBeNull();
      expect(screen.queryByText("Derived values")).toBeNull();
      expect(document.querySelector("[data-tp-derived-values]")).toBeNull();
      expect(document.querySelector("[data-tp-derived=type-steps]")).toBeNull();
      expect(document.querySelector("[data-tp-derived=row-previews]")).toBeNull();
      expect(document.querySelector("[data-tp-derived=radius-ladder]")).toBeNull();
      expect(document.querySelector("[data-tp-shadow-preview]")).toBeNull();
    } finally {
      width.mockRestore();
    }
  });

  it("keeps the last resolved catalog across route remounts instead of flashing an empty picker", async () => {
    const first = renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
    });
    await screen.findByRole("combobox", { name: /Default/i });
    first.lifecycle.unmount();

    const refresh = deferred<Catalog>();
    renderPreview({
      themeCatalog: () => refresh.promise,
      setTheme: () => DEFAULT_CATALOG,
    });

    expect(screen.getByRole("combobox", { name: /Default/i })).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Loading themes" })).toBeNull();
    await act(async () => refresh.resolve(DEFAULT_CATALOG));
  });

  it("keeps the header, preview rail, and guide on one ultrawide alignment spine", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(3120);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      await waitFor(() => expect(document.querySelector("[data-tp-band=desktop]")).not.toBeNull());
      const header = document.querySelector<HTMLElement>("[data-tp-header-inner]");
      expect(header?.style.maxWidth).toBe("1600px");
      expect(header?.style.padding).toContain("20px");
      expect(document.querySelector<HTMLElement>("[data-tp-layout=desktop]")?.style.maxWidth).toBe("1600px");
      expect(document.querySelector<HTMLElement>("[data-tp-mock-container]")?.style.padding).toBe("20px");
      expect(document.querySelector<HTMLElement>("[data-tp-area=components]")?.closest("[data-tp-layout=desktop]")?.getAttribute("data-tp-layout")).toBe("desktop");
      const stylesheet = document.querySelector<HTMLElement>("[data-tp-area=stylesheet]");
      expect(stylesheet?.style.maxWidth).toBe("1600px");
      expect(stylesheet?.style.padding).toContain("20px");
    } finally {
      width.mockRestore();
    }
  });

  it("queues one immediate refresh when change signals arrive during a stale catalog request", async () => {
    const stale = deferred<Catalog>();
    let catalogCalls = 0;
    const slot = renderPreview({
      themeCatalog: () => {
        catalogCalls += 1;
        return catalogCalls === 1 ? stale.promise : ENDLESS_CATALOG;
      },
      setTheme: () => ENDLESS_CATALOG,
    });

    await waitFor(() => expect(catalogCalls).toBe(1));
    await slot.behavior.emitRealtime("theme-preview:changed", null);
    await slot.behavior.emitRealtime("theme-preview:changed", null);

    await act(async () => stale.resolve(DEFAULT_CATALOG));

    await waitFor(() => expect(catalogCalls).toBe(2));
    expect(screen.getByRole("combobox", { name: /Endless Color/i })).toBeDefined();
    expect(catalogCalls).toBe(2);
  });

  it("times out a stuck catalog request and lets the queued refresh recover", async () => {
    vi.useFakeTimers();
    const stuck = deferred<Catalog>();
    let catalogCalls = 0;
    renderPreview({
      themeCatalog: () => {
        catalogCalls += 1;
        return catalogCalls === 1 ? stuck.promise : ENDLESS_CATALOG;
      },
      setTheme: () => ENDLESS_CATALOG,
    });

    await act(async () => { await Promise.resolve(); });
    expect(catalogCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(catalogCalls).toBe(2);
    expect(screen.getByRole("combobox", { name: /Endless Color/i })).toBeDefined();
  });

  it("owns a visible pending state and blocks duplicate selections", async () => {
    const pending = deferred<Catalog>();
    let selectionCalls = 0;
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => {
        selectionCalls += 1;
        return pending.promise;
      },
    });

    await chooseEndlessDark();

    const control = await screen.findByRole("combobox", { name: /Applying Endless Color/i });
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(control.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(control);
    expect(selectionCalls).toBe(1);
    expect(screen.queryByRole("listbox")).toBeNull();

    await act(async () => pending.resolve(ENDLESS_CATALOG));
    await waitFor(() => expect((screen.getByRole("combobox", { name: /Endless Color/i }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("keeps a failed selection recoverable beside the owning control", async () => {
    let selectionCalls = 0;
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => {
        selectionCalls += 1;
        if (selectionCalls === 1) throw new Error("rpc disconnected");
        return ENDLESS_CATALOG;
      },
    });

    await chooseEndlessDark();

    expect((await screen.findByRole("alert")).textContent).toContain("Theme didn’t apply");
    fireEvent.click(screen.getByRole("button", { name: "Retry theme" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: /Endless Color/i }) as HTMLButtonElement).disabled).toBe(false));
    expect(selectionCalls).toBe(2);
  });

  it("releases a never-settling selection when its deadline expires", async () => {
    const stuck = deferred<Catalog>();
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => stuck.promise,
    });

    const control = themeControl();
    await waitFor(() => expect(control.textContent).toContain("Default"));

    vi.useFakeTimers();
    openThemeMenu();
    const options = screen.getAllByRole("option");
    const endless = options.find((option) => option.textContent?.includes("Endless Color"));
    if (!endless) throw new Error("Endless Color option was not rendered");
    pickOption(endless);

    expect(control.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(control.disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("Theme didn’t apply");
  });
});
