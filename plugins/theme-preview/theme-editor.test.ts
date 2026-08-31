import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  applyThemeEdit,
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

describe("editThemeInputSchema", () => {
  it("accepts every deterministic edit family at its approved boundaries", () => {
    const inputs: ThemeEditInput[] = [
      { themeId: "nord", mode: "light", edit: colors("canvas") },
      { themeId: "nord", mode: "dark", edit: { kind: "typography", fontSans: "system-ui, sans-serif", fontMono: "ui-monospace, monospace", textScale: 0.9, lineHeight: 1.15 } },
      { themeId: "nord", mode: "light", edit: { kind: "rhythm", density: 5, tracking: -0.04, rowHeight: 40, iconStroke: 2.5 } },
      { themeId: "nord", mode: "light", edit: { kind: "radius", value: 0 } },
      { themeId: "nord", mode: "dark", edit: { kind: "shadow", x: -24, y: 24, blur: 48, spread: -24, color: "#000000", opacity: 80 } },
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
      edit: { kind: "rhythm", density: 5.01, tracking: 0, rowHeight: 28, iconStroke: 1.75 },
    }).success).toBe(false);
    expect(editThemeInputSchema.safeParse({
      themeId: "nord",
      mode: "light",
      edit: { kind: "typography", fontSans: "system-ui; color:red", fontMono: "monospace", textScale: 1, lineHeight: 1 },
    }).success).toBe(false);
  });

  it("rejects a canvas that passes base contrast but strands the rest of the palette", () => {
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

    // The RPC shape is valid; the editor rejects the unsafe relationship with
    // a specific message that survives through the handler to the user.
    expect(editThemeInputSchema.safeParse({ themeId: "endless-color-copy", mode: "light", edit }).success).toBe(true);
    expect(() => applyThemeEdit("/* untouched */", { mode: "light", edit }))
      .toThrow("Keep text at 4.5:1 and controls at 3.0:1 or better");
  });

  it.each([
    ["ink", { ink: "#eeeeee" }],
    ["sidebar", { sidebar: "#222222", sidebarForeground: "#333333" }],
    ["sidebar-foreground", { sidebar: "#222222", sidebarForeground: "#333333" }],
    ["primary", { primary: "#bbbbbb" }],
    ["timeline-accent", { timelineAccent: "#bbbbbb" }],
    ["success", { success: "#bbbbbb" }],
    ["warning", { warning: "#bbbbbb" }],
    ["attention", { attention: "#bbbbbb" }],
    ["destructive", { destructive: "#bbbbbb" }],
    ["pr-merged", { prMerged: "#bbbbbb" }],
  ] as const)("rejects an unsafe %s edit before writing CSS", (target, override) => {
    const edit = { ...colors(target), ...override };
    expect(editThemeInputSchema.safeParse({ themeId: "copy", mode: "light", edit }).success).toBe(true);
    expect(() => applyThemeEdit("", { mode: "light", edit })).toThrow(/would be|Canvas \/ ink/);
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

  it("derives typography, rhythm, touch rows, radius, and the complete shadow ladder", () => {
    let css = applyThemeEdit("", {
      mode: "light",
      edit: { kind: "typography", fontSans: "system-ui, sans-serif", fontMono: "ui-monospace, monospace", textScale: 1.1, lineHeight: 0.9 },
    });
    css = applyThemeEdit(css, {
      mode: "light",
      edit: { kind: "rhythm", density: 3.5, tracking: 0.02, rowHeight: 30, iconStroke: 2 },
    });
    css = applyThemeEdit(css, { mode: "light", edit: { kind: "radius", value: 12 } });
    css = applyThemeEdit(css, {
      mode: "dark",
      edit: { kind: "shadow", x: -2, y: 3, blur: 4, spread: -1, color: "#112233", opacity: 40 },
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
      edit: { kind: "shadow", x: 0, y: 2, blur: 0, spread: 0, color: "#000000", opacity: 80 },
    });
    expect(css).toContain("--shadow-2xl: 0px 12px 24px -4px color-mix(in oklab, #000000 100%, transparent);");
    expect(css).not.toContain("112%");
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
      expect(result).toEqual({ catalog: { activeThemeId: "handmade" }, themeId: "handmade", forkedFrom: null, undoToken: null });
      expect(applyTheme).toHaveBeenCalledWith("handmade");
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
      });
      expect(applyTheme).toHaveBeenCalledWith(expectedId);

      await expect(editor.undoThemeFork({ undoToken: result.undoToken! })).resolves.toEqual({ activeThemeId: id });
      await expect(readFile(join(themeDirectory, expectedId, "theme.css"), "utf8")).rejects.toThrow();
      expect(selectTheme).toHaveBeenCalledWith(id);
      expect(loadCatalog).toHaveBeenCalledOnce();
    } finally {
      await rm(themeDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an unsafe built-in edit before allocating its durable copy", async () => {
    const themeDirectory = await mkdtemp(join(tmpdir(), "theme-preview-rejected-fork-"));
    const editor = createThemeEditor({
      resolveTheme: async (): Promise<EditableThemeResource> => ({
        id: "default", name: "Default", source: "builtin", css: ":root { --canvas: #f4f4f4; }", filePath: null, themeDirectory,
      }),
      applyTheme: async (themeId: string) => ({ activeThemeId: themeId }),
      selectTheme: async () => {},
      loadCatalog: async () => ({ activeThemeId: "default" }),
    });

    try {
      await expect(editor.editTheme({
        themeId: "default",
        mode: "light",
        edit: { ...colors("canvas"), canvas: "#9fa2a8" },
      })).rejects.toThrow("Keep text at 4.5:1 and controls at 3.0:1 or better");
      expect(await readdir(themeDirectory)).toEqual([]);
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
