import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyThemeEdit,
  applyThemeEditWithEffects,
  classifyThemeLinks,
  createThemeEditor,
  editThemeInputSchema,
  readThemePreviewForkName,
  THEME_PREVIEW_MANAGED_MARKERS,
  type EditableThemeResource,
  type ThemeEditInput,
} from "./theme-editor";

const colors = (target: Extract<ThemeEditInput["edit"], { kind: "colors" }>["target"]) => ({
  kind: "colors" as const,
  target,
  canvas: "#f4f4f4",
  ink: "#1a1a1a",
  sidebar: "#20252b",
  sidebarForeground: "#f0f2f4",
  primary: "#3366cc",
  timelineAccent: "#1f5f99",
  success: "#1f6f3a",
  warning: "#765000",
  attention: "#756000",
  destructive: "#9b1c23",
  prMerged: "#6040a8",
});

function hexDeclaration(css: string, token: string): string {
  const values = [...css.matchAll(new RegExp(`--${token}: (#[0-9a-f]{6}(?:[0-9a-f]{2})?);`, "gi"))];
  const value = values[values.length - 1]?.[1];
  if (!value) throw new Error(`Missing --${token} hex declaration`);
  return value;
}

function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5]
      .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe("editThemeInputSchema", () => {
  it("accepts every deterministic edit family at its approved boundaries", () => {
    const inputs: ThemeEditInput[] = [
      { themeId: "nord", mode: "light", edit: colors("canvas") },
      { themeId: "nord", mode: "dark", edit: { kind: "typography", target: "font-sans", fontSans: "system-ui, sans-serif", fontMono: "ui-monospace, monospace", textScale: 0.9, lineHeight: 1.15 } },
      { themeId: "nord", mode: "light", edit: { kind: "rhythm", target: "density", density: 5, tracking: -0.04, rowHeight: 40, iconStroke: 2.5 } },
      { themeId: "nord", mode: "light", edit: { kind: "radius", target: "base", value: 0 } },
      { themeId: "nord", mode: "dark", edit: { kind: "shadow", target: "color", x: -24, y: 24, blur: 48, spread: -24, color: "#000000", opacity: 80 } },
      { themeId: "nord", mode: "dark", edit: { kind: "restore-link", target: "shadow-color" } },
    ];
    for (const input of inputs) expect(editThemeInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects unsafe CSS values, partial color families, and out-of-range numbers", () => {
    expect(editThemeInputSchema.safeParse({
      themeId: "nord",
      mode: "light",
      edit: { ...colors("primary"), primary: "red; } body { display:none" },
    }).success).toBe(false);
    const { prMerged: _missing, ...partial } = colors("success");
    expect(editThemeInputSchema.safeParse({ themeId: "nord", mode: "light", edit: partial }).success).toBe(false);
    expect(editThemeInputSchema.safeParse({
      themeId: "nord",
      mode: "light",
      edit: { kind: "rhythm", target: "density", density: 5.01, tracking: 0, rowHeight: 28, iconStroke: 1.75 },
    }).success).toBe(false);
    expect(editThemeInputSchema.safeParse({
      themeId: "nord",
      mode: "light",
      edit: { kind: "typography", target: "font-sans", fontSans: "system-ui; color:red", fontMono: "monospace", textScale: 1, lineHeight: 1 },
    }).success).toBe(false);
    expect(editThemeInputSchema.safeParse({
      themeId: "nord",
      mode: "light",
      edit: { kind: "radius", value: 8 },
    }).success).toBe(false);
  });

  it("accepts relationally unsafe colors at the boundary so the editor can derive a valid palette", () => {
    const edit = {
      kind: "colors" as const,
      target: "canvas" as const,
      canvas: "#9fa2a8",
      ink: "#0a0a0a",
      sidebar: "#e3e5e9",
      sidebarForeground: "#0a0a0a",
      primary: "#2e6f95",
      timelineAccent: "#2e6f95",
      success: "#5a6813",
      warning: "#8a660a",
      attention: "#a8481f",
      destructive: "#9c3118",
      prMerged: "#55608c",
    };

    expect(editThemeInputSchema.safeParse({ themeId: "endless-color-copy", mode: "light", edit }).success).toBe(true);
  });
});

describe("applyThemeEdit", () => {
  it("preserves user CSS byte-for-byte and accumulates sequential family edits in one block", () => {
    const source = "/* user comment */\n.custom-surface { color: hotpink; }\n";
    const anchors = applyThemeEdit(source, { mode: "light", edit: colors("canvas") });
    const status = applyThemeEdit(anchors, { mode: "dark", edit: colors("success") });
    const primary = applyThemeEdit(status, { mode: "light", edit: colors("primary") });
    const sidebar = applyThemeEdit(primary, { mode: "light", edit: colors("sidebar") });

    expect(sidebar.startsWith(source)).toBe(true);
    expect(sidebar.match(/theme-preview:managed:start/g)).toHaveLength(1);
    expect(sidebar).toContain(":root:not(.dark), .light:not(.dark) {");
    expect(sidebar).toContain("--canvas: #f4f4f4;");
    expect(sidebar).toContain("--border: color-mix(in oklch, var(--ink) 14%, var(--canvas));");
    expect(sidebar).toContain("--subtle-foreground: color-mix(in oklch, var(--ink) 74%, var(--canvas));");
    expect(sidebar).toContain("--readback-foreground: color-mix(in oklch, var(--ink) 78%, var(--canvas));");
    expect(sidebar).toContain("--state-hover: color-mix(in oklab, var(--ink) 5.9%, transparent);");
    expect(sidebar).toContain("--primary: #3366cc;");
    expect(sidebar).toContain("--ring: var(--primary);");
    expect(sidebar).toContain("--success: #1f6f3a;");
    expect(sidebar).toContain("--success-foreground: color-mix(in oklch, var(--success) 45%, var(--ink));");
    expect(sidebar).toContain("--warning-text: color-mix(in oklch, var(--warning) 80%, var(--ink));");
    expect(sidebar).toContain("--destructive-foreground: var(--ink);");
    expect(sidebar).toContain("--destructive-text: color-mix(in oklch, var(--destructive) 65%, var(--ink));");
    expect(sidebar).toContain("--diff-added: var(--success);");
    expect(sidebar).toContain("--diff-removed: var(--destructive);");
    expect(sidebar).toContain("--sidebar: #20252b;");
    expect(sidebar).toContain("--sidebar-search-match: color-mix(in oklab, oklch(0.8 0.13 88), var(--canvas) 76%);");
  });

  it("replaces a touched family while retaining unrelated managed families", () => {
    const first = applyThemeEdit("", { mode: "light", edit: colors("primary") });
    const second = applyThemeEdit(first, {
      mode: "light",
      edit: { ...colors("primary"), primary: "#1122aa" },
    });
    expect(second).toContain("--primary: #1122aa;");
    expect(second).not.toContain("--primary: #3366cc;");
    expect(second.match(/theme-preview:managed:start/g)).toHaveLength(1);
  });

  it("keeps a valid direct color exact and does not take ownership of unrelated families", () => {
    const css = applyThemeEdit("", {
      mode: "light",
      edit: { ...colors("primary"), primary: "#1122aa" },
    });
    expect(hexDeclaration(css, "primary")).toBe("#1122aa");
    expect(css).not.toContain("--canvas:");
    expect(css).not.toContain("--success:");
  });

  it("preserves a canvas edit and derives every affected dependent color", () => {
    const edit = {
      kind: "colors" as const,
      target: "canvas" as const,
      canvas: "#9fa2a8",
      ink: "#0a0a0a",
      sidebar: "#e3e5e9",
      sidebarForeground: "#0a0a0a",
      primary: "#2e6f95",
      timelineAccent: "#2e6f95",
      success: "#5a6813",
      warning: "#8a660a",
      attention: "#a8481f",
      destructive: "#9c3118",
      prMerged: "#55608c",
    };
    const css = applyThemeEdit("/* untouched */", { mode: "light", edit });
    const canvas = hexDeclaration(css, "canvas");

    expect(canvas).toBe(edit.canvas);
    expect(hexDeclaration(css, "ink")).toBe(edit.ink);
    for (const [token, requested] of [
      ["primary", edit.primary],
      ["timeline-accent", edit.timelineAccent],
      ["success", edit.success],
      ["warning", edit.warning],
      ["destructive", edit.destructive],
      ["pr-merged", edit.prMerged],
    ] as const) {
      const value = hexDeclaration(css, token);
      expect(value).not.toBe(requested);
      expect(contrast(value, canvas)).toBeGreaterThanOrEqual(4.5);
    }
    const attention = hexDeclaration(css, "attention");
    expect(attention).not.toBe(edit.attention);
    expect(contrast(attention, canvas)).toBeGreaterThanOrEqual(3);
  });

  it("repairs an invalid direct relationship instead of rejecting the edit", () => {
    const edit = { ...colors("primary"), primary: "#bbbbbb" };
    const css = applyThemeEdit("", { mode: "light", edit });
    const primary = hexDeclaration(css, "primary");

    expect(primary).not.toBe(edit.primary);
    expect(contrast(primary, edit.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it("returns ordered authoritative projection metadata", () => {
    const edit = {
      ...colors("canvas"),
      canvas: "#9fa2a8",
      primary: "#2e6f95",
      timelineAccent: "#2e6f95",
      success: "#5a6813",
      warning: "#8a660a",
      attention: "#a8481f",
      destructive: "#9c3118",
      prMerged: "#55608c",
    };
    const result = applyThemeEditWithEffects("", { mode: "light", edit });

    expect(result.committedEdit).toMatchObject({ kind: "colors", target: "canvas", canvas: edit.canvas });
    expect(result.adjustments.map(({ control }) => control)).toEqual([
      "color:primary",
      "color:timeline-accent",
      "color:success",
      "color:warning",
      "color:attention",
      "color:destructive",
      "color:pr-merged",
    ]);
    expect(result.adjustments[0]).toEqual(expect.objectContaining({
      label: "Primary",
      scope: "light",
      from: edit.primary,
      invariant: "Primary controls stays at 4.5:1 or better",
    }));
  });

  it("cascades a dark ink edit through its destructive-color dependency", () => {
    const edit = {
      ...colors("ink"),
      canvas: "#17191c",
      ink: "#333333",
      destructive: "#777777",
    };
    const css = applyThemeEdit("", { mode: "dark", edit });
    const ink = hexDeclaration(css, "ink");
    const destructive = hexDeclaration(css, "destructive");

    expect(ink).not.toBe(edit.ink);
    expect(contrast(ink, edit.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(destructive).not.toBe(edit.destructive);
    expect(contrast(destructive, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("derives typography, rhythm, touch rows, radius, and the complete shadow ladder", () => {
    let css = applyThemeEdit("", {
      mode: "light",
      edit: { kind: "typography", target: "text-scale", fontSans: "system-ui, sans-serif", fontMono: "ui-monospace, monospace", textScale: 1.1, lineHeight: 0.9 },
    });
    css = applyThemeEdit(css, {
      mode: "light",
      edit: { kind: "rhythm", target: "sidebar-row", density: 3.5, tracking: 0.02, rowHeight: 30, iconStroke: 2 },
    });
    css = applyThemeEdit(css, { mode: "light", edit: { kind: "radius", target: "base", value: 12 } });
    css = applyThemeEdit(css, {
      mode: "dark",
      edit: { kind: "shadow", target: "color", x: -2, y: 3, blur: 4, spread: -1, color: "#112233", opacity: 40 },
    });

    expect(css).toContain("--tp-text-scale: 1.1;");
    expect(css).toContain("--text-sm: 14.3px;");
    expect(css).toContain("--text-sm--line-height: 17.1px;");
    expect(css).toContain("--spacing: 3.5px;");
    expect(css).toContain("--bb-sidebar-row-height: 30px;");
    expect(css).toContain("--bb-sidebar-row-height-coarse: 42px;");
    expect(css).toContain("body {\n  letter-spacing: var(--tracking-normal);");
    expect(css).toContain("--radius: 12px;");
    for (const token of ["shadow-2xs", "shadow-xs", "shadow-sm", "shadow", "shadow-md", "shadow-lift", "shadow-lg", "shadow-xl", "shadow-2xl"]) {
      expect(css).toContain(`--${token}:`);
    }
    expect(css).toContain("--tp-shadow-color: #112233;");
    expect(css).toContain("--tp-shadow-opacity-percent: 40;");
  });

  it("clamps derived shadow alpha at the maximum supported opacity", () => {
    const css = applyThemeEdit("", {
      mode: "dark",
      edit: { kind: "shadow", target: "color", x: 0, y: 2, blur: 0, spread: 0, color: "#000000", opacity: 80 },
    });
    expect(css).toContain("--shadow-2xl: 0px 12px 24px -4px color-mix(in oklab, var(--tp-shadow-color) 100%, transparent);");
    expect(css).not.toContain("112%");
  });

  it("persists Sidebar row as linked until edited and restores the canonical formula", () => {
    const density = applyThemeEditWithEffects("", {
      mode: "light",
      edit: { kind: "rhythm", target: "density", density: 5, tracking: 0, rowHeight: 28, iconStroke: 1.75 },
    });
    expect(density.css).toContain("--bb-sidebar-row-height: calc(20px + var(--spacing) + var(--spacing));");
    expect(density.committedEdit).toMatchObject({ kind: "rhythm", rowHeight: 30 });
    expect(density.adjustments).toEqual([expect.objectContaining({ control: "rhythm:row-height", from: "28px", to: "30px" })]);
    expect(density.links.sidebarRow).toBe("linked");

    const custom = applyThemeEditWithEffects(density.css, {
      mode: "light",
      edit: { kind: "rhythm", target: "sidebar-row", density: 5, tracking: 0, rowHeight: 34, iconStroke: 1.75 },
    });
    expect(custom.css).toContain("--bb-sidebar-row-height: 34px;");
    expect(custom.links.sidebarRow).toBe("custom");

    const laterDensity = applyThemeEditWithEffects(custom.css, {
      mode: "light",
      edit: { kind: "rhythm", target: "density", density: 3, tracking: 0, rowHeight: 34, iconStroke: 1.75 },
    });
    expect(laterDensity.css).toContain("--bb-sidebar-row-height: 34px;");
    expect(laterDensity.adjustments).toEqual([]);

    const reset = applyThemeEditWithEffects(laterDensity.css, {
      mode: "light",
      edit: { kind: "restore-link", target: "sidebar-row" },
    });
    expect(reset.links.sidebarRow).toBe("linked");
    expect(reset.css).toContain("--bb-sidebar-row-height-coarse: max(40px, calc(var(--bb-sidebar-row-height) + 12px));");
  });

  it("persists each mode's Shadow color link independently and restores it", () => {
    const base = applyThemeEdit("", { mode: "light", edit: colors("canvas") });
    const linked = applyThemeEditWithEffects(base, {
      mode: "light",
      edit: { kind: "shadow", target: "y", x: 0, y: 4, blur: 8, spread: 0, color: "#1a1a1a", opacity: 16 },
    });
    expect(linked.css).toContain("--tp-shadow-color: var(--ink);");
    expect(linked.css).toContain("color-mix(in oklab, var(--tp-shadow-color)");
    expect(linked.links.shadowColor).toEqual({ light: "linked", dark: "linked" });

    const custom = applyThemeEditWithEffects(linked.css, {
      mode: "light",
      edit: { kind: "shadow", target: "color", x: 0, y: 4, blur: 8, spread: 0, color: "#123456", opacity: 16 },
    });
    expect(custom.links.shadowColor).toEqual({ light: "custom", dark: "linked" });
    expect(custom.css).toContain("--tp-shadow-color: #123456;");

    const reset = applyThemeEditWithEffects(custom.css, {
      mode: "light",
      edit: { kind: "restore-link", target: "shadow-color" },
    });
    expect(reset.links.shadowColor).toEqual({ light: "linked", dark: "linked" });
    expect(reset.adjustments).toEqual([expect.objectContaining({ control: "shadow:color", to: "var(--ink)" })]);

    const changedInk = applyThemeEditWithEffects(reset.css, {
      mode: "light",
      edit: { ...colors("ink"), ink: "#202020" },
    });
    expect(changedInk.adjustments).toContainEqual(expect.objectContaining({
      control: "shadow:color",
      to: "#202020",
      invariant: "Shadow color follows Ink while linked",
    }));
  });

  it("classifies source declarations as custom and absent relationships as linked", () => {
    expect(classifyThemeLinks(":root { --bb-sidebar-row-height: 31px; --shadow-color: #222222; }"))
      .toEqual({ sidebarRow: "custom", shadowColor: { light: "custom", dark: "custom" } });
    expect(classifyThemeLinks(".dark { --bb-sidebar-row-height: 30px; }"))
      .toEqual({ sidebarRow: "custom", shadowColor: { light: "linked", dark: "linked" } });
    expect(classifyThemeLinks(":root { --canvas: #ffffff; }"))
      .toEqual({ sidebarRow: "linked", shadowColor: { light: "linked", dark: "linked" } });
    expect(classifyThemeLinks(`${THEME_PREVIEW_MANAGED_MARKERS.start}\n:root { --bb-sidebar-row-height: calc( 20px + var(--spacing) + var(--spacing) ); }\n.dark { --tp-shadow-color: var( --ink ); }\n${THEME_PREVIEW_MANAGED_MARKERS.end}`))
      .toEqual({ sidebarRow: "linked", shadowColor: { light: "linked", dark: "linked" } });
  });

  it("resets a source-defined relationship by override without rewriting source CSS", () => {
    const source = ":root { --bb-sidebar-row-height: 31px; }\n.user-rule { color: hotpink; }\n";
    const reset = applyThemeEditWithEffects(source, {
      mode: "light",
      edit: { kind: "restore-link", target: "sidebar-row" },
    });

    expect(reset.css.startsWith(source)).toBe(true);
    expect(reset.css).toContain("--bb-sidebar-row-height: calc(20px + var(--spacing) + var(--spacing));");
    expect(reset.links.sidebarRow).toBe("linked");
  });

  it("refuses malformed or duplicate managed markers instead of overwriting user CSS", () => {
    expect(() => applyThemeEdit(THEME_PREVIEW_MANAGED_MARKERS.start, { mode: "light", edit: colors("canvas") }))
      .toThrow("markers are incomplete");
    const duplicate = `${THEME_PREVIEW_MANAGED_MARKERS.start}\n${THEME_PREVIEW_MANAGED_MARKERS.end}\n${THEME_PREVIEW_MANAGED_MARKERS.start}\n${THEME_PREVIEW_MANAGED_MARKERS.end}`;
    expect(() => applyThemeEdit(duplicate, { mode: "light", edit: colors("canvas") }))
      .toThrow("more than one managed block");
  });
});

describe("createThemeEditor", () => {
  it("edits a custom theme in place, preserves its source CSS, and reapplies it", async () => {
    const themeDirectory = await mkdtemp(join(tmpdir(), "theme-preview-editor-"));
    const directory = join(themeDirectory, "handmade");
    const filePath = join(directory, "theme.css");
    await mkdir(directory);
    const source = ":root { --canvas: linen; }\n.user-rule { outline: none; }\n";
    await writeFile(filePath, source);
    const applyTheme = vi.fn(async (themeId: string) => ({ activeThemeId: themeId }));
    const editor = createThemeEditor({
      resolveTheme: async (): Promise<EditableThemeResource> => ({
        id: "handmade", name: "handmade", source: "custom", css: await readFile(filePath, "utf8"), filePath, themeDirectory,
      }),
      applyTheme,
      selectTheme: async () => {},
      loadCatalog: async () => ({ activeThemeId: "handmade" }),
    });

    try {
      const result = await editor.editTheme({ themeId: "handmade", mode: "light", edit: colors("timeline-accent") });
      const written = await readFile(filePath, "utf8");
      expect(written.startsWith(source)).toBe(true);
      expect(written).toContain("--timeline-accent: #1f5f99;");
      expect(result).toMatchObject({ catalog: { activeThemeId: "handmade" }, themeId: "handmade", forkedFrom: null, undoToken: null });
      expect(result.committedEdit).toEqual(colors("timeline-accent"));
      expect(result.adjustments).toEqual([]);
      expect(applyTheme).toHaveBeenCalledWith("handmade", filePath);
    } finally {
      await rm(themeDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    { source: "builtin" as const, id: "nord", name: "Nord", expectedId: "nord-copy-2" },
    { source: "plugin" as const, id: "plugin:endless:color", name: "Endless Color", expectedId: "endless-color-copy" },
  ])("forks a $source theme to a collision-safe durable custom resource", async ({ source, id, name, expectedId }) => {
    const themeDirectory = await mkdtemp(join(tmpdir(), "theme-preview-fork-"));
    if (source === "builtin") await mkdir(join(themeDirectory, "nord-copy"));
    const sourceCss = `:root { --canvas: #eeeeee; }\n/* ${id} source */\n`;
    const applyTheme = vi.fn(async (themeId: string) => ({ activeThemeId: themeId }));
    const selectTheme = vi.fn(async () => {});
    const loadCatalog = vi.fn(async () => ({ activeThemeId: id }));
    const editor = createThemeEditor({
      resolveTheme: async (): Promise<EditableThemeResource> => ({
        id, name, source, css: sourceCss, filePath: null, themeDirectory,
      }),
      applyTheme,
      selectTheme,
      loadCatalog,
    });

    try {
      const result = await editor.editTheme({ themeId: id, mode: "dark", edit: colors("success") });
      const written = await readFile(join(themeDirectory, expectedId, "theme.css"), "utf8");
      expect(written.startsWith(sourceCss)).toBe(true);
      expect(written).toContain("--pr-merged: #6040a8;");
      expect(readThemePreviewForkName(written)).toBe(`${name} copy${expectedId.endsWith("-2") ? " 2" : ""}`);
      expect(result).toEqual({
        catalog: { activeThemeId: expectedId },
        themeId: expectedId,
        forkedFrom: id,
        undoToken: expect.any(String),
        committedEdit: colors("success"),
        adjustments: [],
        links: expect.any(Object),
      });
      expect(applyTheme).toHaveBeenCalledWith(expectedId, join(themeDirectory, expectedId, "theme.css"));

      await expect(editor.undoThemeFork({ undoToken: result.undoToken! })).resolves.toEqual({ activeThemeId: id });
      await expect(readFile(join(themeDirectory, expectedId, "theme.css"), "utf8")).rejects.toThrow();
      expect(selectTheme).toHaveBeenCalledWith(id);
      expect(loadCatalog).toHaveBeenCalledOnce();
    } finally {
      await rm(themeDirectory, { recursive: true, force: true });
    }
  });

  it("derives an unsafe built-in edit before allocating its durable copy", async () => {
    const themeDirectory = await mkdtemp(join(tmpdir(), "theme-preview-derived-fork-"));
    const editor = createThemeEditor({
      resolveTheme: async (): Promise<EditableThemeResource> => ({
        id: "default", name: "Default", source: "builtin", css: ":root { --canvas: #f4f4f4; }", filePath: null, themeDirectory,
      }),
      applyTheme: async (themeId: string) => ({ activeThemeId: themeId }),
      selectTheme: async () => {},
      loadCatalog: async () => ({ activeThemeId: "default" }),
    });

    try {
      const result = await editor.editTheme({
        themeId: "default",
        mode: "light",
        edit: { ...colors("canvas"), canvas: "#9fa2a8" },
      });
      const entries = await readdir(themeDirectory);
      expect(entries).toEqual([result.themeId]);
      const css = await readFile(join(themeDirectory, result.themeId, "theme.css"), "utf8");
      expect(hexDeclaration(css, "canvas")).toBe("#9fa2a8");
      expect(contrast(hexDeclaration(css, "primary"), "#9fa2a8")).toBeGreaterThanOrEqual(4.5);
      expect(result.forkedFrom).toBe("default");
    } finally {
      await rm(themeDirectory, { recursive: true, force: true });
    }
  });

  it("refuses to remove a fork after that copy has changed", async () => {
    const themeDirectory = await mkdtemp(join(tmpdir(), "theme-preview-fork-undo-"));
    const selectTheme = vi.fn(async () => {});
    const editor = createThemeEditor({
      resolveTheme: async (): Promise<EditableThemeResource> => ({
        id: "default", name: "Default", source: "builtin", css: ":root { --canvas: #eeeeee; }\n", filePath: null, themeDirectory,
      }),
      applyTheme: async (themeId) => ({ activeThemeId: themeId }),
      selectTheme,
      loadCatalog: async () => ({ activeThemeId: "default" }),
    });

    try {
      const result = await editor.editTheme({ themeId: "default", mode: "light", edit: colors("canvas") });
      const filePath = join(themeDirectory, result.themeId, "theme.css");
      await writeFile(filePath, `${await readFile(filePath, "utf8")}\n/* later edit */\n`);

      await expect(editor.undoThemeFork({ undoToken: result.undoToken! }))
        .rejects.toThrow("changed after it was created");
      await expect(readFile(filePath, "utf8")).resolves.toContain("later edit");
      expect(selectTheme).not.toHaveBeenCalled();
    } finally {
      await rm(themeDirectory, { recursive: true, force: true });
    }
  });
});
