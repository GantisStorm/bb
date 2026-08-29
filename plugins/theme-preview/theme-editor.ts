import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

const cssHexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/, "Expected a six- or eight-digit hex color");

const fontStackSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[a-zA-Z0-9 "'_,.-]+$/, "Font stacks may contain font names, quotes, commas, spaces, periods, and hyphens");

const finiteNumber = () => z.number().finite();

export const themeEditSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("colors"),
      family: z.enum(["anchors", "sidebar", "primary", "timeline", "status"]),
      canvas: cssHexColorSchema,
      ink: cssHexColorSchema,
      sidebar: cssHexColorSchema,
      sidebarForeground: cssHexColorSchema,
      primary: cssHexColorSchema,
      timelineAccent: cssHexColorSchema,
      success: cssHexColorSchema,
      warning: cssHexColorSchema,
      attention: cssHexColorSchema,
      destructive: cssHexColorSchema,
      prMerged: cssHexColorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("typography"),
      fontSans: fontStackSchema,
      fontMono: fontStackSchema,
      textScale: finiteNumber().min(0.9).max(1.1),
      lineHeight: finiteNumber().min(0.9).max(1.15),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rhythm"),
      density: finiteNumber().min(3).max(5),
      tracking: finiteNumber().min(-0.04).max(0.08),
      rowHeight: finiteNumber().min(24).max(40),
      iconStroke: finiteNumber().min(1).max(2.5),
    })
    .strict(),
  z.object({ kind: z.literal("radius"), value: finiteNumber().min(0).max(20) }).strict(),
  z
    .object({
      kind: z.literal("shadow"),
      x: finiteNumber().min(-24).max(24),
      y: finiteNumber().min(-24).max(24),
      blur: finiteNumber().min(0).max(48),
      spread: finiteNumber().min(-24).max(24),
      color: cssHexColorSchema,
      opacity: finiteNumber().int().min(0).max(80),
    })
    .strict(),
]);

export const editThemeInputSchema = z
  .object({
    themeId: z.string().min(1),
    mode: z.enum(["light", "dark"]),
    edit: themeEditSchema,
  })
  .strict();

export type ThemeEditInput = z.infer<typeof editThemeInputSchema>;

export type ThemeSourceKind = "builtin" | "custom" | "plugin";

export interface EditableThemeResource {
  id: string;
  name: string;
  source: ThemeSourceKind;
  css: string;
  /** Present only for a custom theme that can be edited in place. */
  filePath: string | null;
  themeDirectory: string;
}

interface ThemeEditorDependencies<Catalog> {
  resolveTheme(themeId: string): Promise<EditableThemeResource>;
  applyTheme(themeId: string): Promise<Catalog>;
}

export interface ThemeEditResult<Catalog> {
  catalog: Catalog;
  themeId: string;
  forkedFrom: string | null;
}

const MANAGED_START = "/* theme-preview:managed:start */";
const MANAGED_END = "/* theme-preview:managed:end */";
const FORK_NAME_PATTERN = /\/\* theme-preview:fork-name:([A-Za-z0-9_-]+) \*\//;
const CUSTOM_THEME_CSS_MAX_LENGTH = 256_000;

type Mode = "light" | "dark";
type DeclarationMap = Map<string, string>;

interface ManagedDeclarations {
  shared: DeclarationMap;
  light: DeclarationMap;
  dark: DeclarationMap;
}

const emptyManagedDeclarations = (): ManagedDeclarations => ({
  shared: new Map(),
  light: new Map(),
  dark: new Map(),
});

const DECLARATION_ORDER = [
  "tp-text-scale",
  "tp-line-height",
  "tp-shadow-color",
  "tp-shadow-opacity-percent",
  "canvas",
  "ink",
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "secondary",
  "secondary-foreground",
  "accent",
  "accent-foreground",
  "muted",
  "muted-foreground",
  "subtle-foreground",
  "readback-foreground",
  "version-upgrade",
  "state-hover",
  "state-active",
  "border",
  "border-hairline",
  "border-seam",
  "border-seam-vertical",
  "input",
  "surface-recessed",
  "surface-recessed-solid",
  "surface-recessed-soft-solid",
  "surface-raised",
  "surface-raised-solid",
  "surface-scrim",
  "pill-surface",
  "pill-surface-border",
  "pill-foreground",
  "pill-icon",
  "pill-shadow",
  "pill-surface-selected",
  "pill-surface-selected-border",
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-search-match",
  "sidebar-search-match-border",
  "sidebar-ring",
  "primary",
  "primary-foreground",
  "ring",
  "surface-selected",
  "surface-selected-border",
  "timeline-accent",
  "file-accent",
  "success",
  "success-foreground",
  "warning",
  "warning-text",
  "attention",
  "surface-attention",
  "destructive",
  "destructive-foreground",
  "destructive-text",
  "surface-destructive",
  "surface-destructive-border",
  "pr-merged",
  "diff-added",
  "diff-removed",
  "font-sans",
  "font-mono",
  "text-2xs",
  "text-2xs--line-height",
  "text-xs",
  "text-xs--line-height",
  "text-sm",
  "text-sm--line-height",
  "text-base",
  "text-base--line-height",
  "spacing",
  "tracking-normal",
  "bb-sidebar-row-height",
  "bb-sidebar-row-height-coarse",
  "icon-stroke-width",
  "radius",
  "shadow-x",
  "shadow-y",
  "shadow-blur",
  "shadow-spread",
  "shadow-opacity",
  "shadow-color",
  "shadow-2xs",
  "shadow-xs",
  "shadow-sm",
  "shadow",
  "shadow-md",
  "shadow-lift",
  "shadow-lg",
  "shadow-xl",
  "shadow-2xl",
] as const;

const declarationRank = new Map<string, number>(DECLARATION_ORDER.map((name, index) => [name, index]));

function sortedDeclarations(declarations: DeclarationMap): Array<[string, string]> {
  return [...declarations.entries()].sort(([first], [second]) => {
    const firstRank = declarationRank.get(first) ?? Number.MAX_SAFE_INTEGER;
    const secondRank = declarationRank.get(second) ?? Number.MAX_SAFE_INTEGER;
    return firstRank - secondRank || first.localeCompare(second);
  });
}

function parseDeclarations(body: string, target: DeclarationMap): void {
  for (const match of body.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    target.set(match[1], match[2].trim());
  }
}

function managedRange(css: string): { start: number; end: number; block: string } | null {
  const start = css.indexOf(MANAGED_START);
  const endMarkerStart = css.indexOf(MANAGED_END);
  if (start === -1 && endMarkerStart === -1) return null;
  if (start === -1 || endMarkerStart === -1 || endMarkerStart < start) {
    throw new Error("Theme Preview managed block markers are incomplete");
  }
  if (css.indexOf(MANAGED_START, start + MANAGED_START.length) !== -1 || css.indexOf(MANAGED_END, endMarkerStart + MANAGED_END.length) !== -1) {
    throw new Error("Theme Preview found more than one managed block");
  }
  const end = endMarkerStart + MANAGED_END.length;
  return { start, end, block: css.slice(start, end) };
}

function parseManagedDeclarations(css: string): ManagedDeclarations {
  const result = emptyManagedDeclarations();
  const range = managedRange(css);
  if (!range) return result;
  const inner = range.block
    .slice(MANAGED_START.length, -MANAGED_END.length)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (selector === ":root") parseDeclarations(match[2], result.shared);
    else if (selector === ":root, .light" || selector === ":root:not(.dark), .light:not(.dark)") parseDeclarations(match[2], result.light);
    else if (selector === ".dark") parseDeclarations(match[2], result.dark);
  }
  return result;
}

function renderDeclarationBlock(selector: string, declarations: DeclarationMap): string {
  if (declarations.size === 0) return "";
  const body = sortedDeclarations(declarations)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

function renderManagedBlock(declarations: ManagedDeclarations): string {
  const blocks = [
    renderDeclarationBlock(":root", declarations.shared),
    // The managed block is appended after the source theme. Restrict light
    // overrides so they cannot beat an earlier `.dark` source block by order.
    renderDeclarationBlock(":root:not(.dark), .light:not(.dark)", declarations.light),
    renderDeclarationBlock(".dark", declarations.dark),
  ].filter(Boolean);
  if (declarations.shared.has("tracking-normal")) {
    blocks.push("body {\n  letter-spacing: var(--tracking-normal);\n}");
  }
  return `${MANAGED_START}\n/* Updated by Theme Preview. CSS outside this block remains user-owned. */\n${blocks.join("\n\n")}\n${MANAGED_END}`;
}

function replaceDeclarations(target: DeclarationMap, owned: readonly string[], next: Record<string, string>): void {
  for (const name of owned) target.delete(name);
  for (const [name, value] of Object.entries(next)) target.set(name, value);
}

function formatNumber(value: number, fractionDigits = 4): string {
  const rounded = Number(value.toFixed(fractionDigits));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function px(value: number): string {
  return `${formatNumber(value)}px`;
}

const ANCHOR_TOKENS = [
  "canvas", "ink", "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "secondary", "secondary-foreground", "accent", "accent-foreground", "muted", "muted-foreground",
  "subtle-foreground", "readback-foreground", "version-upgrade", "state-hover", "state-active", "border",
  "border-hairline", "border-seam", "border-seam-vertical", "input", "surface-recessed", "surface-recessed-solid",
  "surface-recessed-soft-solid", "surface-raised", "surface-raised-solid", "surface-scrim", "pill-surface",
  "pill-surface-border", "pill-foreground", "pill-icon", "pill-shadow", "pill-surface-selected",
  "pill-surface-selected-border",
] as const;

function anchorDeclarations(mode: Mode, canvas: string, ink: string): Record<string, string> {
  const dark = mode === "dark";
  return {
    canvas,
    ink,
    background: "var(--canvas)",
    foreground: "var(--ink)",
    card: "var(--canvas)",
    "card-foreground": "var(--ink)",
    popover: "var(--canvas)",
    "popover-foreground": "var(--ink)",
    secondary: `color-mix(in oklch, var(--ink) ${dark ? 13 : 8}%, var(--canvas))`,
    "secondary-foreground": "var(--ink)",
    accent: `color-mix(in oklch, var(--ink) ${dark ? 13 : 8}%, var(--canvas))`,
    "accent-foreground": "var(--ink)",
    muted: `color-mix(in oklch, var(--ink) ${dark ? 16 : 11}%, var(--canvas))`,
    "muted-foreground": `color-mix(in oklch, var(--ink) ${dark ? 95 : 82}%, var(--canvas))`,
    "subtle-foreground": `color-mix(in oklch, var(--ink) ${dark ? 79 : 74}%, var(--canvas))`,
    "readback-foreground": `color-mix(in oklch, var(--ink) ${dark ? 85 : 78}%, var(--canvas))`,
    "version-upgrade": "color-mix(in oklch, var(--ink) 96%, var(--canvas))",
    "state-hover": `color-mix(in oklab, var(--ink) ${dark ? 13.8 : 5.9}%, transparent)`,
    "state-active": `color-mix(in oklab, var(--ink) ${dark ? 22.5 : 11.8}%, transparent)`,
    border: `color-mix(in oklch, var(--ink) ${dark ? 19.4 : 14}%, var(--canvas))`,
    "border-hairline": `color-mix(in oklch, var(--ink) ${dark ? 21 : 14.7}%, var(--canvas))`,
    "border-seam": `color-mix(in oklch, var(--ink) ${dark ? 11 : 9.5}%, var(--canvas))`,
    "border-seam-vertical": "var(--border-seam)",
    input: `color-mix(in oklch, var(--ink) ${dark ? 32.6 : 29.5}%, var(--canvas))`,
    "surface-recessed": "color-mix(in oklab, var(--ink) 6%, transparent)",
    "surface-recessed-solid": "color-mix(in oklch, var(--ink) 6%, var(--canvas))",
    "surface-recessed-soft-solid": "color-mix(in oklch, var(--ink) 4.2%, var(--canvas))",
    "surface-raised": "color-mix(in oklab, var(--ink) 2.5%, transparent)",
    "surface-raised-solid": "color-mix(in oklch, var(--ink) 2.5%, var(--canvas))",
    "surface-scrim": "color-mix(in oklab, var(--canvas) 92%, transparent)",
    "pill-surface": `linear-gradient(to bottom, color-mix(in oklch, var(--ink) ${dark ? 13 : 4.4}%, var(--canvas)), color-mix(in oklch, var(--ink) ${dark ? 11.9 : 4.7}%, var(--canvas)))`,
    "pill-surface-border": "var(--border)",
    "pill-foreground": "var(--ink)",
    "pill-icon": "var(--ink)",
    "pill-shadow": `0 1px 1px 0 color-mix(in oklab, var(--ink) ${dark ? 8 : 2}%, transparent)`,
    "pill-surface-selected": `linear-gradient(to bottom, color-mix(in oklch, var(--ink) ${dark ? 20.7 : 11.8}%, var(--canvas)), color-mix(in oklch, var(--ink) ${dark ? 18.7 : 13}%, var(--canvas)))`,
    "pill-surface-selected-border": `color-mix(in oklch, var(--ink) ${dark ? 25.2 : 19.2}%, var(--canvas))`,
  };
}

const SIDEBAR_TOKENS = [
  "sidebar", "sidebar-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border",
  "sidebar-search-match", "sidebar-search-match-border", "sidebar-ring",
] as const;

function sidebarDeclarations(mode: Mode, sidebar: string, foreground: string): Record<string, string> {
  const dark = mode === "dark";
  return {
    sidebar,
    "sidebar-foreground": foreground,
    "sidebar-accent": `color-mix(in oklch, var(--sidebar-foreground) ${dark ? 12 : 8}%, var(--sidebar))`,
    "sidebar-accent-foreground": "var(--sidebar-foreground)",
    "sidebar-border": `color-mix(in oklch, var(--sidebar-foreground) ${dark ? 18.1 : 14}%, var(--sidebar))`,
    // BB's documented chromatic exception: oklab preserves the manilla hue
    // when it is mixed against an achromatic/tinted canvas.
    "sidebar-search-match": `color-mix(in oklab, oklch(0.8 0.13 88), var(--canvas) ${dark ? 80 : 76}%)`,
    "sidebar-search-match-border": `color-mix(in oklab, oklch(0.8 0.13 88), var(--canvas) ${dark ? 67 : 60}%)`,
    "sidebar-ring": "var(--primary)",
  };
}

const PRIMARY_TOKENS = [
  "primary", "primary-foreground", "ring", "sidebar-ring", "surface-selected", "surface-selected-border",
] as const;

function primaryDeclarations(mode: Mode, primary: string): Record<string, string> {
  return {
    primary,
    "primary-foreground": "var(--canvas)",
    ring: "var(--primary)",
    "sidebar-ring": "var(--primary)",
    "surface-selected": `color-mix(in oklab, var(--primary) ${mode === "dark" ? 12 : 16}%, transparent)`,
    "surface-selected-border": "color-mix(in oklab, var(--primary) 35%, transparent)",
  };
}

const TIMELINE_TOKENS = ["timeline-accent", "file-accent"] as const;

const STATUS_TOKENS = [
  "success", "success-foreground", "warning", "warning-text", "attention", "surface-attention", "destructive",
  "destructive-foreground", "destructive-text", "surface-destructive", "surface-destructive-border", "pr-merged",
  "diff-added", "diff-removed",
] as const;

function statusDeclarations(mode: Mode, edit: Extract<ThemeEditInput["edit"], { kind: "colors" }>): Record<string, string> {
  return {
    success: edit.success,
    "success-foreground": "color-mix(in oklch, var(--success) 45%, var(--ink))",
    warning: edit.warning,
    "warning-text": `color-mix(in oklch, var(--warning) ${mode === "dark" ? 80 : 60}%, var(--ink))`,
    attention: edit.attention,
    "surface-attention": `color-mix(in oklab, var(--attention) ${mode === "dark" ? 12 : 14}%, transparent)`,
    destructive: edit.destructive,
    "destructive-foreground": mode === "dark" ? "var(--ink)" : "var(--canvas)",
    "destructive-text": `color-mix(in oklch, var(--destructive) ${mode === "dark" ? 65 : 85}%, var(--ink))`,
    "surface-destructive": `color-mix(in oklab, var(--destructive) ${mode === "dark" ? 8 : 6}%, transparent)`,
    "surface-destructive-border": `color-mix(in oklab, var(--destructive) ${mode === "dark" ? 30 : 25}%, transparent)`,
    "pr-merged": edit.prMerged,
    "diff-added": "var(--success)",
    "diff-removed": "var(--destructive)",
  };
}

const TYPOGRAPHY_TOKENS = [
  "tp-text-scale", "tp-line-height", "font-sans", "font-mono", "text-2xs", "text-2xs--line-height",
  "text-xs", "text-xs--line-height", "text-sm", "text-sm--line-height", "text-base", "text-base--line-height",
] as const;

function typographyDeclarations(edit: Extract<ThemeEditInput["edit"], { kind: "typography" }>): Record<string, string> {
  const steps = {
    "2xs": { size: 10, lineHeight: 14 },
    xs: { size: 12, lineHeight: 16 },
    sm: { size: 13, lineHeight: 19 },
    base: { size: 15, lineHeight: 22 },
  } as const;
  const result: Record<string, string> = {
    "tp-text-scale": formatNumber(edit.textScale),
    "tp-line-height": formatNumber(edit.lineHeight),
    "font-sans": edit.fontSans,
    "font-mono": edit.fontMono,
  };
  for (const [name, step] of Object.entries(steps)) {
    result[`text-${name}`] = px(step.size * edit.textScale);
    result[`text-${name}--line-height`] = px(step.lineHeight * edit.lineHeight);
  }
  return result;
}

const RHYTHM_TOKENS = [
  "spacing", "tracking-normal", "bb-sidebar-row-height", "bb-sidebar-row-height-coarse", "icon-stroke-width",
] as const;

const RADIUS_TOKENS = ["radius"] as const;

const SHADOW_SHARED_TOKENS = ["shadow-x", "shadow-y", "shadow-blur", "shadow-spread"] as const;
const SHADOW_MODE_TOKENS = [
  "tp-shadow-color", "tp-shadow-opacity-percent", "shadow-opacity", "shadow-color", "shadow-2xs", "shadow-xs",
  "shadow-sm", "shadow", "shadow-md", "shadow-lift", "shadow-lg", "shadow-xl", "shadow-2xl",
] as const;

function shadowColor(color: string, opacity: number, factor: number): string {
  return `color-mix(in oklab, ${color} ${formatNumber(Math.min(100, opacity * factor))}%, transparent)`;
}

function shadowLayer(
  edit: Extract<ThemeEditInput["edit"], { kind: "shadow" }>,
  depth: number,
  blurAddition: number,
  spreadAddition: number,
  opacityFactor: number,
): string {
  return `${px(edit.x * depth)} ${px(edit.y * depth)} ${px(edit.blur + blurAddition)} ${px(edit.spread + spreadAddition)} ${shadowColor(edit.color, edit.opacity, opacityFactor)}`;
}

function shadowDeclarations(edit: Extract<ThemeEditInput["edit"], { kind: "shadow" }>): Record<string, string> {
  const sm = `${shadowLayer(edit, 1, 0, 0, 0.75)}, ${shadowLayer(edit, 0.5, 2, -1, 0.75)}`;
  return {
    "tp-shadow-color": edit.color,
    "tp-shadow-opacity-percent": formatNumber(edit.opacity),
    "shadow-opacity": formatNumber(edit.opacity / 100),
    "shadow-color": shadowColor(edit.color, edit.opacity, 1),
    "shadow-2xs": shadowLayer(edit, 0.5, 0, 0, 0.45),
    "shadow-xs": shadowLayer(edit, 0.75, 0, 0, 0.45),
    "shadow-sm": sm,
    shadow: sm,
    "shadow-md": `${shadowLayer(edit, 1, 0, 0, 0.75)}, ${shadowLayer(edit, 1, 4, -1, 1)}`,
    "shadow-lift": `${px(edit.x)} ${px(-Math.max(4, Math.abs(edit.y) * 2))} ${px(edit.blur + 12)} ${px(edit.spread - 4)} ${shadowColor(edit.color, edit.opacity, 0.45)}`,
    "shadow-lg": `${shadowLayer(edit, 1, 0, 0, 0.75)}, ${shadowLayer(edit, 2, 8, -1, 1)}`,
    "shadow-xl": `${shadowLayer(edit, 1, 0, 0, 0.85)}, ${shadowLayer(edit, 4, 12, -2, 1)}`,
    "shadow-2xl": shadowLayer(edit, 6, 24, -4, 1.4),
  };
}

/** Update exactly one editor-owned family while retaining every other family. */
export function applyThemeEdit(css: string, input: Pick<ThemeEditInput, "mode" | "edit">): string {
  const declarations = parseManagedDeclarations(css);
  const target = declarations[input.mode];
  const { edit } = input;

  switch (edit.kind) {
    case "colors":
      if (edit.family === "anchors") replaceDeclarations(target, ANCHOR_TOKENS, anchorDeclarations(input.mode, edit.canvas, edit.ink));
      else if (edit.family === "sidebar") replaceDeclarations(target, SIDEBAR_TOKENS, sidebarDeclarations(input.mode, edit.sidebar, edit.sidebarForeground));
      else if (edit.family === "primary") replaceDeclarations(target, PRIMARY_TOKENS, primaryDeclarations(input.mode, edit.primary));
      else if (edit.family === "timeline") replaceDeclarations(target, TIMELINE_TOKENS, { "timeline-accent": edit.timelineAccent, "file-accent": "var(--timeline-accent)" });
      else replaceDeclarations(target, STATUS_TOKENS, statusDeclarations(input.mode, edit));
      break;
    case "typography":
      replaceDeclarations(declarations.shared, TYPOGRAPHY_TOKENS, typographyDeclarations(edit));
      break;
    case "rhythm":
      replaceDeclarations(declarations.shared, RHYTHM_TOKENS, {
        spacing: px(edit.density),
        "tracking-normal": `${formatNumber(edit.tracking)}em`,
        "bb-sidebar-row-height": px(edit.rowHeight),
        "bb-sidebar-row-height-coarse": px(Math.max(40, edit.rowHeight + 12)),
        "icon-stroke-width": formatNumber(edit.iconStroke),
      });
      break;
    case "radius":
      replaceDeclarations(declarations.shared, RADIUS_TOKENS, { radius: px(edit.value) });
      break;
    case "shadow":
      replaceDeclarations(declarations.shared, SHADOW_SHARED_TOKENS, {
        "shadow-x": px(edit.x),
        "shadow-y": px(edit.y),
        "shadow-blur": px(edit.blur),
        "shadow-spread": px(edit.spread),
      });
      replaceDeclarations(target, SHADOW_MODE_TOKENS, shadowDeclarations(edit));
      break;
  }

  const managed = renderManagedBlock(declarations);
  const range = managedRange(css);
  const next = range
    ? `${css.slice(0, range.start)}${managed}${css.slice(range.end)}`
    : `${css}${css.length === 0 ? "" : css.endsWith("\n") ? "\n" : "\n\n"}${managed}\n`;
  if (next.length > CUSTOM_THEME_CSS_MAX_LENGTH) {
    throw new Error(`Edited theme exceeds the ${CUSTOM_THEME_CSS_MAX_LENGTH}-character custom-theme limit`);
  }
  return next;
}

async function writeFileAtomically(path: string, contents: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function safeForkBase(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "") || "theme";
  return `${slug.slice(0, 54)}-copy`;
}

function withForkName(css: string, name: string): string {
  const encoded = Buffer.from(name, "utf8").toString("base64url");
  return `${css.trimEnd()}\n\n/* theme-preview:fork-name:${encoded} */\n`;
}

/** A plugin-only display label for forks; bb Core still owns the durable id. */
export function readThemePreviewForkName(css: string): string | null {
  const encoded = FORK_NAME_PATTERN.exec(css)?.[1];
  if (!encoded) return null;
  try {
    const name = Buffer.from(encoded, "base64url").toString("utf8").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

async function allocateForkDirectory(themeDirectory: string, name: string): Promise<{ id: string; name: string; directory: string }> {
  await mkdir(themeDirectory, { recursive: true });
  const base = safeForkBase(name);
  for (let index = 1; index <= 999; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const id = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    const directory = join(themeDirectory, id);
    try {
      await mkdir(directory);
      return { id, name: `${name} copy${index === 1 ? "" : ` ${index}`}`, directory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not allocate a unique fork name for '${name}'`);
}

/**
 * Serialize writes from this plugin instance. This prevents two rapid controls
 * from losing each other's managed families without introducing a user-facing
 * conflict model or touching CSS outside the managed block.
 */
export function createThemeEditor<Catalog>(dependencies: ThemeEditorDependencies<Catalog>) {
  let queue: Promise<void> = Promise.resolve();

  const editTheme = (input: ThemeEditInput): Promise<ThemeEditResult<Catalog>> => {
    const operation = queue.then(async () => {
      const resource = await dependencies.resolveTheme(input.themeId);
      if (resource.source === "custom") {
        if (!resource.filePath) throw new Error(`Custom theme '${resource.id}' has no editable theme.css`);
        await writeFileAtomically(resource.filePath, applyThemeEdit(resource.css, input));
        const catalog = await dependencies.applyTheme(resource.id);
        return { catalog, themeId: resource.id, forkedFrom: null };
      }

      const fork = await allocateForkDirectory(resource.themeDirectory, resource.name);
      const path = join(fork.directory, "theme.css");
      try {
        await writeFileAtomically(path, withForkName(applyThemeEdit(resource.css, input), fork.name));
      } catch (error) {
        await rm(fork.directory, { recursive: true, force: true });
        throw error;
      }
      const catalog = await dependencies.applyTheme(fork.id);
      return { catalog, themeId: fork.id, forkedFrom: resource.id };
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return { editTheme };
}

export const THEME_PREVIEW_MANAGED_MARKERS = { start: MANAGED_START, end: MANAGED_END } as const;
