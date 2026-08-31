import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { z } from "zod";
import { DIRECT_COLOR_CONTROLS } from "./taxonomy";

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

const colorTargetSchema = z.enum([
  "canvas",
  "ink",
  "sidebar",
  "sidebar-foreground",
  "primary",
  "timeline-accent",
  "success",
  "warning",
  "attention",
  "destructive",
  "pr-merged",
]);

export const themeEditSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("colors"),
      target: colorTargetSchema,
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
      target: z.enum(["font-sans", "font-mono", "text-scale", "line-height"]),
      fontSans: fontStackSchema,
      fontMono: fontStackSchema,
      textScale: finiteNumber().min(0.9).max(1.1),
      lineHeight: finiteNumber().min(0.9).max(1.15),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rhythm"),
      target: z.enum(["density", "tracking", "sidebar-row", "icon-stroke"]),
      density: finiteNumber().min(3).max(5),
      tracking: finiteNumber().min(-0.04).max(0.08),
      rowHeight: finiteNumber().min(24).max(40),
      iconStroke: finiteNumber().min(1).max(2.5),
    })
    .strict(),
  z.object({ kind: z.literal("radius"), target: z.literal("base"), value: finiteNumber().min(0).max(20) }).strict(),
  z
    .object({
      kind: z.literal("shadow"),
      target: z.enum(["x", "y", "blur", "spread", "color", "opacity"]),
      x: finiteNumber().min(-24).max(24),
      y: finiteNumber().min(-24).max(24),
      blur: finiteNumber().min(0).max(48),
      spread: finiteNumber().min(-24).max(24),
      color: cssHexColorSchema,
      opacity: finiteNumber().int().min(0).max(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal("restore-link"),
      target: z.enum(["sidebar-row", "shadow-color"]),
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

export const undoThemeForkInputSchema = z
  .object({ undoToken: z.string().uuid() })
  .strict();

export type ThemeEditInput = z.infer<typeof editThemeInputSchema>;
export type UndoThemeForkInput = z.infer<typeof undoThemeForkInputSchema>;

export type ThemeSourceKind = "builtin" | "custom" | "plugin";

export interface ThemeLinkStates {
  sidebarRow: "linked" | "custom";
  shadowColor: { light: "linked" | "custom"; dark: "linked" | "custom" };
}

export interface ThemeEditAdjustment {
  control: string;
  label: string;
  scope: "shared" | "light" | "dark";
  from: string;
  to: string;
  invariant: string;
}

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
  applyTheme(themeId: string, filePath: string): Promise<Catalog>;
  selectTheme(themeId: string): Promise<void>;
  loadCatalog(): Promise<Catalog>;
}

export interface ThemeEditResult<Catalog> {
  catalog: Catalog;
  themeId: string;
  forkedFrom: string | null;
  undoToken: string | null;
  committedEdit: ThemeEditInput["edit"];
  adjustments: ThemeEditAdjustment[];
  links: ThemeLinkStates;
}

const MANAGED_START = "/* theme-preview:managed:start */";
const MANAGED_END = "/* theme-preview:managed:end */";
const FORK_NAME_PATTERN = /\/\* theme-preview:fork-name:([A-Za-z0-9_-]+) \*\//;
const CUSTOM_THEME_CSS_MAX_LENGTH = 256_000;
const FORK_UNDO_TTL_MS = 15_000;

interface ForkUndoRecord {
  directory: string;
  expectedCss: string;
  expiresAt: number;
  filePath: string;
  forkedFrom: string;
  themeId: string;
}

type Mode = "light" | "dark";
type DeclarationMap = Map<string, string>;
type ColorEdit = Extract<z.infer<typeof themeEditSchema>, { kind: "colors" }>;
type ColorValueKey = Exclude<keyof ColorEdit, "kind" | "target">;
type ColorFamily = "anchors" | "sidebar" | "primary" | "timeline" | "status";
type Rgba = readonly [number, number, number, number];

const COLOR_TARGET_KEY = {
  canvas: "canvas",
  ink: "ink",
  sidebar: "sidebar",
  "sidebar-foreground": "sidebarForeground",
  primary: "primary",
  "timeline-accent": "timelineAccent",
  success: "success",
  warning: "warning",
  attention: "attention",
  destructive: "destructive",
  "pr-merged": "prMerged",
} as const satisfies Record<ColorEdit["target"], ColorValueKey>;

const COLOR_KEY_FAMILY = {
  canvas: "anchors",
  ink: "anchors",
  sidebar: "sidebar",
  sidebarForeground: "sidebar",
  primary: "primary",
  timelineAccent: "timeline",
  success: "status",
  warning: "status",
  attention: "status",
  destructive: "status",
  prMerged: "status",
} as const satisfies Record<ColorValueKey, ColorFamily>;

interface ColorRelationship {
  label: string;
  subject: ColorValueKey;
  surface: ColorValueKey;
  minimum: number;
}

/** Direct color relationships already expressed by the editor's Theme safety row. */
function colorRelationships(mode: Mode): readonly ColorRelationship[] {
  return [
    { label: "Canvas / ink", subject: "ink", surface: "canvas", minimum: 4.5 },
    { label: "Sidebar / sidebar ink", subject: "sidebarForeground", surface: "sidebar", minimum: 4.5 },
    { label: "Primary controls", subject: "primary", surface: "canvas", minimum: 4.5 },
    { label: "Timeline / files", subject: "timelineAccent", surface: "canvas", minimum: 4.5 },
    { label: "Success", subject: "success", surface: "canvas", minimum: 4.5 },
    { label: "Warning", subject: "warning", surface: "canvas", minimum: 4.5 },
    { label: "Attention / pending", subject: "attention", surface: "canvas", minimum: 3 },
    {
      label: "Destructive controls",
      subject: "destructive",
      surface: mode === "dark" ? "ink" : "canvas",
      minimum: 4.5,
    },
    { label: "Merged", subject: "prMerged", surface: "canvas", minimum: 4.5 },
  ];
}

function parseHexColor(value: string): Rgba {
  const hex = value.slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  ];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

function relativeLuminance(color: Rgba): number {
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

function hexContrast(foreground: string, background: string): number {
  const opaqueBackground = composite(parseHexColor(background), [255, 255, 255, 1]);
  const paintedForeground = composite(parseHexColor(foreground), opaqueBackground);
  const first = relativeLuminance(paintedForeground);
  const second = relativeLuminance(opaqueBackground);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function serializeHexColor(color: Rgba): string {
  const byte = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
  const alpha = Math.round(Math.min(1, Math.max(0, color[3])) * 255);
  return `#${byte(color[0])}${byte(color[1])}${byte(color[2])}${alpha < 255 ? byte(alpha) : ""}`;
}

function interpolateColor(start: Rgba, pole: Rgba, amount: number): Rgba {
  return [
    start[0] + (pole[0] - start[0]) * amount,
    start[1] + (pole[1] - start[1]) * amount,
    start[2] + (pole[2] - start[2]) * amount,
    start[3] + (pole[3] - start[3]) * amount,
  ];
}

/** Find the smallest visible adjustment toward black or white that restores a relationship. */
function deriveContrastingColor(value: string, surface: string, minimum: number): string {
  if (hexContrast(value, surface) >= minimum) return value;
  const start = parseHexColor(value);
  const candidates: Array<{ value: string; distance: number }> = [];
  for (const pole of [[0, 0, 0, 1], [255, 255, 255, 1]] as const satisfies readonly Rgba[]) {
    for (let step = 1; step <= 2048; step += 1) {
      const candidate = serializeHexColor(interpolateColor(start, pole, step / 2048));
      if (hexContrast(candidate, surface) < minimum) continue;
      const resolved = parseHexColor(candidate);
      const distance = (resolved[0] - start[0]) ** 2
        + (resolved[1] - start[1]) ** 2
        + (resolved[2] - start[2]) ** 2
        + ((resolved[3] - start[3]) * 255) ** 2;
      candidates.push({ value: candidate, distance });
      break;
    }
  }
  candidates.sort((first, second) => first.distance - second.distance || first.value.localeCompare(second.value));
  const best = candidates[0];
  if (!best) throw new Error(`Could not derive a color with ${minimum.toFixed(1)}:1 contrast against ${surface}`);
  return best.value;
}

/**
 * Project the edited palette through its directional relationships. The user
 * controls the selected seed; subjects that depend on a changed surface move
 * only as far as needed to keep the palette valid.
 */
function resolveColorRelationships(mode: Mode, edit: ColorEdit): { edit: ColorEdit; families: ReadonlySet<ColorFamily> } {
  const resolved: ColorEdit = { ...edit };
  const target = COLOR_TARGET_KEY[edit.target];
  const affected = new Set<ColorValueKey>([target]);
  const families = new Set<ColorFamily>([COLOR_KEY_FAMILY[target]]);
  const relationships = colorRelationships(mode);

  for (let pass = 0; pass < relationships.length; pass += 1) {
    let changed = false;
    for (const relationship of relationships) {
      if (relationship.subject !== target && !affected.has(relationship.surface)) continue;
      const current = resolved[relationship.subject];
      const next = deriveContrastingColor(current, resolved[relationship.surface], relationship.minimum);
      if (next === current) continue;
      resolved[relationship.subject] = next;
      affected.add(relationship.subject);
      families.add(COLOR_KEY_FAMILY[relationship.subject]);
      changed = true;
    }
    if (!changed) break;
  }

  for (const relationship of relationships) {
    if (!affected.has(relationship.subject) && !affected.has(relationship.surface)) continue;
    const ratio = hexContrast(resolved[relationship.subject], resolved[relationship.surface]);
    if (ratio < relationship.minimum) {
      throw new Error(`${relationship.label} could not be kept at ${relationship.minimum.toFixed(1)}:1 or better`);
    }
  }
  return { edit: resolved, families };
}

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

const LINKED_SIDEBAR_ROW = "calc(20px + var(--spacing) + var(--spacing))";
const LINKED_SIDEBAR_ROW_COARSE = "max(40px, calc(var(--bb-sidebar-row-height) + 12px))";
const LINKED_SHADOW_COLOR = "var(--ink)";

function normalizeCssRelationship(value: string): string {
  return value.replace(/\s+/g, "");
}

function sourceDeclarations(css: string): ManagedDeclarations {
  const result = emptyManagedDeclarations();
  const range = managedRange(css);
  const source = (range ? `${css.slice(0, range.start)}${css.slice(range.end)}` : css)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((selector) => selector.trim());
    if (selectors.some((selector) => selector === ":root")) parseDeclarations(match[2], result.shared);
    if (selectors.some((selector) => selector === ".light" || selector === ".light:not(.dark)" || selector === ":root:not(.dark)" || selector === "html:not(.dark)")) {
      parseDeclarations(match[2], result.light);
    }
    if (selectors.some((selector) => selector === ".dark" || selector === ":root.dark" || selector === "html.dark")) {
      parseDeclarations(match[2], result.dark);
    }
  }
  return result;
}

function effectiveDeclaration(
  managed: ManagedDeclarations,
  source: ManagedDeclarations,
  mode: Mode,
  name: string,
): string | undefined {
  return managed[mode].get(name)
    ?? managed.shared.get(name)
    ?? source[mode].get(name)
    ?? source.shared.get(name);
}

/** Relationship state is encoded in the existing managed declarations. */
export function classifyThemeLinks(css: string): ThemeLinkStates {
  const managed = parseManagedDeclarations(css);
  const source = sourceDeclarations(css);
  const managedRow = managed.shared.get("bb-sidebar-row-height");
  const sidebarRow = managedRow !== undefined
    ? normalizeCssRelationship(managedRow) === normalizeCssRelationship(LINKED_SIDEBAR_ROW) ? "linked" : "custom"
    : source.shared.has("bb-sidebar-row-height")
      || source.light.has("bb-sidebar-row-height")
      || source.dark.has("bb-sidebar-row-height")
      ? "custom"
      : "linked";

  const shadowColor = (mode: Mode): "linked" | "custom" => {
    const managedValue = managed[mode].get("tp-shadow-color");
    if (managedValue !== undefined) {
      return normalizeCssRelationship(managedValue) === normalizeCssRelationship(LINKED_SHADOW_COLOR) ? "linked" : "custom";
    }
    const hasSourceValue = source[mode].has("tp-shadow-color")
      || source[mode].has("shadow-color")
      || source.shared.has("tp-shadow-color")
      || source.shared.has("shadow-color");
    return hasSourceValue ? "custom" : "linked";
  };

  return { sidebarRow, shadowColor: { light: shadowColor("light"), dark: shadowColor("dark") } };
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

function shadowColor(colorExpression: string, opacity: number, factor: number): string {
  return `color-mix(in oklab, ${colorExpression} ${formatNumber(Math.min(100, opacity * factor))}%, transparent)`;
}

function shadowLayer(
  edit: Extract<ThemeEditInput["edit"], { kind: "shadow" }>,
  depth: number,
  blurAddition: number,
  spreadAddition: number,
  opacityFactor: number,
  colorExpression: string,
): string {
  return `${px(edit.x * depth)} ${px(edit.y * depth)} ${px(edit.blur + blurAddition)} ${px(edit.spread + spreadAddition)} ${shadowColor(colorExpression, edit.opacity, opacityFactor)}`;
}

function shadowDeclarations(
  edit: Extract<ThemeEditInput["edit"], { kind: "shadow" }>,
  colorValue: string,
): Record<string, string> {
  const colorExpression = "var(--tp-shadow-color)";
  const layer = (depth: number, blurAddition: number, spreadAddition: number, opacityFactor: number) =>
    shadowLayer(edit, depth, blurAddition, spreadAddition, opacityFactor, colorExpression);
  const sm = `${layer(1, 0, 0, 0.75)}, ${layer(0.5, 2, -1, 0.75)}`;
  return {
    "tp-shadow-color": colorValue,
    "tp-shadow-opacity-percent": formatNumber(edit.opacity),
    "shadow-opacity": formatNumber(edit.opacity / 100),
    "shadow-color": shadowColor(colorExpression, edit.opacity, 1),
    "shadow-2xs": layer(0.5, 0, 0, 0.45),
    "shadow-xs": layer(0.75, 0, 0, 0.45),
    "shadow-sm": sm,
    shadow: sm,
    "shadow-md": `${layer(1, 0, 0, 0.75)}, ${layer(1, 4, -1, 1)}`,
    "shadow-lift": `${px(edit.x)} ${px(-Math.max(4, Math.abs(edit.y) * 2))} ${px(edit.blur + 12)} ${px(edit.spread - 4)} ${shadowColor(colorExpression, edit.opacity, 0.45)}`,
    "shadow-lg": `${layer(1, 0, 0, 0.75)}, ${layer(2, 8, -1, 1)}`,
    "shadow-xl": `${layer(1, 0, 0, 0.85)}, ${layer(4, 12, -2, 1)}`,
    "shadow-2xl": layer(6, 24, -4, 1.4),
  };
}

const COLOR_ADJUSTMENT_ORDER: readonly ColorValueKey[] = DIRECT_COLOR_CONTROLS.map(({ id }) => COLOR_TARGET_KEY[id]);

function colorControl(key: ColorValueKey): { control: string; label: string } {
  const entry = DIRECT_COLOR_CONTROLS.find(({ id }) => COLOR_TARGET_KEY[id] === key);
  if (!entry) throw new Error(`Missing Theme Preview taxonomy entry for ${key}`);
  return { control: `color:${entry.id}`, label: entry.label };
}

export interface AppliedThemeEdit {
  css: string;
  committedEdit: ThemeEditInput["edit"];
  adjustments: ThemeEditAdjustment[];
  links: ThemeLinkStates;
}

function numberDeclaration(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Update the directly edited family and any affected dependent families. */
export function applyThemeEditWithEffects(
  css: string,
  input: Pick<ThemeEditInput, "mode" | "edit">,
): AppliedThemeEdit {
  const declarations = parseManagedDeclarations(css);
  const source = sourceDeclarations(css);
  const linksBefore = classifyThemeLinks(css);
  const target = declarations[input.mode];
  const { edit } = input;
  let committedEdit: ThemeEditInput["edit"] = edit;
  const adjustments: ThemeEditAdjustment[] = [];

  switch (edit.kind) {
    case "colors": {
      const linkedShadowInkBefore = edit.target === "ink" && linksBefore.shadowColor[input.mode] === "linked"
        ? effectiveDeclaration(declarations, source, input.mode, "ink")
        : undefined;
      const resolved = resolveColorRelationships(input.mode, edit);
      committedEdit = resolved.edit;
      if (resolved.families.has("anchors")) {
        replaceDeclarations(target, ANCHOR_TOKENS, anchorDeclarations(input.mode, resolved.edit.canvas, resolved.edit.ink));
      }
      if (resolved.families.has("sidebar")) {
        replaceDeclarations(target, SIDEBAR_TOKENS, sidebarDeclarations(input.mode, resolved.edit.sidebar, resolved.edit.sidebarForeground));
      }
      if (resolved.families.has("primary")) {
        replaceDeclarations(target, PRIMARY_TOKENS, primaryDeclarations(input.mode, resolved.edit.primary));
      }
      if (resolved.families.has("timeline")) {
        replaceDeclarations(target, TIMELINE_TOKENS, { "timeline-accent": resolved.edit.timelineAccent, "file-accent": "var(--timeline-accent)" });
      }
      if (resolved.families.has("status")) {
        replaceDeclarations(target, STATUS_TOKENS, statusDeclarations(input.mode, resolved.edit));
      }
      const relationships = colorRelationships(input.mode);
      for (const key of COLOR_ADJUSTMENT_ORDER) {
        if (resolved.edit[key] === edit[key]) continue;
        const relationship = relationships.find(({ subject }) => subject === key);
        const control = colorControl(key);
        adjustments.push({
          ...control,
          scope: input.mode,
          from: edit[key],
          to: resolved.edit[key],
          invariant: relationship
            ? `${relationship.label} stays at ${relationship.minimum.toFixed(1)}:1 or better`
            : "Theme relationship remains valid",
        });
      }
      if (linkedShadowInkBefore !== undefined && linkedShadowInkBefore !== resolved.edit.ink) {
        adjustments.push({
          control: "shadow:color",
          label: "Shadow color",
          scope: input.mode,
          from: linkedShadowInkBefore,
          to: resolved.edit.ink,
          invariant: "Shadow color follows Ink while linked",
        });
      }
      break;
    }
    case "typography":
      replaceDeclarations(declarations.shared, TYPOGRAPHY_TOKENS, typographyDeclarations(edit));
      break;
    case "rhythm": {
      const rowLinked = edit.target === "sidebar-row" ? false : linksBefore.sidebarRow === "linked";
      const linkedRowHeight = 20 + edit.density * 2;
      committedEdit = rowLinked ? { ...edit, rowHeight: linkedRowHeight } : edit;
      replaceDeclarations(declarations.shared, RHYTHM_TOKENS, {
        spacing: px(edit.density),
        "tracking-normal": `${formatNumber(edit.tracking)}em`,
        "bb-sidebar-row-height": rowLinked ? LINKED_SIDEBAR_ROW : px(edit.rowHeight),
        "bb-sidebar-row-height-coarse": rowLinked ? LINKED_SIDEBAR_ROW_COARSE : px(Math.max(40, edit.rowHeight + 12)),
        "icon-stroke-width": formatNumber(edit.iconStroke),
      });
      if (edit.target === "density" && rowLinked && linkedRowHeight !== edit.rowHeight) {
        adjustments.push({
          control: "rhythm:row-height",
          label: "Sidebar row",
          scope: "shared",
          from: px(edit.rowHeight),
          to: px(linkedRowHeight),
          invariant: "Sidebar row stays linked to 20px + 2 × Density",
        });
      }
      break;
    }
    case "radius":
      replaceDeclarations(declarations.shared, RADIUS_TOKENS, { radius: px(edit.value) });
      break;
    case "shadow": {
      const colorLinked = edit.target === "color" ? false : linksBefore.shadowColor[input.mode] === "linked";
      replaceDeclarations(declarations.shared, SHADOW_SHARED_TOKENS, {
        "shadow-x": px(edit.x),
        "shadow-y": px(edit.y),
        "shadow-blur": px(edit.blur),
        "shadow-spread": px(edit.spread),
      });
      replaceDeclarations(target, SHADOW_MODE_TOKENS, shadowDeclarations(edit, colorLinked ? LINKED_SHADOW_COLOR : edit.color));
      break;
    }
    case "restore-link": {
      if (edit.target === "sidebar-row") {
        const previous = effectiveDeclaration(declarations, source, input.mode, "bb-sidebar-row-height") ?? "custom value";
        declarations.shared.set("bb-sidebar-row-height", LINKED_SIDEBAR_ROW);
        declarations.shared.set("bb-sidebar-row-height-coarse", LINKED_SIDEBAR_ROW_COARSE);
        adjustments.push({
          control: "rhythm:row-height",
          label: "Sidebar row",
          scope: "shared",
          from: previous,
          to: LINKED_SIDEBAR_ROW,
          invariant: "Sidebar row follows Density",
        });
      } else {
        const previous = effectiveDeclaration(declarations, source, input.mode, "tp-shadow-color")
          ?? effectiveDeclaration(declarations, source, input.mode, "shadow-color")
          ?? "custom value";
        const shadowEdit: Extract<ThemeEditInput["edit"], { kind: "shadow" }> = {
          kind: "shadow",
          target: "color",
          x: bounded(numberDeclaration(effectiveDeclaration(declarations, source, input.mode, "shadow-x"), 0), -24, 24),
          y: bounded(numberDeclaration(effectiveDeclaration(declarations, source, input.mode, "shadow-y"), 2), -24, 24),
          blur: bounded(numberDeclaration(effectiveDeclaration(declarations, source, input.mode, "shadow-blur"), 0), 0, 48),
          spread: bounded(numberDeclaration(effectiveDeclaration(declarations, source, input.mode, "shadow-spread"), 0), -24, 24),
          color: "#000000",
          opacity: bounded(Math.round(
            effectiveDeclaration(declarations, source, input.mode, "tp-shadow-opacity-percent") !== undefined
              ? numberDeclaration(effectiveDeclaration(declarations, source, input.mode, "tp-shadow-opacity-percent"), 16)
              : numberDeclaration(effectiveDeclaration(declarations, source, input.mode, "shadow-opacity"), 0.16) * 100,
          ), 0, 80),
        };
        replaceDeclarations(target, SHADOW_MODE_TOKENS, shadowDeclarations(shadowEdit, LINKED_SHADOW_COLOR));
        adjustments.push({
          control: "shadow:color",
          label: "Shadow color",
          scope: input.mode,
          from: previous,
          to: LINKED_SHADOW_COLOR,
          invariant: "Shadow color follows Ink",
        });
      }
      break;
    }
  }

  const managed = renderManagedBlock(declarations);
  const range = managedRange(css);
  const next = range
    ? `${css.slice(0, range.start)}${managed}${css.slice(range.end)}`
    : `${css}${css.length === 0 ? "" : css.endsWith("\n") ? "\n" : "\n\n"}${managed}\n`;
  if (next.length > CUSTOM_THEME_CSS_MAX_LENGTH) {
    throw new Error(`Edited theme exceeds the ${CUSTOM_THEME_CSS_MAX_LENGTH}-character custom-theme limit`);
  }
  return { css: next, committedEdit, adjustments, links: classifyThemeLinks(next) };
}

/** Compatibility helper for callers that only need the rewritten stylesheet. */
export function applyThemeEdit(css: string, input: Pick<ThemeEditInput, "mode" | "edit">): string {
  return applyThemeEditWithEffects(css, input).css;
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
  const undoRecords = new Map<string, ForkUndoRecord>();

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = queue.then(operation);
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const discardExpiredUndoRecords = () => {
    const now = Date.now();
    for (const [token, record] of undoRecords) {
      if (record.expiresAt <= now) undoRecords.delete(token);
    }
  };

  const discardUndoForTheme = (themeId: string) => {
    for (const [token, record] of undoRecords) {
      if (record.themeId === themeId) undoRecords.delete(token);
    }
  };

  const editTheme = (input: ThemeEditInput): Promise<ThemeEditResult<Catalog>> => {
    return enqueue(async () => {
      discardExpiredUndoRecords();
      const resource = await dependencies.resolveTheme(input.themeId);
      if (resource.source === "custom") {
        if (!resource.filePath) throw new Error(`Custom theme '${resource.id}' has no editable theme.css`);
        // A later edit makes the fork user-owned. Never leave an Undo action
        // capable of deleting work performed after the automatic copy.
        discardUndoForTheme(resource.id);
        const applied = applyThemeEditWithEffects(resource.css, input);
        await writeFileAtomically(resource.filePath, applied.css);
        const catalog = await dependencies.applyTheme(resource.id, resource.filePath);
        return {
          catalog,
          themeId: resource.id,
          forkedFrom: null,
          undoToken: null,
          committedEdit: applied.committedEdit,
          adjustments: applied.adjustments,
          links: applied.links,
        };
      }

      // Validate and render before allocating the durable fork directory. A
      // rejected edit must not leave an empty custom-theme resource behind.
      const applied = applyThemeEditWithEffects(resource.css, input);
      const fork = await allocateForkDirectory(resource.themeDirectory, resource.name);
      const filePath = join(fork.directory, "theme.css");
      const css = withForkName(applied.css, fork.name);
      try {
        await writeFileAtomically(filePath, css);
        const catalog = await dependencies.applyTheme(fork.id, filePath);
        const undoToken = randomUUID();
        undoRecords.set(undoToken, {
          directory: fork.directory,
          expectedCss: css,
          expiresAt: Date.now() + FORK_UNDO_TTL_MS,
          filePath,
          forkedFrom: resource.id,
          themeId: fork.id,
        });
        return {
          catalog,
          themeId: fork.id,
          forkedFrom: resource.id,
          undoToken,
          committedEdit: applied.committedEdit,
          adjustments: applied.adjustments,
          links: applied.links,
        };
      } catch (error) {
        await rm(fork.directory, { recursive: true, force: true });
        throw error;
      }
    });
  };

  const undoThemeFork = (input: UndoThemeForkInput): Promise<Catalog> => enqueue(async () => {
    discardExpiredUndoRecords();
    const record = undoRecords.get(input.undoToken);
    if (!record) throw new Error("This theme copy can no longer be undone");

    const currentCss = await readFile(record.filePath, "utf8").catch(() => null);
    if (currentCss !== record.expectedCss) {
      undoRecords.delete(input.undoToken);
      throw new Error("This theme copy changed after it was created and was not removed");
    }

    // Restore the source before removing the active copy. The token names an
    // exact plugin-created directory, and the byte-for-byte guard above keeps
    // this from becoming a general custom-theme delete operation.
    await dependencies.selectTheme(record.forkedFrom);
    await rm(record.directory, { recursive: true });
    undoRecords.delete(input.undoToken);
    return dependencies.loadCatalog();
  });

  return { editTheme, undoThemeFork };
}

export const THEME_PREVIEW_MANAGED_MARKERS = { start: MANAGED_START, end: MANAGED_END } as const;
