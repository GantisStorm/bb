import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const colors = (family: Extract<ThemeEditInput["edit"], { kind: "colors" }>["family"]) => ({
  kind: "colors" as const,
  family,
  canvas: "#f4f4f4",
  ink: "#1a1a1a",
  sidebar: "#20252b",
  sidebarForeground: "#f0f2f4",
  primary: "#3366cc",
  timelineAccent: "#2986cc",
  success: "#238636",
  warning: "#b26a00",
  attention: "#c69000",
  destructive: "#cf222e",
  prMerged: "#8250df",
});

describe("editThemeInputSchema", () => {
  it("accepts every deterministic edit family at its approved boundaries", () => {
    const inputs: ThemeEditInput[] = [
      { themeId: "nord", mode: "light", edit: colors("anchors") },
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
    const { prMerged: _missing, ...partial } = colors("status");
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
});

describe("applyThemeEdit", () => {
  it("preserves user CSS byte-for-byte and accumulates sequential family edits in one block", () => {
    const source = "/* user comment */\n.custom-surface { color: hotpink; }\n";
    const anchors = applyThemeEdit(source, { mode: "light", edit: colors("anchors") });
    const status = applyThemeEdit(anchors, { mode: "dark", edit: colors("status") });
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
    expect(sidebar).toContain("--success: #238636;");
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
      edit: { ...colors("primary"), primary: "#ff00aa" },
    });
    expect(second).toContain("--primary: #ff00aa;");
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
    expect(() => applyThemeEdit(THEME_PREVIEW_MANAGED_MARKERS.start, { mode: "light", edit: colors("anchors") }))
      .toThrow("markers are incomplete");
    const duplicate = `${THEME_PREVIEW_MANAGED_MARKERS.start}\n${THEME_PREVIEW_MANAGED_MARKERS.end}\n${THEME_PREVIEW_MANAGED_MARKERS.start}\n${THEME_PREVIEW_MANAGED_MARKERS.end}`;
    expect(() => applyThemeEdit(duplicate, { mode: "light", edit: colors("anchors") }))
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
    });

    try {
      const result = await editor.editTheme({ themeId: "handmade", mode: "light", edit: colors("timeline") });
      const written = await readFile(filePath, "utf8");
      expect(written.startsWith(source)).toBe(true);
      expect(written).toContain("--timeline-accent: #2986cc;");
      expect(result).toEqual({ catalog: { activeThemeId: "handmade" }, themeId: "handmade", forkedFrom: null });
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
    const editor = createThemeEditor({
      resolveTheme: async (): Promise<EditableThemeResource> => ({
        id, name, source, css: sourceCss, filePath: null, themeDirectory,
      }),
      applyTheme,
    });

    try {
      const result = await editor.editTheme({ themeId: id, mode: "dark", edit: colors("status") });
      const written = await readFile(join(themeDirectory, expectedId, "theme.css"), "utf8");
      expect(written.startsWith(sourceCss)).toBe(true);
      expect(written).toContain("--pr-merged: #8250df;");
      expect(readThemePreviewForkName(written)).toBe(`${name} copy${expectedId.endsWith("-2") ? " 2" : ""}`);
      expect(result).toEqual({ catalog: { activeThemeId: expectedId }, themeId: expectedId, forkedFrom: id });
      expect(applyTheme).toHaveBeenCalledWith(expectedId);
    } finally {
      await rm(themeDirectory, { recursive: true, force: true });
    }
  });
});
