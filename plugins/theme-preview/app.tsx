import { definePluginApp, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { Badge as BbBadge } from "@bb/shared-ui/badge";
import { Button as BbButton } from "@bb/shared-ui/button";
import { Checkbox as BbCheckbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@bb/shared-ui/hover-card";
import { Icon } from "@bb/shared-ui/icon";
import { Input as BbInput } from "@bb/shared-ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@bb/shared-ui/select";
import { Switch as BbSwitch } from "@bb/shared-ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { toast } from "sonner";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { rpcContract } from "./server";
import {
  contentInsetForWidth,
  frameCompositionForWidth,
  frameHeightForWidth,
  INFO_PANEL_WIDTH,
  layoutBandForWidth,
  SIDEBAR_WIDTH,
  surfaceRailWidth,
  type FrameComposition,
  type LayoutBand,
} from "./responsive-layout";
import { LatestRequest, contrastRatio } from "./theme-utils";
import {
  AREA_TITLES,
  COLOR_GROUPS,
  MOCK_VIEWS,
  RADIUS_SPECIMENS,
  TYPE_SPECIMENS,
} from "./taxonomy";

// ---------------------------------------------------------------------------
// Everything reads the theme's CSS custom properties directly, and the mock
// mirrors what bb actually paints: surfaces, radii and borders were measured
// off the running app rather than invented, so a palette fails here the same
// way it fails there. Decoration bb's theme does not touch — icons, window
// chrome, nav lists — is left out on purpose.
// ---------------------------------------------------------------------------

const v = (name: string, fallback?: string): string =>
  fallback === undefined ? `var(--${name})` : `var(--${name}, ${fallback})`;
const SANS = v("font-sans", "ui-sans-serif, system-ui, sans-serif");
const MONO = v("font-mono", "ui-monospace, SFMono-Regular, Menlo, monospace");
const space = (units: number): string => `calc(var(--spacing, 0.25rem) * ${units})`;
const RADIUS_MD = v("radius-md", "calc(var(--radius, 0.5rem) - 2px)");
const RADIUS_LG = v("radius-lg", v("radius", "0.5rem"));

// Measured off the running app: thread rows 10px, composer and messages 16px,
// code blocks 10px.
const R_ROW = 10;
const R_BUBBLE = 16;
const R_BLOCK = 10;

// The mock views come from the taxonomy so the toggle, the renderer, and the
// coverage test share one inventory.
const VIEWS = MOCK_VIEWS.map((view) => view.id);
type View = (typeof MOCK_VIEWS)[number]["id"];
const VIEW_LABEL = Object.fromEntries(MOCK_VIEWS.map((view) => [view.id, view.label])) as Record<View, string>;
const STUDIO_MAX_WIDTH = 1600;
// Anchor scrolling must clear the sticky header, or an area's heading lands
// underneath it. The offset is measured from the header itself (it wraps to
// two rows on the mobile band), never authored.
const CLIENT_RPC_TIMEOUT_MS = 20_000;

function withRpcTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} timed out after ${CLIENT_RPC_TIMEOUT_MS / 1000} seconds`)),
      CLIENT_RPC_TIMEOUT_MS,
    );
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

type Mode = "light" | "dark";
type ThemeSelection = { themeId: string; mode: Mode };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: 999, background: color, flex: "none" }} />;
}

function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: v("muted-foreground"), ...style }}>
      {children}
    </div>
  );
}

type Tone = "outline" | "primary" | "secondary" | "success" | "warning" | "destructive" | "merged";
function Badge({ children, tone = "outline" }: { children: ReactNode; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    outline: "border-border text-foreground",
    primary: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    success: "border-transparent bg-success/15 text-success",
    warning: "border-transparent bg-warning/15 text-warning-text",
    destructive: "border-transparent bg-destructive/15 text-destructive-text",
    merged: "border-transparent bg-pr-merged/15 text-pr-merged",
  };
  return (
    <BbBadge
      variant="outline"
      className={cn("h-5 gap-1 whitespace-nowrap px-1.5 py-0 text-[11px] font-medium", tones[tone])}
    >
      {children}
    </BbBadge>
  );
}

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
function Button({ children, variant = "default", size = "md", disabled = false }: { children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; disabled?: boolean }) {
  return (
    <BbButton asChild variant={variant} size={size === "sm" ? "sm" : "default"}>
      <span aria-disabled={disabled || undefined} className={cn("pointer-events-none", disabled && "opacity-50")}>{children}</span>
    </BbButton>
  );
}

function Switch({ on }: { on: boolean }) {
  return <BbSwitch checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />;
}

function TextInput({ focused = false, value, placeholder, width = 190 }: { focused?: boolean; value?: string; placeholder?: string; width?: number }) {
  return (
    <BbInput
      readOnly
      tabIndex={-1}
      value={value ?? ""}
      placeholder={placeholder}
      style={{ width }}
      className={cn("pointer-events-none", focused && "ring-1 ring-ring")}
    />
  );
}

// ---------------------------------------------------------------------------
// Sidebar. Carries bb's real `fixed bg-sidebar` classes so any theme block
// scoped to that selector (token overrides, the noise overlay) applies here
// exactly as it does in the app.
// ---------------------------------------------------------------------------

const sidebarScope: CSSProperties = { position: "relative", inset: "auto", zIndex: "auto" };

// From bb's sidebarRowClasses.ts: hover paints bg-sidebar-accent with
// sidebar-accent-foreground text; the open thread's row paints bg-state-active
// (CONTEXT_SELECTION_SURFACE_CLASS); open-in-split resolves sidebar-accent 50%
// against the sidebar unless the theme overrides the variable.
type RowState = "rest" | "hover" | "selected" | "split";
function rowStyle(state: RowState): CSSProperties {
  switch (state) {
    case "hover": return { background: v("sidebar-accent"), color: v("sidebar-accent-foreground") };
    case "selected": return { background: v("state-active") };
    case "split": return { background: v("bb-sidebar-open-in-split-background", `color-mix(in oklch, ${v("sidebar-accent")} 50%, ${v("sidebar")})`) };
    default: return {};
  }
}

// The dots bb actually draws: a 5px foreground dot for unread, a muted dot for
// working status (SIDEBAR_UNREAD_DOT_CLASS / SIDEBAR_SUCCESS_STATUS_DOT_CLASS).
function Row({ label, state = "rest", dot }: { label: string; state?: RowState; dot?: "unread" | "status" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px", borderRadius: R_ROW, fontSize: 13, color: v("sidebar-foreground"), ...rowStyle(state) }}>
      <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</span>
      {dot === "unread" ? <Dot color={v("foreground")} size={5} /> : dot === "status" ? <Dot color={`color-mix(in srgb, ${v("muted-foreground")} 60%, transparent)`} size={5} /> : null}
    </div>
  );
}

function Sidebar({ selected, split, hover }: { selected?: boolean; split?: boolean; hover?: boolean }) {
  return (
    <div
      className="fixed bg-sidebar"
      style={{
        ...sidebarScope, width: SIDEBAR_WIDTH, flex: "none", background: v("sidebar"), color: v("sidebar-foreground"),
        // bb's sidebar divider is border-border-seam; a theme's scoped seam
        // (blacklight's orange line) still arrives via the element class.
        borderRight: `1px solid ${v("border-seam", v("border"))}`, display: "flex", flexDirection: "column", padding: "10px 8px", boxSizing: "border-box", fontFamily: SANS,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", height: 30, padding: "0 10px", fontSize: 13, fontWeight: 600 }}>bb-plugins</div>
      {/* bb renders New thread as a ghost row, not a filled button. */}
      <Row label="New thread" />
      <div style={{ fontSize: 11, color: v("muted-foreground"), padding: "6px 10px 4px" }}>Today</div>
      <Row label="Endless theme family — blacklight" state={selected ? "selected" : "rest"} dot="unread" />
      <Row label="Specimen sheets + social grid" state={split ? "split" : "rest"} dot="status" />
      <Row label="theme-preview plugin" state={hover ? "hover" : "rest"} />
      <Row label="Crit: endless-color light foil" dot="unread" />
      <div style={{ fontSize: 11, color: v("muted-foreground"), padding: "12px 10px 4px" }}>Yesterday</div>
      <Row label="Fix pink split row (oklch mix)" dot="status" />
      <Row label="Hue census battery" />
      <div style={{ flex: 1 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread. Surfaces measured off the running app: the composer sits on the
// canvas with a 1px border (not on --card), and messages and code blocks are
// the faintest recessed wash with a seam border.
// ---------------------------------------------------------------------------

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "70%", background: v("surface-recessed", "rgba(127,127,127,.05)"), boxShadow: `inset 0 0 0 1px ${v("border-seam", v("border"))}`, borderRadius: R_BUBBLE, padding: "10px 14px" }}>
      {children}
    </div>
  );
}

function CodeBlock() {
  const line = (text: string, kind?: "add" | "del") => (
    <div key={text} style={{ padding: "0 12px", whiteSpace: "pre", background: kind === "add" ? `color-mix(in srgb, ${v("diff-added")} 18%, transparent)` : kind === "del" ? `color-mix(in srgb, ${v("diff-removed")} 18%, transparent)` : undefined }}>
      {text}
    </div>
  );
  return (
    <div style={{ borderRadius: R_BLOCK, overflow: "hidden", boxShadow: `inset 0 0 0 1px ${v("border-seam", v("border"))}`, fontFamily: MONO, fontSize: 12, lineHeight: "19px", color: v("foreground"), padding: "8px 0" }}>
      <div style={{ padding: "0 12px 6px", fontSize: 11, display: "flex", gap: 8, color: v("muted-foreground") }}>
        <span style={{ color: v("file-accent", v("muted-foreground")) }}>themes/endless-color.css</span><span>+2 −1</span>
      </div>
      {line("  .dark .fixed.bg-sidebar {")}
      {line("-   --sidebar: #1d1d1d;", "del")}
      {line("+   --sidebar: #070707;", "add")}
      {line("  }")}
    </div>
  );
}

function Composer({ focused = false, text }: { focused?: boolean; text?: string }) {
  return (
    <div
      style={{
        borderRadius: R_BUBBLE, background: v("background", v("canvas")), padding: "12px 12px 10px", display: "flex", flexDirection: "column", gap: 12,
        boxShadow: focused
          ? `inset 0 0 0 1px ${v("ring")}, 0 0 0 3px color-mix(in srgb, ${v("ring")} 25%, transparent)`
          : `inset 0 0 0 1px ${v("border")}`,
      }}
    >
      <div style={{ fontSize: 13.5, color: text ? v("foreground") : v("muted-foreground"), minHeight: 20 }}>{text ?? "Ask for a follow-up."}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: v("muted-foreground") }}>claude-fable-5</span>
        <div style={{ flex: 1 }} />
        <div style={{ width: 26, height: 26, borderRadius: 8, background: text ? v("primary") : v("muted"), color: text ? v("primary-foreground") : v("muted-foreground"), display: "grid", placeItems: "center", fontSize: 12 }}>↑</div>
      </div>
    </div>
  );
}

function VerificationCard() {
  const rows: ReadonlyArray<[string, string, Tone]> = [
    ["Theme tokens", "28 resolved", "success"],
    ["Contrast floor", "AA passed", "success"],
    ["Reference sheet", "Updated", "secondary"],
  ];
  return (
    <div style={{ borderRadius: R_BLOCK, background: v("surface-recessed", "rgba(127,127,127,.05)"), boxShadow: `inset 0 0 0 1px ${v("border-seam", v("border"))}`, padding: "10px 12px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Verification summary</div>
      {rows.map(([label, value, tone]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 25, borderTop: `1px solid ${v("border-hairline", v("border"))}` }}>
          <span style={{ flex: 1, color: v("muted-foreground") }}>{label}</span>
          <Badge tone={tone}>{value}</Badge>
        </div>
      ))}
    </div>
  );
}

function Thread({ title = "Endless theme family — blacklight pass", active = true, narrow = false, brief = false, empty = false, marker = false, story = "blacklight" }: { title?: string; active?: boolean; narrow?: boolean; brief?: boolean; empty?: boolean; marker?: boolean; story?: "blacklight" | "specimen" }) {
  const pad = narrow ? 20 : 30;
  const canvasColor = v("canvas", v("background"));
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, background: v("canvas", v("background")), color: v("foreground"), display: "flex", flexDirection: "column", fontFamily: SANS, position: "relative" }}>
      {empty ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: `0 ${pad}px` }}>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em" }}>What are we building?</div>
          <div style={{ width: "100%", maxWidth: 620 }}><Composer focused text="make the blacklight variant feel like the reference" /></div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Fix the failing build", "Review open PRs"].map((s) => (
              <span key={s} style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 999, boxShadow: `inset 0 0 0 1px ${v("border")}`, color: v("muted-foreground") }}>{s}</span>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ height: 48, display: "flex", alignItems: "center", gap: 10, padding: `0 ${pad}px`, flex: "none", position: "relative" }}>
            {marker && active ? <span style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: v("primary") }} /> : null}
            <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{title}</span>
            <Badge tone="success"><Dot color={v("success")} size={6} /> Running</Badge>
            {narrow ? null : <Badge tone="outline">bb/endless-theme-plugin</Badge>}
          </div>
          {/* Anchored at the bottom like a scrolled thread: messages keep their
              natural size and the oldest clip off the top, never squash. The
              scrim makes the cut read as scrolled-away rather than broken. */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative", padding: `0 ${pad}px`, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: 28, zIndex: 1, pointerEvents: "none", background: `linear-gradient(to bottom, ${canvasColor}, color-mix(in oklab, ${canvasColor} 0%, transparent))` }} />
          {story === "specimen" ? (
            <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 16, fontSize: 13.5, lineHeight: "21px", paddingTop: 22 }}>
              <Bubble>lay the specimen sheet out as a grid — one tile per token family, social crop last.</Bubble>
              <div>
                Laid out six tiles: surfaces, ink, accents, status, lines, type. Each sits on{" "}
                <code style={{ fontFamily: MONO, fontSize: "0.92em", fontWeight: 600, background: v("surface-recessed"), padding: "1px 5px", borderRadius: 4 }}>--card</code>{" "}
                with a seam border, so the sheet reads in both modes without retinting.
              </div>
              <div style={{ color: v("muted-foreground"), fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 1, height: 18, background: v("timeline-accent", v("border")) }} />
                15:04 · <span style={{ color: v("file-accent", v("muted-foreground")), fontFamily: MONO }}>sheets/specimen-grid.css</span>
              </div>
              <Bubble>good — export the 1200×675 crop for the announcement.</Bubble>
            </div>
          ) : (
          <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 16, fontSize: 13.5, lineHeight: "21px", paddingTop: 22 }}>
            <Bubble>make the blacklight variant feel like the reference — neon orange seam, blue selection, calm UV canvas.</Bubble>
            <div>
              Three blacks were fragmenting the frame. The base theme's{" "}
              <code style={{ fontFamily: MONO, fontSize: "0.92em", fontWeight: 600, background: v("surface-recessed"), padding: "1px 5px", borderRadius: 4 }}>.fixed.bg-sidebar</code>{" "}
              block was overriding the variant's sidebar tokens, so it rendered <span style={{ fontFamily: MONO, fontSize: "0.92em" }}>#1d1d1d</span> instead of true black.
            </div>
            <CodeBlock />
            {brief ? null : (
              <>
                <div style={{ color: v("muted-foreground"), fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 1, height: 18, background: v("timeline-accent", v("border")) }} />
                  14:02 · <span style={{ color: v("file-accent", v("muted-foreground")), fontFamily: MONO }}>themes/endless-color.css</span>
                </div>
                <Bubble>looks right — now match the selection blue to the glove.</Bubble>
                <div>
                  Done. Selection now reads <span style={{ fontFamily: MONO, fontSize: "0.92em" }}>rgba(47,180,255,.20)</span> over the canvas, and file paths pick up the
                  glove's steel blue — <span style={{ color: v("file-accent", v("muted-foreground")), fontFamily: MONO, fontSize: "0.92em" }}>build-color.py</span> shows it inline.
                  <span data-tp-selection="sample" style={{ background: v("selection-color-default", v("surface-selected")), color: v("foreground"), borderRadius: 3, padding: "0 3px", WebkitBoxDecorationBreak: "clone", boxDecorationBreak: "clone" }}> Selected text stays readable.</span>
                </div>
                <div style={{ color: v("muted-foreground"), fontSize: 12.5, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 1, height: 18, background: v("timeline-accent", v("border")) }} />
                  14:18 · checks completed
                </div>
                <VerificationCard />
                <Bubble>keep the hierarchy calm — orange should guide the eye, not fill the room.</Bubble>
                <div>
                  Tightened the raised surfaces and kept the content seams neutral. The sidebar edge is the only persistent orange line; focus and selection stay blue, so the two signals never compete.
                </div>
              </>
            )}
          </div>
          )}
          </div>
          <div style={{ padding: `12px ${pad}px 18px`, flex: "none" }}><Composer focused={active} /></div>
        </>
      )}
    </div>
  );
}

function InfoPanel() {
  const kv = (k: string, val: ReactNode) => (
    <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 12.5, height: 28 }}>
      <span style={{ color: v("muted-foreground") }}>{k}</span>
      <span style={{ color: v("foreground"), textAlign: "right", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{val}</span>
    </div>
  );
  return (
    <div
      // The real right panel is `bg-sidebar` WITHOUT `fixed` (probe: no seam, no
      // scoped overrides), so it must not carry the class the sidebar rule targets.
      className="bg-sidebar"
      style={{ ...sidebarScope, width: INFO_PANEL_WIDTH, flex: "none", background: v("sidebar"), color: v("sidebar-foreground"), borderLeft: `1px solid ${v("border-seam", v("border"))}`, fontFamily: SANS, display: "flex", flexDirection: "column" }}
    >
      <div style={{ height: 48, display: "flex", alignItems: "center", gap: 14, padding: "0 16px", fontSize: 12.5 }}>
        {["Info", "Files", "Changes"].map((t, i) => (
          <span key={t} style={{ color: i === 0 ? v("foreground") : v("muted-foreground"), fontWeight: i === 0 ? 600 : 400 }}>{t}</span>
        ))}
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          {kv("Status", <Badge tone="success">Running</Badge>)}
          {kv("Agent", "Claude Fable 5")}
          {kv("Branch", <span style={{ fontFamily: MONO, fontSize: 12 }}>bb/endless-theme</span>)}
          {kv("Pull request", <Badge tone="merged">Merged #42</Badge>)}
        </div>
        <div>
          <Eyebrow style={{ marginBottom: 4 }}>Files</Eyebrow>
          {["themes/endless-color.css", "build-color.py"].map((f) => (
            <div key={f} style={{ height: 24, fontSize: 12.5, fontFamily: MONO, color: v("file-accent", v("foreground")), overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{f}</div>
          ))}
        </div>
        <div style={{ borderRadius: R_BLOCK, background: v("surface-recessed-soft-solid", v("card")), boxShadow: `inset 0 0 0 1px ${v("border-hairline", v("border"))}`, padding: "10px 12px", fontSize: 12.5, color: v("readback-foreground", v("muted-foreground")), lineHeight: "18px" }}>
          Sidebar reads true black with the orange seam; blue selection at .20.
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ narrow = false, themeName, mode }: { narrow?: boolean; themeName: string; mode: Mode }) {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, background: v("canvas", v("background")), color: v("foreground"), fontFamily: SANS, overflow: "hidden" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: narrow ? "22px 16px" : "30px 32px" }}>
        {/* Appearance is the settings surface theming actually lives on, and
            these rows mirror the live selection — the picker and Settings
            stay visibly in sync. */}
        <div style={{ borderRadius: 12, marginBottom: 18, background: v("card"), boxShadow: `inset 0 0 0 1px ${v("border")}, ${v("shadow-xs", "none")}`, padding: "12px 14px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Appearance</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 28, fontSize: 12.5, borderBottom: `1px solid ${v("border-hairline", v("border"))}` }}>
            <span style={{ color: v("muted-foreground") }}>Theme</span>
            <span style={{ fontWeight: 600 }}>{themeName}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 28, fontSize: 12.5 }}>
            <span style={{ color: v("muted-foreground") }}>Mode</span>
            <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{mode}</span>
          </div>
        </div>
        <div style={{ borderRadius: 14, padding: narrow ? "18px 18px" : "20px 26px", marginBottom: 18, background: `linear-gradient(135deg, ${v("secondary")} 0%, ${v("accent")} 100%)`, boxShadow: `inset 0 0 0 1px ${v("border-hairline", v("border"))}` }}>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 6 }}>Extensions</div>
          <div style={{ fontSize: 13.5, color: v("muted-foreground"), maxWidth: 440, lineHeight: "20px" }}>Plugins add surfaces, agents and themes to bb.</div>
        </div>
        <div style={{ display: "flex", gap: 18, borderBottom: `1px solid ${v("border")}`, marginBottom: 18, fontSize: 13 }}>
          {["Installed", "Marketplace", "Themes"].map((t, i) => (
            <span key={t} style={{ padding: "0 0 8px", color: i === 0 ? v("foreground") : v("muted-foreground"), fontWeight: i === 0 ? 600 : 400, boxShadow: i === 0 ? `inset 0 -2px 0 0 ${v("primary")}` : undefined }}>{t}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "1fr 1fr", gap: 12 }}>
          {["Endless", "Endless Color", "Theme Preview", "Plugin Guide"].map((name, i) => (
            <div key={name} style={{ borderRadius: 12, background: v("card"), boxShadow: `inset 0 0 0 1px ${v("border")}, ${v("shadow-xs", "none")}`, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 12, color: v("muted-foreground") }}>v0.1.{i}</div>
              </div>
              <Switch on={i !== 3} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The frame. A fluid mock of a bb window: components keep their natural
// sizes, and panels join or leave the composition with width exactly the way
// bb's own responsive layout behaves. Nothing here is scaled or zoomed.
// ---------------------------------------------------------------------------

function FrameView({ view, composition, themeName, mode }: { view: View; composition: FrameComposition; themeName: string; mode: Mode }) {
  const { sidebar, infoPanel, splitColumns, narrow } = composition;
  switch (view) {
    case "thread":
      return (
        <>
          {sidebar ? <Sidebar selected /> : null}
          <Thread narrow={narrow} />
          {infoPanel ? <InfoPanel /> : null}
        </>
      );
    case "new":
      return (
        <>
          {sidebar ? <Sidebar hover /> : null}
          <Thread empty narrow={narrow} />
        </>
      );
    case "split":
      return (
        <>
          {sidebar ? <Sidebar selected split /> : null}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: splitColumns ? "row" : "column" }}>
            <Thread narrow marker brief={!splitColumns} />
            <div style={{ flex: "none", alignSelf: "stretch", width: splitColumns ? 1 : undefined, height: splitColumns ? undefined : 1, background: v("border-seam-vertical", v("border-seam", v("border"))) }} />
            <Thread title="Specimen sheets + social grid" active={false} narrow marker brief={!splitColumns} story="specimen" />
          </div>
        </>
      );
    case "settings":
      return (
        <>
          {sidebar ? <Sidebar /> : null}
          <SettingsPage narrow={narrow} themeName={themeName} mode={mode} />
        </>
      );
  }
}

function Frame({ view, themeName, mode }: { view: View; themeName: string; mode: Mode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={hostRef} style={{ minWidth: 0 }}>
      {width > 0 ? (
        <div
          data-tp-frame=""
          style={{
            width: "100%", height: frameHeightForWidth(width), display: "flex", overflow: "hidden", borderRadius: 12, position: "relative", boxSizing: "border-box",
            boxShadow: v("shadow-lg", "0 10px 30px rgba(0,0,0,.25)"), background: v("canvas", v("background")),
          }}
        >
          <FrameView view={view} composition={frameCompositionForWidth(width)} themeName={themeName} mode={mode} />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area 2 — Style sheet. The specimen inventory lives in taxonomy.ts; this
// section renders it as dense tables of discrete, targetable specimens
// (`data-tp-specimen`) so a later version can wire each one to an editor.
// ---------------------------------------------------------------------------

/**
 * The pair the product actually paints, not the raw token on canvas: status
 * badges render their text token over the status colour at 15% (bg-success/15
 * etc.), and diff washes carry ordinary foreground text at 18%.
 */
type ContrastSpec = { fgToken: string; fgFallbackToken?: string; washToken: string; washAlpha: number };
const STATUS_CONTRAST: Record<string, ContrastSpec> = {
  success: { fgToken: "success", washToken: "success", washAlpha: 0.15 },
  warning: { fgToken: "warning-text", fgFallbackToken: "warning", washToken: "warning", washAlpha: 0.15 },
  destructive: { fgToken: "destructive-text", fgFallbackToken: "destructive", washToken: "destructive", washAlpha: 0.15 },
  "pr-merged": { fgToken: "pr-merged", washToken: "pr-merged", washAlpha: 0.15 },
  "diff-added": { fgToken: "foreground", washToken: "diff-added", washAlpha: 0.18 },
  "diff-removed": { fgToken: "foreground", washToken: "diff-removed", washAlpha: 0.18 },
};

// Per-group props for the color specimen tables, from the taxonomy's declared
// contrast policy.
function colorGroupRowProps(policy: string, token: string): { contrastAgainst?: string; contrastSpec?: ContrastSpec } {
  if (policy === "vs-surface") return { contrastAgainst: token === "sidebar-foreground" ? "sidebar" : "canvas" };
  if (policy === "as-painted") return { contrastSpec: STATUS_CONTRAST[token] };
  return {};
}

const SURFACE_TOKENS = COLOR_GROUPS.find((group) => group.id === "surfaces")!.tokens;
// warning-text/destructive-text are measured for the painted-pair ratios but
// not listed as rows of their own; the fonts are measured for the type sheet.
const ALL_TOKENS = [
  ...COLOR_GROUPS.flatMap((group) => group.tokens),
  "warning-text", "destructive-text", "font-sans", "font-mono",
];

/** "rgb(r, g, b)" / "rgba(r, g, b, a)" → the same colour at the given alpha. */
function atAlpha(rgb: string, alpha: number): string {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!match) return rgb;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

type Computed = Record<string, { value: string; hex: string; rgb: string; sidebar: string | null }>;

function resolveColor(color: string): { rgb: string; hex: string } {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  let channels: readonly number[] | null = null;
  if (m) {
    channels = m[1].split(",").map((p) => parseFloat(p.trim()));
  } else if (color) {
    // Chrome may preserve authored oklch()/oklab()/color-mix() syntax in
    // computed styles. Painting one pixel asks the browser's color engine for
    // the actual sRGB result without duplicating its conversion math here.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      channels = [r, g, b, a / 255];
    }
  }
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return { rgb: "", hex: "—" };
  const [r, g, b, a] = channels;
  const rounded = [r, g, b].map((channel) => Math.round(channel));
  const baseHex = "#" + rounded.map((channel) => channel.toString(16).padStart(2, "0")).join("");
  const alpha = a === undefined ? 1 : a;
  return {
    rgb: alpha < 1 ? `rgba(${rounded.join(", ")}, ${alpha})` : `rgb(${rounded.join(", ")})`,
    hex: alpha < 1 ? `${baseHex} ${Math.round(alpha * 100)}%` : baseHex,
  };
}

function useComputedTokens(names: readonly string[], revision: string): Computed {
  const [out, setOut] = useState<Computed>({});
  useEffect(() => {
    // Re-read on every theme/mode change (revision) — a beat later, because the
    // theme CSS lands asynchronously after the rpc response.
    const timer = setTimeout(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    probe.className = "fixed bg-sidebar";
    probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none";
    document.body.appendChild(probe);
    const sidebarStyle = getComputedStyle(probe);
    const swatch = document.createElement("span");
    swatch.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px";
    document.body.appendChild(swatch);
    const next: Computed = {};
    for (const name of names) {
      const value = rootStyle.getPropertyValue(`--${name}`).trim();
      const scoped = sidebarStyle.getPropertyValue(`--${name}`).trim();
      swatch.style.backgroundColor = "";
      swatch.style.backgroundColor = `var(--${name})`;
      const resolved = value ? resolveColor(getComputedStyle(swatch).backgroundColor) : { rgb: "", hex: "—" };
      next[name] = {
        value,
        hex: resolved.hex,
        rgb: resolved.rgb,
        sidebar: scoped && scoped !== value ? scoped : null,
      };
    }
    probe.remove();
    swatch.remove();
    setOut(next);
    }, 350);
    return () => clearTimeout(timer);
  }, [names, revision]);
  return out;
}

/** Resolve CSS length expressions to painted pixels, the way a design tool
 * reports them. Re-measured whenever the theme changes. */
function useResolvedRadii(revision: string): Record<string, string> {
  const [out, setOut] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setTimeout(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:10px;height:10px;pointer-events:none";
      document.body.appendChild(probe);
      const next: Record<string, string> = {};
      for (const specimen of RADIUS_SPECIMENS) {
        probe.style.borderTopLeftRadius = "";
        probe.style.borderTopLeftRadius = specimen.source;
        const resolved = getComputedStyle(probe).borderTopLeftRadius;
        next[specimen.id] = resolved ? `${Math.round(parseFloat(resolved))}` : "";
      }
      probe.remove();
      setOut(next);
    }, 350);
    return () => clearTimeout(timer);
  }, [revision]);
  return out;
}

function TokenRow({ name, computed, contrastAgainst, contrastSpec, targetable = false }: { name: string; computed: Computed; contrastAgainst?: string; contrastSpec?: ContrastSpec; targetable?: boolean }) {
  const c = computed[name];
  // Ink rows carry their WCAG ratio against the surface they sit on; status
  // rows measure the pair the product paints (text token on the 15%/18% wash
  // over canvas). The 4.5:1 body-text floor is the pass mark either way.
  let ratio: number | null = null;
  if (contrastSpec) {
    const fg = computed[contrastSpec.fgToken]?.rgb || (contrastSpec.fgFallbackToken ? computed[contrastSpec.fgFallbackToken]?.rgb : "");
    const wash = computed[contrastSpec.washToken]?.rgb;
    if (fg && wash && computed.canvas?.rgb) {
      ratio = contrastRatio(fg, atAlpha(wash, contrastSpec.washAlpha), computed.canvas.rgb);
    }
  } else if (contrastAgainst && c?.rgb && computed[contrastAgainst]?.rgb) {
    ratio = contrastRatio(c.rgb, computed[contrastAgainst].rgb, contrastAgainst === "canvas" ? undefined : computed.canvas?.rgb);
  }
  const hasRatioColumn = contrastAgainst !== undefined || contrastSpec !== undefined;
  return (
    // The row is the future edit target: one element per token, addressable
    // as `[data-tp-specimen="color:<token>"]` (style-sheet rows only — the
    // at-a-glance rail duplicates are not targets).
    <div data-tp-specimen={targetable ? `color:${name}` : undefined} style={{ display: "grid", gridTemplateColumns: hasRatioColumn ? "24px minmax(0, 1fr) 72px 46px" : "24px minmax(0, 1fr) 72px", alignItems: "center", columnGap: 6, height: 22 }}>
      <span
        title={c?.sidebar ? `${c.value}\nsidebar override: ${c.sidebar}` : c?.value}
        style={{
          width: 24, height: 14, borderRadius: 3, background: c?.value ? v(name) : "transparent",
          boxShadow: `inset 0 0 0 1px ${c?.sidebar ? v("warning") : v("border-hairline", v("border"))}`,
        }}
      />
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: v("foreground"), overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{name}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontFamily: MONO, fontSize: 10.5, color: v("muted-foreground"), textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c?.hex ?? ""}</span>
      {hasRatioColumn ? (
        <span
          title={contrastSpec
            ? `contrast of --${contrastSpec.fgToken} on --${contrastSpec.washToken} at ${Math.round(contrastSpec.washAlpha * 100)}% over canvas, as bb paints it · WCAG floor 4.5:1`
            : `contrast vs --${contrastAgainst} · WCAG floor 4.5:1`}
          style={{ fontFamily: MONO, fontSize: 10.5, textAlign: "right", fontVariantNumeric: "tabular-nums", color: ratio === null || ratio >= 4.5 ? v("success") : v("destructive-text", v("destructive")), fontWeight: ratio !== null && ratio < 4.5 ? 600 : 400, whiteSpace: "nowrap" }}
        >
          {ratio === null ? "" : `${ratio.toFixed(2)}:1`}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout system, level 1: inside a content area.
//
// Typographic hierarchy is explicit and shared, so every surface differentiates
// the same five roles: section > category > control label > value > support.
// ---------------------------------------------------------------------------

const TEXT_SECTION: CSSProperties = { fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em", color: v("foreground") };
const TEXT_CATEGORY: CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: v("muted-foreground") };
const TEXT_LABEL: CSSProperties = { fontSize: 12.5, fontWeight: 500, color: v("foreground") };
const TEXT_VALUE: CSSProperties = { fontFamily: MONO, fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: v("muted-foreground") };
const TEXT_SUPPORT: CSSProperties = { fontSize: 12, lineHeight: "17px", color: v("muted-foreground") };

function SpecimenGrid({ min = 260, children }: { min?: number; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, columnGap: 28, alignItems: "start" }}>
      {children}
    </div>
  );
}

/** A titled cluster. `title` is the category role in the hierarchy. */
function SpecimenBlock({ id, title, wide = false, children }: { id?: string; title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div data-tp-block={id} style={{ marginBottom: 18, gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <div data-tp-role="category" style={{ ...TEXT_CATEGORY, minHeight: 16, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector fields — the shape design tools use for a property: a label on the
// left, a bordered well holding the value on the right. Read-only in this
// version, so they carry no interactive affordance they cannot honour; the
// well is the element a later version turns into a picker.
// ---------------------------------------------------------------------------

function FieldRow({ specimen, label, children }: { specimen?: string; label: string; children: ReactNode }) {
  return (
    <div data-tp-specimen={specimen} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 150px)", alignItems: "center", columnGap: 12, minHeight: 32 }}>
      <span data-tp-role="label" style={{ ...TEXT_LABEL, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</span>
      {children}
    </div>
  );
}

/** The bordered value well: bb's input geometry at inspector density. */
function FieldWell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="border-input bg-transparent"
      style={{ display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 9px", borderRadius: RADIUS_MD, borderWidth: 1, borderStyle: "solid", minWidth: 0 }}
    >
      {children}
    </span>
  );
}

/** First family of a CSS font list, unquoted — what the sheet reports. */
function firstFamily(value: string | undefined): string {
  if (!value) return "";
  return value.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

// ---------------------------------------------------------------------------
// Typography: editable controls (the font fields) are visually separate from
// the preview card, which applies every type role to one coherent sample.
// ---------------------------------------------------------------------------

const TYPE_ROLES: ReadonlyArray<{ id: string; label: string; token: string; size: string }> = [
  { id: "font-sans", label: "Body", token: "font-sans", size: "13.5" },
  { id: "font-sans-strong", label: "Title", token: "font-sans", size: "15" },
  { id: "font-mono", label: "Mono", token: "font-mono", size: "12.5" },
];

function TypeSheet({ computed }: { computed: Computed }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {TYPE_ROLES.map((row) => (
        <FieldRow key={row.id} specimen={`type:${row.id}`} label={row.label}>
          <FieldWell title={computed[row.token]?.value}>
            <Icon name="TextWrap" className="size-3.5 shrink-0 opacity-60" />
            <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontFamily: row.token === "font-mono" ? MONO : SANS }}>
              {firstFamily(computed[row.token]?.value)}
            </span>
            <span style={{ ...TEXT_VALUE, fontSize: 10.5, flex: "none" }}>{row.size}</span>
          </FieldWell>
        </FieldRow>
      ))}
    </div>
  );
}

/** The preview card: output, not control — every type role on one artefact. */
function TypePreviewCard() {
  return (
    <div
      data-tp-type-preview=""
      style={{ marginTop: 4, padding: "14px 16px", borderRadius: RADIUS_LG, background: v("card"), boxShadow: `inset 0 0 0 1px ${v("border")}` }}
    >
      <div style={{ ...TEXT_CATEGORY, marginBottom: 8 }}>Preview</div>
      <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", color: v("foreground") }}>Endless theme family</div>
      <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: "20px", color: v("foreground") }}>
        Body copy carries most of the interface. It sets reading rhythm, so its family and size decide how dense the product feels.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <Badge tone="success"><Dot color={v("success")} size={6} /> Running</Badge>
        <span style={{ ...TEXT_CATEGORY }}>Label</span>
      </div>
      <div style={{ ...TEXT_VALUE, fontSize: 11.5, marginTop: 6, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        themes/endless-color.css · 14:18
      </div>
    </div>
  );
}

function RadiusSheet({ resolved }: { resolved: Record<string, string> }) {
  // Corner radius the way a design tool shows it: a live corner preview, then
  // the resolved value in a numeric field with its unit.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {RADIUS_SPECIMENS.map((specimen) => (
        <FieldRow key={specimen.id} specimen={`radius:${specimen.id}`} label={specimen.title}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden
              style={{
                width: 24, height: 24, flex: "none", borderTopLeftRadius: specimen.source,
                borderTop: `2px solid ${v("foreground")}`, borderLeft: `2px solid ${v("foreground")}`,
                opacity: 0.65,
              }}
            />
            <FieldWell title={specimen.source}>
              <span style={{ flex: 1, minWidth: 0, ...TEXT_VALUE, color: v("foreground"), overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{resolved[specimen.id] ?? ""}</span>
              <span style={{ ...TEXT_VALUE, fontSize: 10.5, flex: "none" }}>px</span>
            </FieldWell>
          </span>
        </FieldRow>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Foundation — the primary section. Everything else in the theme derives from
// these values, so they get the largest controls and the most room.
// ---------------------------------------------------------------------------

function FoundationRow({ token, computed }: { token: string; computed: Computed }) {
  const c = computed[token];
  return (
    <div
      data-tp-specimen={`color:${token}`}
      style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", alignItems: "center", columnGap: 14, minHeight: 44, padding: "0 4px", borderBottom: `1px solid ${v("border-hairline", v("border"))}` }}
    >
      <span
        title={c?.sidebar ? `${c.value}\nsidebar override: ${c.sidebar}` : c?.value}
        style={{ width: 44, height: 30, borderRadius: RADIUS_MD, background: c?.value ? v(token) : "transparent", boxShadow: `inset 0 0 0 1px ${c?.sidebar ? v("warning") : v("border")}` }}
      />
      <span data-tp-role="label" style={{ ...TEXT_LABEL, fontSize: 13, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{token}</span>
      <span data-tp-role="value" style={{ ...TEXT_VALUE, fontSize: 12, whiteSpace: "nowrap" }}>{c?.hex ?? ""}</span>
    </div>
  );
}

function FoundationSection({ computed }: { computed: Computed }) {
  return (
    <div data-tp-block="foundation">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", columnGap: 28 }}>
        {[SURFACE_TOKENS.slice(0, 4), SURFACE_TOKENS.slice(4)].map((group, index) => (
          <div key={index} style={{ minWidth: 0 }}>
            {group.map((token) => <FoundationRow key={token} token={token} computed={computed} />)}
          </div>
        ))}
      </div>
      <div
        data-tp-foundation-note=""
        style={{ marginTop: 14, padding: "12px 14px", borderRadius: RADIUS_LG, background: v("surface-recessed-soft-solid", v("card")), boxShadow: `inset 0 0 0 1px ${v("border-hairline", v("border"))}` }}
      >
        <p style={{ margin: 0, ...TEXT_SUPPORT }}>
          These surfaces are the theme's foundation. Every other value below — ink, accents, status, lines — is derived from the canvas and ink anchors, so changing a foundation value moves the whole theme with it.
        </p>
      </div>
    </div>
  );
}

/**
 * The thread list: bb's sidebar rows as a live demonstration. Rows highlight on
 * hover and expand to representative unfurled content, so a theme can be judged
 * against the states users actually produce. Rows are real buttons, so keyboard
 * focus and Enter/Space work and screen readers get the expanded state.
 */
const THREAD_ROWS = [
  { id: "unread", label: "Endless theme family", state: "rest" as const, dot: "unread" as const, detail: "Neon orange seam, blue selection, calm UV canvas. 3 files changed." },
  { id: "open", label: "Specimen sheets + social grid", state: "selected" as const, dot: undefined, detail: "Six tiles: surfaces, ink, accents, status, lines, type." },
  { id: "split", label: "Fix pink split row", state: "split" as const, dot: "status" as const, detail: "oklch mix resolved against the sidebar, not the canvas." },
];

function ThreadListSpecimen() {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div
      data-tp-thread-list=""
      className="fixed bg-sidebar"
      style={{ ...sidebarScope, overflow: "hidden", background: v("sidebar"), boxShadow: `inset 0 0 0 1px ${v("border-seam", v("border"))}`, borderRadius: RADIUS_MD, padding: 5 }}
    >
      {THREAD_ROWS.map((row) => {
        const isOpen = expanded === row.id;
        return (
          <div key={row.id}>
            <button
              type="button"
              data-tp-thread-row={row.id}
              aria-expanded={isOpen}
              onClick={() => setExpanded((current) => (current === row.id ? null : row.id))}
              className="w-full cursor-pointer rounded-[10px] text-left hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30, padding: "0 10px", border: 0, background: "transparent", font: "inherit", color: v("sidebar-foreground"), ...rowStyle(isOpen ? "selected" : row.state) }}
            >
              <span aria-hidden style={{ flex: "none", fontSize: 9, opacity: 0.6, transform: isOpen ? "rotate(90deg)" : undefined, transition: "transform 140ms ease" }}>▶</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 13 }}>{row.label}</span>
              {row.dot === "unread" ? <Dot color={v("foreground")} size={5} /> : row.dot === "status" ? <Dot color={`color-mix(in srgb, ${v("muted-foreground")} 60%, transparent)`} size={5} /> : null}
            </button>
            {isOpen ? (
              <div data-tp-thread-detail={row.id} style={{ margin: "2px 6px 6px 26px", padding: "8px 10px", borderRadius: RADIUS_MD, background: v("surface-recessed", "rgba(127,127,127,.05)"), boxShadow: `inset 0 0 0 1px ${v("border-hairline", v("border"))}` }}>
                <div style={{ ...TEXT_SUPPORT, color: v("sidebar-foreground"), opacity: 0.85 }}>{row.detail}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <Badge tone="success"><Dot color={v("success")} size={5} /> Running</Badge>
                  <span style={{ ...TEXT_VALUE, fontSize: 10.5 }}>bb/endless-theme</span>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area 4 — interactive overlays. Every launcher is a real button that opens a
// real bb surface, so it carries a full affordance set: pointer cursor, hover
// fill, focus ring, and an open (selected) state. Radix triggers publish
// `data-state="open"`; the two hover surfaces are controlled here.
// ---------------------------------------------------------------------------

// bb's standard hover delay (the app's tooltips use 300ms); the close delay
// is the grace period for crossing the gap from trigger to card.
const HOVER_OPEN_DELAY_MS = 300;
const HOVER_CLOSE_DELAY_MS = 150;

// Compact launchers: no trailing icon, tighter box, states carried by fill and
// border so they still read as buttons.
const OVERLAY_TRIGGER_CLASS =
  "h-7 w-full cursor-pointer justify-center px-2 text-xs font-normal " +
  "hover:bg-accent hover:text-accent-foreground hover:border-ring/60 " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 " +
  "data-[state=open]:border-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground";

function OverlayTriggerLabel({ children }: { children: ReactNode }) {
  return <span style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{children}</span>;
}

// A tooltip that stays readable while the pointer crosses it: opening uses the
// standard delay, dismissal waits out normal pointer movement, and keyboard
// focus drives the same state.
const TOOLTIP_DISMISS_DELAY_MS = 700;

function useDelayedTooltip() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => { if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined; } };
  useEffect(() => clear, []);
  return {
    open,
    show: () => { clear(); setOpen(true); },
    hideSoon: () => { clear(); timer.current = setTimeout(() => setOpen(false), TOOLTIP_DISMISS_DELAY_MS); },
    hideNow: () => { clear(); setOpen(false); },
    setOpen,
  };
}

function OverlaySpecimens({ vertical = false }: { vertical?: boolean }) {
  // Tooltip and hover card are hover surfaces, but every launcher should also
  // answer a click — a silent button reads as broken.
  const tooltip = useDelayedTooltip();
  const [hoverCardOpen, setHoverCardOpen] = useState(false);
  const openClass = (open: boolean) => cn(OVERLAY_TRIGGER_CLASS, open && "border-ring bg-accent text-accent-foreground");
  return (
    <div
      data-tp-overlay-launchers=""
      style={vertical
        ? { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: 4 }
        : { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 4 }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BbButton variant="outline" size="sm" className={OVERLAY_TRIGGER_CLASS}><OverlayTriggerLabel>Menu</OverlayTriggerLabel></BbButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Thread</DropdownMenuLabel>
          <DropdownMenuItem>Rename…</DropdownMenuItem>
          <DropdownMenuItem>Open in split</DropdownMenuItem>
          <DropdownMenuItem>Copy link</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive">Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog>
        <DialogTrigger asChild>
          <BbButton variant="outline" size="sm" className={OVERLAY_TRIGGER_CLASS}><OverlayTriggerLabel>Dialog</OverlayTriggerLabel></BbButton>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive thread?</DialogTitle>
            <DialogDescription>“Endless theme family — blacklight pass” moves to the archive. You can restore it from search at any time.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <BbButton variant="outline" size="sm">Cancel</BbButton>
            </DialogClose>
            <DialogClose asChild>
              <BbButton size="sm">Archive</BbButton>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Popover>
        <PopoverTrigger asChild>
          <BbButton variant="outline" size="sm" className={OVERLAY_TRIGGER_CLASS}><OverlayTriggerLabel>Popover</OverlayTriggerLabel></BbButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">On this page</div>
          {["Verification summary", "Selection blue", "Sidebar seam"].map((item, index) => (
            <div key={item} className={cn("rounded-sm px-2 py-1 text-sm", index === 0 ? "bg-accent text-accent-foreground" : "text-foreground")}>{item}</div>
          ))}
        </PopoverContent>
      </Popover>
      <TooltipProvider delayDuration={HOVER_OPEN_DELAY_MS}>
        <Tooltip open={tooltip.open} onOpenChange={tooltip.setOpen}>
          <TooltipTrigger asChild>
            <BbButton
              variant="outline"
              size="sm"
              data-tp-tooltip-trigger=""
              className={openClass(tooltip.open)}
              onMouseEnter={tooltip.show}
              onMouseLeave={tooltip.hideSoon}
              onFocus={tooltip.show}
              onBlur={tooltip.hideNow}
              onClick={(event) => { event.preventDefault(); tooltip.show(); }}
            >
              <OverlayTriggerLabel>Tooltip</OverlayTriggerLabel>
            </BbButton>
          </TooltipTrigger>
          <TooltipContent
            data-tp-tooltip-content=""
            onMouseEnter={tooltip.show}
            onMouseLeave={tooltip.hideSoon}
          >
            Copy branch name
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* Radix owns the hover lifecycle: it opens after the delay and closes
          once the pointer has left BOTH the trigger and the content, so no
          manual mouse handler can strand it open. Click stays available as an
          explicit toggle for tap and keyboard users. */}
      <HoverCard
        open={hoverCardOpen}
        onOpenChange={setHoverCardOpen}
        openDelay={HOVER_OPEN_DELAY_MS}
        closeDelay={HOVER_CLOSE_DELAY_MS}
      >
        <HoverCardTrigger asChild>
          <BbButton
            variant="outline"
            size="sm"
            data-tp-hovercard-trigger=""
            className={openClass(hoverCardOpen)}
            onClick={() => setHoverCardOpen((open) => !open)}
          >
            <OverlayTriggerLabel>Hover card</OverlayTriggerLabel>
          </BbButton>
        </HoverCardTrigger>
        <HoverCardContent
          data-tp-hovercard-content=""
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Sized to its trigger like bb's select content, so the two line up
          // instead of the card being shunted sideways to avoid a collision.
          style={{ width: "max(var(--radix-hover-card-trigger-width), 15rem)" }}
          className="p-3"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Endless theme family</span>
            <Badge tone="success"><Dot color={v("success")} size={6} /> Running</Badge>
          </div>
          <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 12, color: v("muted-foreground") }}>bb/endless-theme</div>
          <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: "18px", color: v("muted-foreground") }}>Sidebar reads true black with the orange seam; blue selection at .20.</div>
          {/* Controls live inside the card: acting on them must not dismiss it. */}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <BbButton
              variant="outline"
              size="sm"
              className="h-7 flex-1 cursor-pointer px-2 text-xs"
              onClick={() => toast.success("Branch name copied", { description: "bb/endless-theme" })}
            >
              Copy branch
            </BbButton>
            <BbButton
              size="sm"
              className="h-7 flex-1 cursor-pointer px-2 text-xs"
              onClick={() => toast.success("Opened in split")}
            >
              Open in split
            </BbButton>
          </div>
        </HoverCardContent>
      </HoverCard>
      <BbButton variant="outline" size="sm" className={OVERLAY_TRIGGER_CLASS} onClick={() => toast.success("Reference sheet updated", { description: "themes/endless-color.css" })}>
        <OverlayTriggerLabel>Toast</OverlayTriggerLabel>
      </BbButton>
    </div>
  );
}

/** Area 2 — the style sheet. Foundation leads; the derived families follow. */
function StyleSheetSection({ computed, radii }: { computed: Computed; radii: Record<string, string> }) {
  const derived = COLOR_GROUPS.filter((group) => group.id !== "surfaces");
  return (
    <div>
      <div data-tp-block="surfaces" style={{ marginBottom: 26 }}>
        <div data-tp-role="category" style={{ ...TEXT_CATEGORY, marginBottom: 10 }}>Foundation · surfaces</div>
        <FoundationSection computed={computed} />
      </div>

      <div data-tp-role="section" style={{ ...TEXT_SECTION, fontSize: 13, marginBottom: 12 }}>Derived values</div>
      <SpecimenGrid min={280}>
        {derived.map((group) => (
          <SpecimenBlock key={group.id} id={group.id} title={group.title}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {group.tokens.map((token) => (
                <TokenRow key={token} name={token} computed={computed} targetable {...colorGroupRowProps(group.contrast, token)} />
              ))}
            </div>
          </SpecimenBlock>
        ))}
        <SpecimenBlock id="type" title="Typography">
          <TypeSheet computed={computed} />
          <TypePreviewCard />
        </SpecimenBlock>
        <SpecimenBlock id="radius" title="Corner radius">
          <RadiusSheet resolved={radii} />
        </SpecimenBlock>
      </SpecimenGrid>
    </div>
  );
}

/**
 * Area 3 — components. Every control here is live: a theme is judged by how it
 * paints hover, focus, pressed, checked, disabled and expanded, which a static
 * picture cannot show.
 */
function ComponentsSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("endless");
  const [notify, setNotify] = useState(true);
  const [compact, setCompact] = useState(false);
  const [checked, setChecked] = useState(true);
  const [agreed, setAgreed] = useState(false);
  return (
    <SpecimenGrid min={280}>
      <SpecimenBlock id="buttons" title="Buttons" wide>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <BbButton size="sm" className="cursor-pointer" onClick={() => toast.success("Primary action")}>Default</BbButton>
          <BbButton size="sm" variant="secondary" className="cursor-pointer" onClick={() => toast.success("Secondary action")}>Secondary</BbButton>
          <BbButton size="sm" variant="outline" className="cursor-pointer" onClick={() => toast.success("Outline action")}>Outline</BbButton>
          <BbButton size="sm" variant="ghost" className="cursor-pointer" onClick={() => toast.success("Ghost action")}>Ghost</BbButton>
          <BbButton size="sm" variant="destructive" className="cursor-pointer" onClick={() => toast.error("Deleted")}>Delete</BbButton>
          <BbButton size="sm" variant="outline" disabled>Disabled</BbButton>
        </div>
      </SpecimenBlock>
      <SpecimenBlock id="badges" title="Badges" wide>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Badge tone="success"><Dot color={v("success")} size={6} /> Running</Badge><Badge tone="warning">Attention</Badge>
          <Badge tone="destructive">Failed</Badge><Badge tone="merged">Merged</Badge><Badge tone="outline">branch</Badge>
        </div>
      </SpecimenBlock>
      <SpecimenBlock id="inputs" title="Inputs">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <BbInput aria-label="Search threads" placeholder="Search threads…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <BbInput aria-label="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <BbInput aria-label="Disabled input" value="Disabled" disabled readOnly />
        </div>
      </SpecimenBlock>
      <SpecimenBlock id="switch" title="Switch">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", ...TEXT_LABEL }}>
            <BbSwitch checked={notify} onCheckedChange={setNotify} className="cursor-pointer" /> Notifications
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", ...TEXT_LABEL }}>
            <BbSwitch checked={compact} onCheckedChange={setCompact} className="cursor-pointer" /> Compact rows
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, ...TEXT_LABEL, opacity: 0.55 }}>
            <BbSwitch checked disabled /> Disabled
          </label>
        </div>
      </SpecimenBlock>
      <SpecimenBlock id="checkbox" title="Checkbox">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", ...TEXT_LABEL }}>
            <BbCheckbox checked={checked} onCheckedChange={(next) => setChecked(next === true)} className="cursor-pointer" /> Include drafts
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", ...TEXT_LABEL }}>
            <BbCheckbox checked={agreed} onCheckedChange={(next) => setAgreed(next === true)} className="cursor-pointer" /> Watch this branch
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, ...TEXT_LABEL, opacity: 0.55 }}>
            <BbCheckbox checked disabled /> Disabled
          </label>
        </div>
      </SpecimenBlock>
    </SpecimenGrid>
  );
}

/** The rail beside the mock: the interaction surfaces, compact. */
function StageRail({ withOverlayHeading = true }: { withOverlayHeading?: boolean }) {
  return (
    <>
      {withOverlayHeading ? (
        <SpecimenBlock title={AREA_TITLES.overlays}>
          <OverlaySpecimens vertical />
        </SpecimenBlock>
      ) : (
        <div style={{ marginBottom: 18 }}><OverlaySpecimens vertical /></div>
      )}
      <SpecimenBlock id="thread-list" title="Thread list">
        <ThreadListSpecimen />
      </SpecimenBlock>
    </>
  );
}

// ---------------------------------------------------------------------------
// The theme control: bb's own select, one option per theme × mode. Every row
// previews the theme it names — its prominent colours as chips, its face as
// live type — so the choice is made on appearance rather than on an id.
// ---------------------------------------------------------------------------

type Swatch = {
  canvas: string | null; sidebar: string | null; card: string | null;
  primary: string | null; accent: string | null; foreground: string | null;
  fontSans: string | null; fontMono: string | null;
};
type ThemeEntry = { id: string; name: string; light: Swatch | null; dark: Swatch | null };
type Catalog = { activeThemeId: string | null; themes: ThemeEntry[]; revision: number };

const EMPTY_CATALOG: Catalog = { activeThemeId: null, themes: [], revision: 0 };
let catalogSnapshot: Catalog = EMPTY_CATALOG;

function commitCatalog(next: Catalog, update: (catalog: Catalog) => void): void {
  catalogSnapshot = next;
  update(next);
}

const CHIP_KEYS = ["sidebar", "canvas", "card", "primary", "accent"] as const;

function Chips({ swatch, w = 13, h = 20 }: { swatch: Swatch | null; w?: number; h?: number }) {
  return (
    <span style={{ display: "flex", gap: 3, flex: "none" }}>
      {CHIP_KEYS.map((key) => (
        <span
          key={key}
          title={`--${key === "accent" ? "file-accent" : key}: ${swatch?.[key] ?? "bundled with the app, not readable from disk"}`}
          style={{
            width: w, height: h, borderRadius: 3, flex: "none", background: swatch?.[key] ?? "transparent",
            boxShadow: `inset 0 0 0 1px ${swatch?.[key] ? v("border-hairline", v("border")) : v("border")}`,
            opacity: swatch?.[key] ? 1 : 0.35,
          }}
        />
      ))}
    </span>
  );
}

// Theme ids may themselves contain ":" (plugin:endless:endless-color), so the
// mode leads and the first separator wins.
const SELECTION_SEPARATOR = "::";
const selectionValue = (themeId: string, mode: Mode): string => `${mode}${SELECTION_SEPARATOR}${themeId}`;
function parseSelectionValue(value: string): ThemeSelection {
  const separator = value.indexOf(SELECTION_SEPARATOR);
  return {
    mode: value.slice(0, separator) as Mode,
    themeId: value.slice(separator + SELECTION_SEPARATOR.length),
  };
}

/**
 * A mode cue that needs no word: a disc split into the theme's own light and
 * dark faces. Following Figma's model, mode is a switch over the theme list
 * rather than a label repeated on every row.
 */
function ModeDisc({ entry, size = 14 }: { entry: ThemeEntry | undefined; size?: number }) {
  const light = entry?.light?.canvas ?? "#f4f4f4";
  const dark = entry?.dark?.canvas ?? "#1a1a1a";
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 999, flex: "none",
        background: `linear-gradient(90deg, ${light} 0 50%, ${dark} 50% 100%)`,
        boxShadow: `inset 0 0 0 1px ${v("border")}`,
      }}
    />
  );
}

function ThemeOption({ entry, mode }: { entry: ThemeEntry; mode: Mode }) {
  const swatch = mode === "dark" ? entry.dark : entry.light;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Chips swatch={swatch} w={8} h={14} />
      <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{entry.name}</span>
    </span>
  );
}

/** Light/dark as a two-option switch, labelled for assistive tech. */
function ModeSwitch({ mode, disabled, onPick }: { mode: Mode; disabled: boolean; onPick: (next: Mode) => void }) {
  return (
    <div
      data-tp-mode-switch=""
      role="group"
      aria-label="Colour mode"
      className="border-input"
      style={{ display: "flex", gap: 2, padding: 2, borderRadius: RADIUS_MD, borderWidth: 1, borderStyle: "solid", flex: "none" }}
    >
      {(["light", "dark"] as const).map((option) => {
        const active = mode === option;
        return (
          <button
            key={option}
            type="button"
            data-tp-mode={option}
            aria-pressed={active}
            aria-label={option === "light" ? "Light mode" : "Dark mode"}
            title={option === "light" ? "Light mode" : "Dark mode"}
            disabled={disabled}
            onClick={() => onPick(option)}
            className={cn(
              "flex h-6 w-7 cursor-pointer items-center justify-center rounded-sm transition-colors",
              "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-accent text-accent-foreground",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <span
              aria-hidden
              style={{
                width: 12, height: 12, borderRadius: 999,
                background: option === "light" ? v("canvas", "#fff") : v("foreground"),
                boxShadow: `inset 0 0 0 1px ${v("border")}`,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function ThemePicker({
  catalog,
  computed,
  mode,
  pendingSelection,
  selectionSlow,
  selectionFailed,
  onPick,
  onRetry,
}: {
  catalog: Catalog;
  computed: Computed;
  mode: Mode;
  pendingSelection: ThemeSelection | null;
  selectionSlow: boolean;
  selectionFailed: boolean;
  onPick: (themeId: string, mode: Mode) => void;
  onRetry: () => void;
}) {
  const displayThemeId = pendingSelection?.themeId ?? catalog.activeThemeId;
  const displayMode = pendingSelection?.mode ?? mode;
  const current = catalog.themes.find((theme) => theme.id === displayThemeId) ?? catalog.themes[0];
  const diskSwatch = current ? (displayMode === "dark" ? current.dark : current.light) : null;
  const measured = (name: string): string | null => computed[name]?.rgb || null;
  const currentSwatch: Swatch | null = pendingSelection === null && current?.id === catalog.activeThemeId
    ? {
        canvas: diskSwatch?.canvas ?? measured("canvas"),
        sidebar: diskSwatch?.sidebar ?? measured("sidebar"),
        card: diskSwatch?.card ?? measured("card"),
        primary: diskSwatch?.primary ?? measured("primary"),
        accent: diskSwatch?.accent ?? measured("file-accent"),
        foreground: diskSwatch?.foreground ?? measured("foreground"),
        fontSans: diskSwatch?.fontSans ?? null,
        fontMono: diskSwatch?.fontMono ?? null,
      }
    : diskSwatch;
  const pending = pendingSelection !== null;
  const loading = catalog.themes.length === 0;
  const accessibleName = loading
    ? "Loading themes"
    : pending
    ? `${selectionSlow ? "Still applying" : "Applying"} ${current?.name ?? "theme"} ${displayMode}`
    : `${current?.name ?? "Theme"} ${displayMode}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Select
          value={current?.id ?? ""}
          onValueChange={(themeId) => onPick(themeId, displayMode)}
        >
          <SelectTrigger
            data-tp-theme-control=""
            aria-busy={pending}
            aria-label={accessibleName}
            disabled={pending || loading}
            className="h-8 w-auto min-w-36 max-w-52 gap-2 text-sm"
          >
            <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <Chips swatch={currentSwatch} w={6} h={11} />
              <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>{loading ? "Loading themes…" : current?.name ?? "Theme"}</span>
            </span>
          </SelectTrigger>
          <SelectContent align="end" className="w-56 max-w-[calc(100vw-24px)]">
            <SelectGroup>
              {catalog.themes.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} textValue={entry.name}>
                  <ThemeOption entry={entry} mode={displayMode} />
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <ModeSwitch
          mode={displayMode}
          disabled={pending || loading}
          onPick={(next) => { if (current) onPick(current.id, next); }}
        />
      </div>
      {pending && selectionSlow ? (
        <div role="status" style={{ fontSize: 10.5, color: v("muted-foreground") }}>Still applying…</div>
      ) : null}
      {selectionFailed ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 7, minHeight: 20, fontSize: 10.5, color: v("destructive-text", v("destructive")) }}>
          <span>Theme didn’t apply.</span>
          <button
            type="button"
            aria-label="Retry theme"
            onClick={onRetry}
            className="cursor-pointer underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
            style={{ appearance: "none", border: 0, background: "none", padding: 0, color: "inherit", font: "inherit" }}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Light/dark is a per-client preference in bb, stored in localStorage under
// `bb.theme` as "light" | "dark" | "system" and mirrored onto the document's
// `.dark` class. Writing the key (not just the class) is what makes the choice
// stick and what keeps Settings → Appearance showing the same thing; the
// storage event tells bb's own control to re-read it.
const MODE_KEY = "bb.theme";

function useColorMode(): [Mode, (next: Mode) => void] {
  const read = () => (document.documentElement.classList.contains("dark") ? "dark" : "light") as Mode;
  const [mode, setMode] = useState<Mode>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setMode(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  const set = (next: Mode) => {
    const previous = localStorage.getItem(MODE_KEY);
    localStorage.setItem(MODE_KEY, next);
    // Same-document writes do not fire `storage`, so dispatch it ourselves for
    // any listener in this window; other windows get the native event.
    window.dispatchEvent(new StorageEvent("storage", { key: MODE_KEY, oldValue: previous, newValue: next, storageArea: localStorage }));
    document.documentElement.classList.toggle("dark", next === "dark");
    setMode(next);
  };
  return [mode, set];
}

function PreviewPage({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [mode, setMode] = useColorMode();
  const navigate = useBbNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [layout, setLayout] = useState<{ band: LayoutBand; width: number }>({ band: "mobile", width: 0 });
  const [catalog, setCatalog] = useState<Catalog>(() => catalogSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<ThemeSelection | null>(null);
  const [failedSelection, setFailedSelection] = useState<ThemeSelection | null>(null);
  const [selectionSlow, setSelectionSlow] = useState(false);
  const catalogRequests = useRef(new LatestRequest());
  const selectionPending = useRef(false);
  const catalogLoadPending = useRef(false);
  const catalogLoadQueued = useRef(false);

  const view = useMemo<View>(() => {
    const first = subPath.split("/").filter(Boolean)[0] ?? "";
    return (VIEWS as readonly string[]).includes(first) ? (first as View) : "thread";
  }, [subPath]);

  // Poll while the panel is open: the server compares the active theme file's
  // mtime and re-applies it when an agent has rewritten it, so a theme being
  // edited in the other split repaints here without anyone clicking anything.
  const loadRef = useRef<() => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (selectionPending.current || catalogLoadPending.current) {
        catalogLoadQueued.current = true;
        return;
      }
      catalogLoadQueued.current = false;
      catalogLoadPending.current = true;
      const request = catalogRequests.current.begin();
      withRpcTimeout(rpc.call("themeCatalog", {}), "Theme catalog")
        .then((c) => {
          if (!cancelled && !catalogLoadQueued.current && catalogRequests.current.isLatest(request)) {
            commitCatalog(c, setCatalog);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled && !catalogLoadQueued.current && catalogRequests.current.isLatest(request)) {
            setError(String(e));
          }
        })
        .finally(() => {
          catalogLoadPending.current = false;
          if (!cancelled && catalogLoadQueued.current) load();
        });
    };
    loadRef.current = load;
    load();
    // Slow fallback only; the server's directory watcher signals changes instantly.
    const timer = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [rpc]);
  useRealtime("theme-preview:changed", () => loadRef.current());

  useEffect(() => {
    if (!pendingSelection) {
      setSelectionSlow(false);
      return;
    }
    const timer = setTimeout(() => setSelectionSlow(true), 5_000);
    return () => clearTimeout(timer);
  }, [pendingSelection]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const band = layoutBandForWidth(width);
      setLayout((current) => current.band === band && current.width === width ? current : { band, width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const applySelection = (selection: ThemeSelection) => {
    if (selectionPending.current) return;
    setMode(selection.mode);
    // Always send the explicit choice. The catalog reflects the last completed
    // apply, so it can be stale while a slower selection is still in flight.
    selectionPending.current = true;
    setPendingSelection(selection);
    setFailedSelection(null);
    setError(null);
    const request = catalogRequests.current.begin();
    withRpcTimeout(rpc.call("setTheme", { themeId: selection.themeId }), "Theme selection")
      .then((next) => {
        if (catalogRequests.current.isLatest(request)) {
          commitCatalog(next, setCatalog);
          setFailedSelection(null);
        }
      })
      .catch(() => {
        if (catalogRequests.current.isLatest(request)) setFailedSelection(selection);
      })
      .finally(() => {
        if (catalogRequests.current.isLatest(request)) {
          selectionPending.current = false;
          setPendingSelection(null);
          if (catalogLoadQueued.current) loadRef.current();
        }
      });
  };
  const pick = (themeId: string, nextMode: Mode) => applySelection({ themeId, mode: nextMode });
  const retrySelection = () => { if (failedSelection) applySelection(failedSelection); };

  const revision = `${mode}:${catalog.activeThemeId ?? ""}:${catalog.revision}`;
  const computed = useComputedTokens(ALL_TOKENS, revision);
  const radii = useResolvedRadii(revision);
  const mobile = layout.band === "mobile";
  const railWidth = layout.band === "narrow" ? surfaceRailWidth(layout.width) : 276;
  const contentInset = contentInsetForWidth(layout.width);
  const displayThemeId = pendingSelection?.themeId ?? catalog.activeThemeId;
  const displayThemeName = catalog.themes.find((theme) => theme.id === displayThemeId)?.name ?? "Current theme";

  return (
    <div ref={rootRef} data-tp-root data-tp-band={layout.band} style={{ height: "100%", overflowY: "auto", overflowX: "hidden", background: v("canvas", v("background")), color: v("foreground"), fontFamily: SANS }}>
      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 20, borderBottom: `1px solid ${v("border-seam", v("border"))}`, background: v("canvas", v("background")) }}>
        <div data-tp-header-inner="" style={{ width: "100%", maxWidth: STUDIO_MAX_WIDTH, margin: "0 auto", boxSizing: "border-box", display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: space(2), gap: space(2), padding: `${space(2)} ${contentInset}px` }}>
          <Tabs value={view} onValueChange={(next) => navigate.toPluginPanel("preview", { subPath: next })}>
            <TabsList data-tp-view-control="" aria-label="Preview view" className={cn(mobile && "w-full")}>
              {VIEWS.map((item) => (
                <TabsTrigger key={item} value={item} className={cn("cursor-pointer", mobile && "flex-1")}>
                  {VIEW_LABEL[item]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div style={{ flex: 1 }} />
          {error ? <span style={{ fontSize: 12, color: v("destructive-text", v("destructive")) }}>{error}</span> : null}
          <div style={{ flex: mobile ? "1 1 100%" : "none", minWidth: 0 }}>
            <ThemePicker
              catalog={catalog}
              computed={computed}
              mode={mode}
              pendingSelection={pendingSelection}
              selectionSlow={selectionSlow}
              selectionFailed={failedSelection !== null}
              onPick={pick}
              onRetry={retrySelection}
            />
          </div>
        </div>
      </div>

      {/* Layout system, level 2: the plugin window. One stage zone (mock +
          at-a-glance rail on wider bands), then flow sections in taxonomy
          order, all on the same max-width spine. On the mobile band the rail
          content becomes the first flow section so nothing is lost, only
          restacked. */}
      <div style={{ borderBottom: `1px solid ${v("border-seam", v("border"))}` }}>
        <div
          data-tp-layout={layout.band}
          style={{
            width: "100%", maxWidth: STUDIO_MAX_WIDTH, margin: "0 auto", minHeight: 0, display: "grid",
            gridTemplateColumns: mobile ? "minmax(0, 1fr)" : `minmax(0, 1fr) ${railWidth}px`,
            alignItems: "start",
          }}
        >
          <div data-tp-area="mock" style={{ minWidth: 0, padding: contentInset }}>
            <Frame view={view} themeName={displayThemeName} mode={mode} />
          </div>
          {mobile ? null : (
            <div
              data-tp-section="rail"
              style={{
                minWidth: 0, alignSelf: "stretch", padding: `${contentInset}px ${contentInset}px ${space(4)}`,
                borderLeft: `1px solid ${v("border-seam", v("border"))}`,
                background: v("surface-recessed-soft-solid", v("card")),
              }}
            >
              <StageRail />
            </div>
          )}
        </div>
      </div>

      {(mobile
        ? (["overlays", "stylesheet", "components"] as const)
        : (["stylesheet", "components"] as const)
      ).map((area) => (
        <div key={area} data-tp-area={area} style={{ width: "100%", maxWidth: STUDIO_MAX_WIDTH, margin: "0 auto", boxSizing: "border-box", scrollMarginTop: headerHeight + 12, padding: `${space(4)} ${contentInset}px ${space(1)}` }}>
          <div style={{ minHeight: 18, marginBottom: 10, fontSize: 12.5, fontWeight: 650, letterSpacing: "-0.005em" }}>{AREA_TITLES[area]}</div>
          {/* On the mobile band the rail's content becomes this section, so
              the interaction surfaces are never lost — only restacked. */}
          {area === "overlays" ? <StageRail withOverlayHeading={false} />
            : area === "components" ? <ComponentsSection />
            : <StyleSheetSection computed={computed} radii={radii} />}
        </div>
      ))}
      <div style={{ height: space(8) }} />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "preview",
    title: "Theme Preview",
    icon: "Palette",
    path: "preview",
    component: PreviewPage,
  });
});
