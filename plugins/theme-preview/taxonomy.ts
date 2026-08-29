/**
 * The plugin's content taxonomy: four high-level areas, each with the minimum
 * representative inventory a user needs to prototype a bb theme at ~80%
 * fidelity — every major theme token family (canvas/ink-derived surfaces and
 * text, accents, status, lines, typography, corner radius, interactive
 * states) is visibly exercised in at least one area.
 *
 * 1. `mock`       — the mock bb app surface, with toggles between views.
 *                   Judges tokens in real product composition.
 * 2. `overlays`   — components whose theming only shows under interaction
 *                   (menus, dialogs, popovers, tooltips, hover cards, toasts).
 * 3. `components` — live component specimens for hover, focus, pressed,
 *                   checked, editable, and disabled states. This stays a
 *                   compact sibling directly below overlays.
 * 4. `stylesheet` — the compact live theme editor. Direct values are real bb
 *                   controls (`data-tp-specimen`); the larger token families
 *                   they produce stay inspectable in a collapsed, read-only
 *                   derived-values section.
 *
 * The app renders sections from this manifest and the coverage test asserts
 * every inventoried specimen actually reaches the DOM, so adding a specimen
 * is: add it here, render it via the shared layout primitives, done.
 */

export type AreaId = "mock" | "overlays" | "components" | "stylesheet";

export const AREA_TITLES: Record<AreaId, string> = {
  mock: "Preview",
  overlays: "Overlays",
  components: "Components",
  stylesheet: "Style sheet",
};

// ---------------------------------------------------------------------------
// Area 1 — Mock surface. Views the toggle can show; each names the token
// families it is responsible for exercising in composition.
// ---------------------------------------------------------------------------

export const MOCK_VIEWS = [
  { id: "thread", label: "Thread", exercises: "sidebar row states + scoped overrides, held-open table-of-contents popover, bubbles on surface-recessed, seam/hairline borders, diff washes, file/timeline accents, verification badges, composer ring, primary send" },
  { id: "new", label: "New thread", exercises: "empty state, focused composer ring, suggestion chips" },
  { id: "split", label: "Split", exercises: "pane seam, active-pane primary marker, two distinct transcripts" },
  { id: "settings", label: "Settings", exercises: "appearance rows mirroring the live selection, secondary→accent hero gradient, tab underline, cards + switches" },
] as const;

// ---------------------------------------------------------------------------
// Area 4 — Style sheet. Direct controls plus read-only derived families.
// `data-tp-specimen` values are `<kind>:<id>` from these tables.
// ---------------------------------------------------------------------------

/** The active mode's directly editable colour controls. */
export const DIRECT_COLOR_CONTROLS = [
  { id: "canvas", label: "Canvas", token: "canvas", family: "anchors" },
  { id: "ink", label: "Ink", token: "ink", family: "anchors" },
  { id: "sidebar", label: "Sidebar", token: "sidebar", family: "sidebar" },
  { id: "sidebar-foreground", label: "Sidebar ink", token: "sidebar-foreground", family: "sidebar" },
  { id: "primary", label: "Primary", token: "primary", family: "primary" },
  { id: "timeline-accent", label: "Timeline / files", token: "timeline-accent", family: "timeline" },
  { id: "success", label: "Success", token: "success", family: "status" },
  { id: "warning", label: "Warning", token: "warning", family: "status" },
  { id: "attention", label: "Attention / pending", token: "attention", family: "status" },
  { id: "destructive", label: "Destructive", token: "destructive", family: "status" },
  { id: "pr-merged", label: "Merged", token: "pr-merged", family: "status" },
] as const;

/** Read-only colour groups; `contrast` names the measurement policy. */
export const COLOR_GROUPS = [
  {
    id: "surfaces",
    title: "Surfaces",
    contrast: "none",
    tokens: ["card", "popover", "secondary", "muted", "surface-recessed-solid", "surface-scrim"],
  },
  {
    id: "ink",
    title: "Ink",
    contrast: "vs-surface", // each ink on the surface it sits on; 4.5:1 floor
    tokens: ["foreground", "muted-foreground", "subtle-foreground", "readback-foreground"],
  },
  {
    id: "accent",
    title: "Accent",
    contrast: "none",
    tokens: ["file-accent", "surface-selected", "state-hover", "state-active"],
  },
  {
    id: "status",
    title: "Status",
    contrast: "as-painted", // text token on its 15%/18% wash over canvas
    tokens: ["success-foreground", "warning-text", "destructive-text", "surface-attention", "diff-added", "diff-removed"],
  },
  {
    id: "lines",
    title: "Lines",
    contrast: "none",
    tokens: ["border", "border-hairline", "border-seam", "sidebar-border", "input", "ring"],
  },
] as const;

/** Typography controls and their live derived samples. */
export const TYPE_SPECIMENS = [
  { id: "font-sans", title: "Sans", token: "font-sans" },
  { id: "font-mono", title: "Mono", token: "font-mono" },
  { id: "text-scale", title: "Text scale", token: "tp-text-scale" },
  { id: "line-height", title: "Line height", token: "tp-line-height" },
] as const;

/** Radius specimens: one direct base plus the derived ladder. */
export const RADIUS_SPECIMENS = [
  { id: "radius-sm", title: "Small", source: "var(--radius-sm)" },
  { id: "radius-md", title: "Medium", source: "var(--radius-md)" },
  { id: "radius-lg", title: "Large", source: "var(--radius-lg)" },
  { id: "radius-xl", title: "Extra large", source: "var(--radius-xl)" },
] as const;

// ---------------------------------------------------------------------------
// Area 3 — Live components (all vendored @bb/shared-ui, never lookalikes).
// ---------------------------------------------------------------------------

export const COMPONENT_SPECIMENS = [
  { id: "buttons", title: "Buttons", vendored: "@bb/shared-ui/button" },
  { id: "badges", title: "Badges", vendored: "@bb/shared-ui/badge" },
  { id: "inputs", title: "Inputs", vendored: "@bb/shared-ui/input" },
  { id: "switch", title: "Switch", vendored: "@bb/shared-ui/switch" },
  { id: "checkbox", title: "Checkbox", vendored: "@bb/shared-ui/checkbox" },
] as const;

// ---------------------------------------------------------------------------
// Area 2 — Interactive overlays (all vendored; opened deliberately, one at a
// time). The theme picker in the header additionally exercises
// @bb/shared-ui/select live.
// ---------------------------------------------------------------------------

export const OVERLAY_SPECIMENS = [
  { id: "menu", label: "Menu", vendored: "@bb/shared-ui/dropdown-menu" },
  { id: "dialog", label: "Dialog", vendored: "@bb/shared-ui/dialog" },
  { id: "popover", label: "Popover", vendored: "@bb/shared-ui/popover" },
  { id: "tooltip", label: "Tooltip", vendored: "@bb/shared-ui/tooltip" },
  { id: "hover-card", label: "Hover card", vendored: "@bb/shared-ui/hover-card" },
  { id: "toast", label: "Toast", vendored: "sonner via the app-mounted Toaster" },
] as const;

/** Every `data-tp-specimen` value the style sheet must render. */
export const STYLESHEET_SPECIMEN_IDS: readonly string[] = [
  ...DIRECT_COLOR_CONTROLS.map((control) => `color:${control.id}`),
  ...TYPE_SPECIMENS.map((specimen) => `type:${specimen.id}`),
  "rhythm:density",
  "rhythm:tracking",
  "rhythm:row-height",
  "rhythm:icon-stroke",
  "radius:base",
  "shadow:y",
  "shadow:blur",
  "shadow:x",
  "shadow:spread",
  "shadow:color",
  "shadow:opacity",
];
