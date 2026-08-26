/**
 * The source contract behind the mock: every real-app fact the fixture
 * mirrors, anchored to the file that owns it. `fixture-anatomy.test.ts`
 * asserts these against the live app source, so renaming a token or class
 * the preview paints fails Theme Preview's tests instead of silently
 * drifting the fixture away from the product.
 *
 * When an assertion here fails, the app changed: update both the fixture
 * (app.tsx) and the anchor below to match the app's new reality.
 */

export interface FixtureAnchor {
  /** Repo-relative path of the file that owns the fact. */
  file: string;
  /** Substrings that must appear in that file. */
  mustContain: readonly string[];
  /** What the fixture renders from this fact. */
  because: string;
}

export const FIXTURE_ANCHORS: readonly FixtureAnchor[] = [
  {
    file: "apps/app/src/components/ui/sidebar.tsx",
    mustContain: ["fixed inset-y-0", "bg-sidebar text-sidebar-foreground"],
    because:
      "The mock sidebar carries `fixed bg-sidebar` so theme blocks scoped to `.fixed.bg-sidebar` (token overrides, noise overlays) apply to it exactly as they do in the app.",
  },
  {
    file: "apps/app/src/components/sidebar/sidebarRowClasses.ts",
    mustContain: ["hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"],
    because: "Row hover in the mock paints sidebar-accent with sidebar-accent-foreground text.",
  },
  {
    file: "apps/app/src/components/ui/context-selection.ts",
    mustContain: ['CONTEXT_SELECTION_SURFACE_CLASS = "bg-state-active"'],
    because: "The open thread's row in the mock paints state-active.",
  },
  {
    file: "apps/app/src/components/ui/theme.css",
    mustContain: [
      // Surfaces the mock and the token sheet paint.
      "--canvas:", "--sidebar:", "--card:", "--popover:", "--secondary:", "--muted:",
      "--surface-recessed:", "--surface-recessed-solid:", "--surface-recessed-soft-solid:", "--surface-scrim:",
      // Ink.
      "--foreground:", "--muted-foreground:", "--subtle-foreground:", "--readback-foreground:", "--sidebar-foreground:",
      // Accents and states.
      "--primary:", "--file-accent:", "--timeline-accent:", "--surface-selected:", "--state-hover:", "--state-active:",
      // Status.
      "--success:", "--warning:", "--destructive:", "--pr-merged:", "--diff-added:", "--diff-removed:",
      // Lines and focus.
      "--border:", "--border-hairline:", "--border-seam:", "--sidebar-border:", "--input:", "--ring:",
      // The open-in-split row surface a theme may override.
      "--bb-sidebar-open-in-split-background",
    ],
    because: "Every token the preview reads and lists must still be declared by the app's theme source of truth.",
  },
  {
    file: "apps/app/src/hooks/useTheme.ts",
    mustContain: ['THEME_STORAGE_KEY = "bb.theme"'],
    because:
      "The mode switch writes localStorage `bb.theme` and dispatches the storage event so Settings → Appearance stays synchronized.",
  },
  {
    file: "apps/app/src/main.tsx",
    mustContain: ["AppToaster"],
    because: "The toast specimen fires a real sonner toast rendered by the app-mounted Toaster.",
  },
];
