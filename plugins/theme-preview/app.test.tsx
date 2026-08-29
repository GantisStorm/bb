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
    },
    {
      id: "plugin:endless:endless-color",
      name: "Endless Color",
      source: "plugin",
      light: null,
      dark: null,
    },
  ],
};

const ENDLESS_CATALOG: Catalog = {
  ...DEFAULT_CATALOG,
  activeThemeId: "plugin:endless:endless-color",
};

const FORKED_CATALOG: Catalog = {
  activeThemeId: "default-copy",
  revision: 1,
  themes: [
    ...DEFAULT_CATALOG.themes,
    { id: "default-copy", name: "Default copy", source: "custom", light: null, dark: null },
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
  unobserve() {}
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
});

type TestRpc = Omit<PluginRpcTestHandlers<typeof rpcContract>, "editTheme"> &
  Partial<Pick<PluginRpcTestHandlers<typeof rpcContract>, "editTheme">>;

function withEditHandler(rpc: TestRpc): PluginRpcTestHandlers<typeof rpcContract> {
  return {
    editTheme: ({ themeId }) => ({ catalog: DEFAULT_CATALOG, themeId, forkedFrom: null }),
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

      fireEvent.mouseDown(within(toc).getByRole("tab", { name: "Agent" }));
      const second = await within(toc).findByRole("button", { name: /Selection now reads/i });
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

  it("restacks the main areas on mobile while keeping derived values collapsed", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(480);
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
      });

      await waitFor(() => expect(document.querySelector("[data-tp-band=mobile]")).not.toBeNull());
      expect(screen.queryByRole("button", { name: /full style guide/i })).toBeNull();
      // Taxonomy order on mobile: mock, overlays, style sheet, components.
      const areas = [...document.querySelectorAll("[data-tp-area]")].map((el) => el.getAttribute("data-tp-area"));
      expect(areas).toEqual(["mock", "overlays", "stylesheet", "components"]);
      expect(screen.getByRole("button", { name: "Derived values" }).getAttribute("aria-expanded")).toBe("false");
      expect(document.querySelector("[data-tp-derived-values] [data-tp-derived-token]")).toBeNull();
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
      fireEvent.click(screen.getByRole("button", { name: "Advanced geometry" }));
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
        expect(found.value).toBe("#222222");
        return found;
      });
      expect(input.value).toBe("#222222");
    } finally {
      root.setProperty("--shadow-color", previous);
    }
  });

  it("commits an active-mode color family, blocks duplicates, then selects and announces the durable fork", async () => {
    const pending = deferred<Awaited<ReturnType<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>>>();
    const edits: Parameters<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>[0][] = [];
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
      editTheme: (input) => {
        edits.push(input);
        return pending.promise;
      },
    });

    const canvas = await waitFor(() => {
      const input = screen.getByLabelText("Canvas color") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.value).toBe("#ffffff");
      expect((screen.getByLabelText("Ink color") as HTMLInputElement).value).toBe("#222222");
      expect((screen.getByLabelText("Sidebar color") as HTMLInputElement).value).toBe("#f5f5f5");
      return input;
    });

    fireEvent.change(canvas, { target: { value: "#112233" } });
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({
      themeId: "default",
      mode: "light",
      edit: {
        kind: "colors",
        family: "anchors",
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
    expect((screen.getByRole("combobox", { name: /Saving Default/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(edits).toHaveLength(1);

    await act(async () => pending.resolve({ catalog: FORKED_CATALOG, themeId: "default-copy", forkedFrom: "default" }));

    expect(await screen.findByRole("combobox", { name: /Default copy/i })).toBeDefined();
    expect(toast.success).toHaveBeenCalledWith("Created Default copy", {
      description: "Now editing Default copy. Default is unchanged.",
    });
  });

  it("normalizes formatted CSS font stacks and keeps a slider edit while the stylesheet catches up", async () => {
    const root = document.documentElement.style;
    const previous = root.getPropertyValue("--font-mono");
    root.setProperty("--font-mono", 'ui-monospace, Menlo,\n  "Courier New", monospace');
    const edits: Parameters<PluginRpcTestHandlers<typeof rpcContract>["editTheme"]>[0][] = [];
    try {
      renderPreview({
        themeCatalog: () => DEFAULT_CATALOG,
        setTheme: () => DEFAULT_CATALOG,
        editTheme: (input) => {
          edits.push(input);
          return { catalog: { ...DEFAULT_CATALOG, revision: 1 }, themeId: "default", forkedFrom: null };
        },
      });

      const slider = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-tp-specimen="type:text-scale"] [role="slider"]');
        expect(found).not.toBeNull();
        expect(found?.hasAttribute("data-disabled")).toBe(false);
        expect(found?.getAttribute("aria-valuenow")).toBe("1");
        return found as HTMLElement;
      });
      slider.focus();
      fireEvent.keyDown(slider, { key: "ArrowRight", code: "ArrowRight" });
      fireEvent.keyUp(slider, { key: "ArrowRight", code: "ArrowRight" });

      await waitFor(() => expect(edits).toHaveLength(1));
      expect(edits[0]?.edit).toMatchObject({
        kind: "typography",
        fontMono: 'ui-monospace, Menlo, "Courier New", monospace',
        textScale: 1.01,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(slider.getAttribute("aria-valuenow")).toBe("1.01");
    } finally {
      root.setProperty("--font-mono", previous);
    }
  });

  it("restores the computed value when an edit fails", async () => {
    renderPreview({
      themeCatalog: () => DEFAULT_CATALOG,
      setTheme: () => DEFAULT_CATALOG,
      editTheme: () => { throw new Error("write failed"); },
    });

    const canvas = await waitFor(() => {
      const input = screen.getByLabelText("Canvas color") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      return input;
    });
    fireEvent.change(canvas, { target: { value: "#112233" } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Theme edit failed", { description: "write failed" }));
    await waitFor(() => expect((screen.getByLabelText("Canvas color") as HTMLInputElement).value).toBe("#ffffff"));
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
      // At a phone-width pane the sidebar and info panel stay out.
      expect(screen.queryByText("bb-plugins")).toBeNull();
      expect(screen.queryByText("Pull request")).toBeNull();
    } finally {
      width.mockRestore();
    }
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

  it("keeps direct controls above a collapsed derived-values disclosure", async () => {
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
      expect(screen.getByText("Mode colors")).toBeDefined();
      expect(screen.queryByText("Foundation · surfaces")).toBeNull();
      const derived = screen.getByRole("button", { name: "Derived values" });
      expect(derived.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(derived);
      expect(document.querySelector("[data-tp-derived-values]")).not.toBeNull();
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
      expect(document.querySelector<HTMLElement>("[data-tp-header-inner]")?.style.maxWidth).toBe("1600px");
      expect(document.querySelector<HTMLElement>("[data-tp-layout=desktop]")?.style.maxWidth).toBe("1600px");
      expect(document.querySelector<HTMLElement>("[data-tp-area=components]")?.style.maxWidth).toBe("1600px");
      expect(document.querySelector<HTMLElement>("[data-tp-area=stylesheet]")?.style.maxWidth).toBe("1600px");
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
