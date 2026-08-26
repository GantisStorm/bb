/**
 * The plugin's content taxonomy: four high-level areas, each with the minimum
 * representative inventory a user needs to prototype a bb theme at ~80%
 * fidelity — every major theme token family (canvas/ink-derived surfaces and
 * text, accents, status, lines, typography, corner radius, interactive
 * states) is visibly exercised in at least one area.
 *
 * 1. `mock`       — the mock bb app surface, with toggles between views.
 *                   Judges tokens in real product composition.
 * 2. `stylesheet` — the color/type/radius specimen sheet. Every entry is one
 *                   discrete, targetable element (`data-tp-specimen`) so a
 *                   future version can turn each into an interactive control
 *                   (color → picker, font → picker, radius → editor) without
 *                   restructuring. This version stays read-only.
 * 3. `components` — static component specimens whose theming shows at rest.
 * 4. `overlays`   — components whose theming only shows under interaction
 *                   (menus, dialogs, popovers, tooltips, hover cards, toasts).
 *
 * The app renders sections from this manifest and the coverage test asserts
 * every inventoried specimen actually reaches the DOM, so adding a specimen
 * is: add it here, render it via the shared layout primitives, done.
 */

export type AreaId = "mock" | "stylesheet" | "components" | "overlays";

export const AREA_TITLES: Record<AreaId, string> = {
  mock: "Preview",
  stylesheet: "Style sheet",
  components: "Components",
  overlays: "Overlays",
};

// ---------------------------------------------------------------------------
// Area 1 — Mock surface. Views the toggle can show; each names the token
// families it is responsible for exercising in composition.
// ---------------------------------------------------------------------------

export const MOCK_VIEWS = [
  { id: "thread", label: "Thread", exercises: "sidebar row states + scoped overrides, bubbles on surface-recessed, seam/hairline borders, diff washes, file/timeline accents, verification badges, composer ring, primary send" },
  { id: "new", label: "New thread", exercises: "empty state, focused composer ring, suggestion chips" },
  { id: "split", label: "Split", exercises: "pane seam, active-pane primary marker, two distinct transcripts" },
  { id: "settings", label: "Settings", exercises: "appearance rows mirroring the live selection, secondary→accent hero gradient, tab underline, cards + switches" },
] as const;

// ---------------------------------------------------------------------------
// Area 2 — Style sheet. Discrete, targetable specimens.
// `data-tp-specimen` values are `<kind>:<id>` from these tables.
// ---------------------------------------------------------------------------

/** Color groups; `contrast` names the measurement policy for the ratio column. */
export const COLOR_GROUPS = [
  {
    id: "surfaces",
    title: "Surfaces",
    contrast: "none",
    tokens: ["canvas", "sidebar", "card", "popover", "secondary", "muted", "surface-recessed-solid", "surface-scrim"],
  },
  {
    id: "ink",
    title: "Ink",
    contrast: "vs-surface", // each ink on the surface it sits on; 4.5:1 floor
    tokens: ["foreground", "muted-foreground", "subtle-foreground", "readback-foreground", "sidebar-foreground"],
  },
  {
    id: "accent",
    title: "Accent",
    contrast: "none",
    tokens: ["primary", "file-accent", "timeline-accent", "surface-selected", "state-hover", "state-active"],
  },
  {
    id: "status",
    title: "Status",
    contrast: "as-painted", // text token on its 15%/18% wash over canvas
    tokens: ["success", "warning", "destructive", "pr-merged", "diff-added", "diff-removed"],
  },
  {
    id: "lines",
    title: "Lines",
    contrast: "none",
    tokens: ["border", "border-hairline", "border-seam", "sidebar-border", "input", "ring"],
  },
] as const;

/** Typography specimens: one targetable entry per themable font role. */
export const TYPE_SPECIMENS = [
  { id: "font-sans", title: "Sans", token: "font-sans", sample: "Body at 13.5 — the thing most pixels are." },
  { id: "font-sans-strong", title: "Sans · 600", token: "font-sans", sample: "Title · foreground 600" },
  { id: "font-mono", title: "Mono", token: "font-mono", sample: "path/file.tsx · --token" },
] as const;

/** Radius specimens: the theme's derived ladder plus bb's measured shapes. */
export const RADIUS_SPECIMENS = [
  { id: "radius", title: "radius", source: "var(--radius)" },
  { id: "radius-md", title: "radius-md", source: "var(--radius-md)" },
  { id: "radius-row", title: "row · 10", source: "10px" },
  { id: "radius-bubble", title: "bubble · 16", source: "16px" },
] as const;

// ---------------------------------------------------------------------------
// Area 3 — Static components (all vendored @bb/shared-ui, never lookalikes).
// ---------------------------------------------------------------------------

export const COMPONENT_SPECIMENS = [
  { id: "buttons", title: "Buttons", vendored: "@bb/shared-ui/button" },
  { id: "badges", title: "Badges", vendored: "@bb/shared-ui/badge" },
  { id: "inputs", title: "Inputs", vendored: "@bb/shared-ui/input" },
  { id: "switch", title: "Switch", vendored: "@bb/shared-ui/switch" },
  { id: "checkbox", title: "Checkbox", vendored: "@bb/shared-ui/checkbox" },
] as const;

/**
 * The thread list (bb's sidebar rows) is a component specimen, but it is the
 * thing the sidebar surface tokens paint, so it is anchored in the style
 * sheet beside them rather than floating in the components area.
 */
export const THREAD_LIST_SPECIMEN = {
  id: "thread-list",
  title: "Thread list",
  states: ["Unread", "Hovered", "Open", "Open in split"],
  vendored: "real sidebar row classes (fixture)",
} as const;

// ---------------------------------------------------------------------------
// Area 4 — Interactive overlays (all vendored; opened deliberately, one at a
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
  ...COLOR_GROUPS.flatMap((group) => group.tokens.map((token) => `color:${token}`)),
  ...TYPE_SPECIMENS.map((specimen) => `type:${specimen.id}`),
  ...RADIUS_SPECIMENS.map((specimen) => `radius:${specimen.id}`),
];
