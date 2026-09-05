import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import { useSonner } from "sonner";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserCookieImport,
  BbDesktopBrowserCookieImportSource,
  BbDesktopBrowserFindInPageRequest,
  BbDesktopBrowserPageCaptureResult,
  BbDesktopBrowserPointerInputEvent,
  BbDesktopBrowserState,
  BbDesktopBrowserViewportBounds,
  BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import type { BrowserTabTarget } from "@bb/server-contract";
import {
  BB_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH,
  clampBbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
  COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { getBbDesktopInfo, getDesktopBrowserApi } from "@/lib/bb-desktop";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getBrowserUrlSecurity,
  getBrowserUrlHost,
  resolveBrowserAddressInput,
} from "@/lib/browser-url";
import { useBrowserHistory } from "@/lib/browser-history";
import { BROWSER_VIEW_BOUNDS_SYNC_EVENT } from "@/lib/browser-view-bounds-sync";
import { updateDesktopBrowserViewAperture } from "@/lib/desktop-browser-view-aperture";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { BrowserFindBar, type BrowserFindMatches } from "./BrowserFindBar";
import { BrowserScreenshotAnnotation } from "./BrowserScreenshotAnnotation";
import { BrowserNewTabScreen } from "./BrowserNewTabScreen";
import { BrowserCookieImportWizard } from "./BrowserCookieImportWizard";
import {
  registerBrowserView,
  type BrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  isLoopbackHostname,
  isLocalOnlyUrl,
} from "@/lib/loopback-hostname";
import { PluginBrowserActions } from "@/components/plugin/PluginBrowserActions";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { parseBrowserCookieImport } from "@/lib/browser-cookie-import";
import {
  BROWSER_ELEMENT_ANNOTATION_INTENTS,
  browserCancelElementPickerSource,
  browserElementAnnotationAgentText,
  browserElementAnnotationsAgentText,
  browserElementAnnotationCaptureSchema,
  browserElementPickerSource,
  redactBrowserElementAnnotation,
  type BrowserElementAnnotation,
  type BrowserElementAnnotationIntent,
  type BrowserElementAnnotationNote,
} from "@/lib/browser-element-annotation";
import {
  browserControlActivitySnapshot,
  registerBrowserControlTab,
  subscribeBrowserControlActivity,
} from "@/lib/browser-control-client";
import {
  browserCookieImportRecordSnapshot,
  setBrowserCookieImportRecord,
  subscribeBrowserCookieImportRecord,
} from "@/lib/browser-cookie-import-state";
import {
  browserAnnotationSnapshot,
  clearBrowserAnnotationRecord,
  createEmptyBrowserScreenshotEditor,
  markBrowserAnnotationEpoch,
  setBrowserAnnotationElements,
  setBrowserAnnotationScreenshot,
  subscribeBrowserAnnotationStore,
  type BrowserAnnotationKey,
  type BrowserElementReviewDraft,
  type BrowserScreenshotEditorSnapshot,
} from "./browserAnnotationState";

interface BrowserTabContentProps {
  tabId: string;
  initialUrl: string;
  addressFocusRequest: BrowserAddressFocusRequest | null;
  onAddressFocusRequestConsumed?: (request: BrowserAddressFocusRequest) => void;
  onSelectionAddToChat?: (text: string) => void;
  canShowNativeBrowserView: boolean;
  canHandleBrowserCommands?: boolean;
  onNativeFocus?: () => void;
  onControlOpenTab?: (url: string) => Promise<BrowserTabTarget>;
  onControlCloseTab?: () => void;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  environmentId: string | null;
  threadId: string;
  projectId: string | null;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
}

export interface BrowserAddressFocusRequest {
  requestId: number;
  tabId: string;
}

interface BrowserChromeProps {
  addressDraft: string;
  isEditing: boolean;
  state: BbDesktopBrowserState | null;
  currentUrl: string;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onOpenExternal: () => void;
  locationShortcut: AppShortcutPresentation | null;
  reloadShortcut: AppShortcutPresentation | null;
  navigationControlsRef: RefObject<HTMLDivElement | null>;
  annotationAction: ReactNode;
  pluginActions: ReactNode;
}

interface NavButtonProps {
  icon:
    | "ChevronLeft"
    | "ChevronRight"
    | "RotateCcw"
    | "X"
    | "ExternalLink"
    | "Eye"
    | "EditFile"
    | "File"
    | "MessageSquarePlus";
  label: string;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: AppShortcutPresentation | null;
}

interface BrowserViewBoundsFromElementArgs {
  element: HTMLElement;
}

interface BrowserViewBoundsEqualArgs {
  a: BbDesktopBrowserViewBounds;
  b: BbDesktopBrowserViewBounds;
}

interface SyncBrowserViewPlacementArgs {
  force: boolean;
}

interface BrowserViewAttachIdentity {
  environmentId: string | null;
  tabId: string;
  threadId: string;
}

interface BrowserPageLoadErrorProps {
  errorText: string;
  onOpenExternal: () => void;
  onRetry: () => void;
  url: string;
  onTrustLocalhostCertificate: () => void;
}

const EMPTY_BROWSER_VIEW_BOUNDS: BbDesktopBrowserViewBounds = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};
const TOAST_SNAPSHOT_RELEASE_DELAY_MS = 250;

function roundedBoundsFromRect(rect: DOMRect): BbDesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function browserViewportBounds(): BbDesktopBrowserViewportBounds {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function browserViewBoundsFromElement(
  args: BrowserViewBoundsFromElementArgs,
): BbDesktopBrowserViewBounds {
  return clampBbDesktopBrowserViewBounds({
    bounds: roundedBoundsFromRect(args.element.getBoundingClientRect()),
    viewport: browserViewportBounds(),
  });
}

function browserViewBoundsEqual(args: BrowserViewBoundsEqualArgs): boolean {
  return (
    args.a.x === args.b.x &&
    args.a.y === args.b.y &&
    args.a.width === args.b.width &&
    args.a.height === args.b.height
  );
}

function browserPageLoadErrorTitle(args: {
  errorText: string;
  url: string;
}): string {
  if (args.errorText.includes("ERR_CERT_")) {
    return "Certificate not trusted";
  }
  if (isLocalOnlyUrl(args.url)) {
    return "Server not reachable";
  }
  if (args.errorText.includes("ERR_BLOCKED_BY_CLIENT")) {
    return "Page blocked";
  }
  return "Page unavailable";
}

function canTrustLocalhostCertificate(args: {
  errorText: string;
  url: string;
}): boolean {
  if (!args.errorText.includes("ERR_CERT_")) return false;
  try {
    const parsed = new URL(args.url);
    return (
      parsed.protocol === "https:" && isLoopbackHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}


function browserElementPickerTheme() {
  const styles = getComputedStyle(document.documentElement);
  const outlineColor =
    styles.getPropertyValue("--ring").trim() ||
    styles.getPropertyValue("--foreground").trim();
  return {
    fillColor: `color-mix(in oklab, ${outlineColor} 14%, transparent)`,
    outlineColor,
  };
}

function NavButton({
  icon,
  label,
  disabled,
  onClick,
  shortcut,
}: NavButtonProps) {
  const accessibleLabel = shortcut ? `${label} (${shortcut.label})` : label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={accessibleLabel}
            aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
            className={cn(
              "flex shrink-0 items-center justify-center transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
              COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
              CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
            )}
          >
            <Icon name={icon} aria-hidden />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{accessibleLabel}</TooltipContent>
    </Tooltip>
  );
}

function BrowserChrome({
  addressDraft,
  isEditing,
  state,
  currentUrl,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onSubmit,
  onBack,
  onForward,
  onReloadOrStop,
  onOpenExternal,
  locationShortcut,
  reloadShortcut,
  navigationControlsRef,
  annotationAction,
  pluginActions,
}: BrowserChromeProps) {
  const isLoading = state?.isLoading ?? false;
  const security = getBrowserUrlSecurity(currentUrl);
  const addressValue = isEditing ? addressDraft : currentUrl;
  return (
    <div
      data-testid="browser-tab-nav-bar"
      data-state="expanded"
      role="region"
      aria-label="Browser navigation"
      tabIndex={-1}
      className={cn(
        "relative h-11 shrink-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring max-md:pointer-coarse:h-[52px]",
        SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
      )}
    >
      <div
        ref={navigationControlsRef}
        data-testid="browser-tab-nav-controls"
        className={cn(
          "absolute inset-x-0 top-0 flex h-11 translate-y-0 items-center gap-1 px-2 py-1.5 opacity-100 max-md:pointer-coarse:h-[52px]",
        )}
      >
        <NavButton
          icon="ChevronLeft"
          label="Go back"
          disabled={!(state?.canGoBack ?? false)}
          onClick={onBack}
        />
        <NavButton
          icon="ChevronRight"
          label="Go forward"
          disabled={!(state?.canGoForward ?? false)}
          onClick={onForward}
        />
        <NavButton
          icon={isLoading ? "X" : "RotateCcw"}
          label={isLoading ? "Stop loading" : "Reload"}
          shortcut={isLoading ? null : reloadShortcut}
          onClick={onReloadOrStop}
        />
        <form onSubmit={onSubmit} className="min-w-0 flex-1">
          <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 max-md:pointer-coarse:h-10">
            {security === "secure" ? (
              <Icon
                name="Lock"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-success",
                )}
                aria-label="Secure connection"
              />
            ) : security === "insecure" ? (
              <Icon
                name="AlertTriangle"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-warning",
                )}
                aria-label="Connection not secure"
              />
            ) : (
              <Icon
                name="Search"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-muted-foreground",
                )}
                aria-hidden
              />
            )}
            <input
              ref={addressInputRef}
              type="text"
              value={addressValue}
              onChange={(event) => onAddressChange(event.target.value)}
              onFocus={onAddressFocus}
              onBlur={onAddressBlur}
              placeholder="Enter a URL"
              aria-label={
                locationShortcut
                  ? `Address and search bar (${locationShortcut.label})`
                  : "Address and search bar"
              }
              aria-keyshortcuts={locationShortcut?.ariaKeyshortcuts}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "min-w-0 flex-1 bg-transparent font-mono text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            />
          </div>
        </form>
        <NavButton
          icon="ExternalLink"
          label="Open in external browser"
          disabled={currentUrl.length === 0}
          onClick={onOpenExternal}
        />
        {annotationAction}
        {pluginActions}
        {isLoading ? (
          <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            <span className="block h-full w-1/3 animate-pulse bg-ring/70 motion-reduce:animate-none" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BrowserUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <div className="text-sm font-medium text-foreground">
        Browser tabs need the desktop app
      </div>
      <p
        className={cn(
          "max-w-xs text-muted-foreground",
          COARSE_POINTER_TEXT_SM_CLASS,
        )}
      >
        The in-app web browser runs in the bb desktop app. Open this thread
        there to browse the web.
      </p>
    </div>
  );
}

function BrowserPageLoadError({
  errorText,
  onOpenExternal,
  onRetry,
  onTrustLocalhostCertificate,
  url,
}: BrowserPageLoadErrorProps) {
  const host = getBrowserUrlHost(url);
  const title = browserPageLoadErrorTitle({ errorText, url });
  const canTrustCertificate = canTrustLocalhostCertificate({ errorText, url });
  const message = canTrustCertificate
    ? `The certificate for ${host || "this local server"} is not trusted. Trust it for this Browser session, then retry.`
    : isLocalOnlyUrl(url)
      ? `The browser could not reach ${host || "this local server"}. Start the server, then reload.`
      : "The browser could not load this page. Try reloading or opening it externally.";

  return (
    <div
      data-browser-load-error=""
      className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface-recessed text-muted-foreground">
          <Icon name="Globe" className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p
            className={cn(
              "mt-1 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            {message}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
          >
            <Icon name="RotateCcw" className="size-3.5" aria-hidden />
            Reload
          </button>
          {canTrustCertificate ? (
            <button
              type="button"
              onClick={onTrustLocalhostCertificate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 text-xs font-medium text-warning transition-colors hover:bg-warning/20"
            >
              <Icon name="SecurityCheck" className="size-3.5" aria-hidden />
              Trust and reload
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenExternal}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="ExternalLink" className="size-3.5" aria-hidden />
            Open externally
          </button>
        </div>
        <p className="max-w-full truncate pt-1 font-mono text-[11px] text-subtle-foreground">
          {errorText}
        </p>
      </div>
    </div>
  );
}
interface BrowserElementAnnotationReviewProps {
  annotation: BrowserElementAnnotation;
  dialogLabel: string;
  screenshotUrl: string | null;
  comment: string;
  intent: BrowserElementAnnotationIntent;
  onCommentChange: (comment: string) => void;
  onIntentChange: (intent: BrowserElementAnnotationIntent) => void;
  submitLabel: string;
  onSubmit: (comment: string, intent: BrowserElementAnnotationIntent) => void;
  onClose: () => void;
}

interface BrowserElementAnnotationTrayProps {
  annotations: readonly BrowserElementAnnotationNote[];
  onAddToChat?: (text: string) => void;
  onClear: () => void;
  onCopy: (text: string) => void;
  onEdit: (note: BrowserElementAnnotationNote) => void;
  onRemove: (noteId: string) => void;
  onMove: (noteId: string, direction: "up" | "down") => void;
  onSelectElement: () => void;
  tabId: string;
}

interface CropBrowserElementScreenshotArgs {
  annotation: BrowserElementAnnotation;
  capture: BbDesktopBrowserPageCaptureResult;
}

async function preloadBrowserSnapshot(dataUrl: string): Promise<void> {
  if (typeof Image === "undefined") return;
  const image = new Image();
  image.src = dataUrl;
  if (typeof image.decode === "function") await image.decode();
}

async function cropBrowserElementScreenshot({
  annotation,
  capture,
}: CropBrowserElementScreenshotArgs): Promise<string | null> {
  const image = new Image();
  image.src = capture.dataUrl;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const scaleX = image.naturalWidth / annotation.viewport.width;
  const scaleY = image.naturalHeight / annotation.viewport.height;
  const sourceX = Math.max(0, Math.floor(annotation.rect.x * scaleX));
  const sourceY = Math.max(0, Math.floor(annotation.rect.y * scaleY));
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.max(1, Math.ceil(annotation.rect.width * scaleX)),
  );
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.max(1, Math.ceil(annotation.rect.height * scaleY)),
  );
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.82);
}

function BrowserElementAnnotationReview({
  annotation,
  dialogLabel,
  screenshotUrl,
  comment,
  intent,
  onCommentChange,
  onIntentChange,
  submitLabel,
  onSubmit,
  onClose,
}: BrowserElementAnnotationReviewProps) {
  const canSubmit = comment.trim().length > 0;
  const cardWidth = 352;
  const inset = 12;
  const targetCenterX = annotation.rect.x + annotation.rect.width / 2;
  const left = Math.min(
    Math.max(inset, targetCenterX - cardWidth / 2),
    Math.max(inset, annotation.viewport.width - cardWidth - inset),
  );
  const belowTop = annotation.rect.y + annotation.rect.height + 10;
  const top =
    belowTop + 400 <= annotation.viewport.height - inset
      ? belowTop
      : Math.max(inset, annotation.rect.y - 410);
  return (
    <aside
      role="dialog"
      aria-label={dialogLabel}
      style={{ left, top }}
      className="absolute z-30 w-[min(22rem,calc(100%-1.5rem))]"
    >
      <div className="rounded-xl border border-border bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">{dialogLabel}</p>
          <button
            type="button"
            aria-label="Close page annotation"
            onClick={onClose}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="X" className="size-3.5" aria-hidden />
          </button>
        </div>
        {screenshotUrl === null ? null : (
          <img
            src={screenshotUrl}
            alt="Selected page element"
            className="mb-3 max-h-28 w-full rounded-md border border-border bg-surface-recessed object-contain"
          />
        )}
        <div className="mb-3 rounded-md border border-border bg-surface-recessed px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            Selected object
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {(annotation.accessibility.name ?? annotation.text) ||
              annotation.dom.tag}
          </p>
          <code className="mt-1 block truncate text-xs text-muted-foreground">
            {annotation.dom.selector}
          </code>
        </div>
        <label className="sr-only" htmlFor="browser-annotation-feedback">
          Feedback
        </label>
        <textarea
          id="browser-annotation-feedback"
          value={comment}
          maxLength={2_000}
          autoFocus
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Describe what the agent should change here..."
          className="h-28 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div
          className="mt-2 grid grid-cols-2 gap-2"
          role="group"
          aria-label="Annotation intent"
        >
          {BROWSER_ELEMENT_ANNOTATION_INTENTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={intent === option}
              onClick={() => onIntentChange(option)}
              className={cn(
                "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
                intent === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-state-hover",
              )}
            >
              {option === "fix"
                ? "Fix"
                : option === "change"
                  ? "Change"
                  : option === "question"
                    ? "Question"
                    : "Approve"}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              const trimmedComment = comment.trim();
              if (!canSubmit) return;
              onSubmit(trimmedComment, intent);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
            {submitLabel}
          </button>
        </div>
      </div>
    </aside>
  );
}

function BrowserElementAnnotationTray({
  annotations,
  onAddToChat,
  onClear,
  onCopy,
  onEdit,
  onRemove,
  onMove,
  onSelectElement,
  tabId,
}: BrowserElementAnnotationTrayProps) {
  const agentText = browserElementAnnotationsAgentText(annotations, tabId);
  return (
    <aside
      aria-label="Page annotations"
      className="absolute bottom-3 right-3 z-30 flex max-h-[55%] w-[min(24rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl bg-popover/95 text-popover-foreground shadow-xl backdrop-blur"
    >
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Page annotations</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Use the arrows to set the order sent to the prompt.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}
          </span>
          <button
            type="button"
            aria-label="Clear page annotations"
            onClick={onClear}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="Clean" className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {annotations.map((note, index) => (
          <li
            key={note.id}
            className="rounded-lg border border-border bg-background px-3 py-2.5 text-xs shadow-sm"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {(note.annotation.accessibility.name ?? note.annotation.text) ||
                      note.annotation.dom.tag}
                  </p>
                  <span className="rounded-full bg-surface-recessed px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {note.intent}
                  </span>
                </div>
                <code className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {note.annotation.dom.selector}
                </code>
                <p className="mt-1.5 whitespace-pre-wrap leading-5 text-foreground">
                  {note.comment}
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-0.5">
                <button
                  type="button"
                  aria-label={`Move annotation ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onMove(note.id, "up")}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <Icon name="ArrowUp" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Move annotation ${index + 1} down`}
                  disabled={index === annotations.length - 1}
                  onClick={() => onMove(note.id, "down")}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                >
                  <Icon name="ArrowDown" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Edit annotation ${index + 1}`}
                  onClick={() => onEdit(note)}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
                >
                  <Icon name="EditFile" className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Remove annotation ${index + 1}`}
                  onClick={() => onRemove(note.id)}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
                >
                  <Icon name="X" className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <footer className="flex flex-wrap justify-end gap-1.5 border-t border-border bg-popover/85 px-3 py-2">
        <button
          type="button"
          onClick={onSelectElement}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
        >
          <Icon name="MessageSquarePlus" className="size-3.5" aria-hidden />
          Add annotation
        </button>
        <button
          type="button"
          disabled={agentText === null}
          onClick={() => {
            if (agentText === null) return;
            onCopy(agentText);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="Copy" className="size-3.5" aria-hidden />
          Copy
        </button>
        {onAddToChat === undefined ? null : (
          <button
            type="button"
            disabled={agentText === null}
            onClick={() => {
              if (agentText === null) return;
              onAddToChat(agentText);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="Sent" className="size-3.5" aria-hidden />
            Add to chat
          </button>
        )}
      </footer>
    </aside>
  );
}

export function BrowserTabContent({
  tabId,
  initialUrl,
  addressFocusRequest,
  onAddressFocusRequestConsumed,
  onSelectionAddToChat,
  canShowNativeBrowserView,
  canHandleBrowserCommands = canShowNativeBrowserView,
  onNativeFocus,
  onControlOpenTab,
  onControlCloseTab,
  visibilityCoordinator,
  environmentId,
  threadId,
  projectId,
  onUpdate,
}: BrowserTabContentProps) {
  const locationShortcut = useAppCommandShortcut("browser.focusLocation");
  const reloadShortcut = useAppCommandShortcut("browser.reload");
  const findShortcut = useAppCommandShortcut("browser.find");
  const desktopBrowser = useMemo<BbDesktopBrowserApi | null>(
    () => getDesktopBrowserApi(),
    [],
  );
  const browserViewportRef = useRef<HTMLDivElement>(null);
  const navigationControlsRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const isPointerCoarse = usePointerCoarse();
  const {
    entries: recent,
    recordVisit,
    clear: clearRecent,
  } = useBrowserHistory(threadId);

  const [state, setState] = useState<BbDesktopBrowserState | null>(null);
  const [cookieImportSources, setCookieImportSources] = useState<
    readonly BbDesktopBrowserCookieImportSource[] | null
  >(null);
  const [isLoadingCookieImportSources, setIsLoadingCookieImportSources] =
    useState(false);
  const activeAgentRequestCount = useSyncExternalStore(
    subscribeBrowserControlActivity,
    () => browserControlActivitySnapshot(tabId),
    () => 0,
  );
  const resolvedInitialUrl =
    initialUrl.length === 0 ? "https://www.google.com/" : initialUrl;
  const [currentUrl, setCurrentUrl] = useState(resolvedInitialUrl);
  const [addressDraft, setAddressDraft] = useState(resolvedInitialUrl);
  const [isEditing, setIsEditing] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const isFindOpenRef = useRef(false);
  isFindOpenRef.current = isFindOpen;
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<BrowserFindMatches | null>(
    null,
  );
  const [browserChromeWidth, setBrowserChromeWidth] = useState<number | null>(
    null,
  );
  const [pluginOverlayLeases, setPluginOverlayLeases] = useState<
    ReadonlySet<symbol>
  >(() => new Set());
  const [pluginOverlayRoot, setPluginOverlayRoot] =
    useState<HTMLDivElement | null>(null);
  // Bitmap stand-in pushed by the desktop main process while the native view
  // is hidden during a native window resize; null outside resize bursts.
  const [resizeSnapshotUrl, setResizeSnapshotUrl] = useState<string | null>(
    null,
  );
  const { toasts: appToasts } = useSonner();
  const [isToastSnapshotActive, setIsToastSnapshotActive] = useState(
    appToasts.length > 0,
  );
  const [toastSnapshotUrl, setToastSnapshotUrl] = useState<string | null>(null);
  useEffect(() => {
    if (appToasts.length > 0) {
      setIsToastSnapshotActive(true);
      return;
    }
    const timeout = window.setTimeout(
      () => setIsToastSnapshotActive(false),
      TOAST_SNAPSHOT_RELEASE_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [appToasts.length]);
  const annotationKey = useMemo<BrowserAnnotationKey>(
    () => ({ environmentId, threadId, tabId }),
    [environmentId, threadId, tabId],
  );
  const annotationRecord = useSyncExternalStore(
    subscribeBrowserAnnotationStore,
    () => browserAnnotationSnapshot(annotationKey),
    () => null,
  );
  const annotationRecordRef = useRef(annotationRecord);
  annotationRecordRef.current = annotationRecord;
  const isAnnotationTargetCurrent =
    state !== null &&
    annotationRecord !== null &&
    state.tabId === tabId &&
    state.navigationEpoch === annotationRecord.navigationEpoch;
  const screenshotAnnotationUrl = isAnnotationTargetCurrent
    ? (annotationRecord?.screenshot?.screenshotUrl ?? null)
    : null;
  const elementAnnotationPageSnapshotUrl = isAnnotationTargetCurrent
    ? (annotationRecord?.elements?.pageSnapshotUrl ?? null)
    : null;
  const elementAnnotations: readonly BrowserElementAnnotationNote[] =
    isAnnotationTargetCurrent ? (annotationRecord?.elements?.notes ?? []) : [];
  const activeReviewDraft: BrowserElementReviewDraft | null =
    isAnnotationTargetCurrent
      ? (annotationRecord?.elements?.review ?? null)
      : null;
  const pendingElementAnnotation =
    activeReviewDraft?.kind === "new" ? activeReviewDraft.annotation : null;
  const editingElementAnnotation =
    activeReviewDraft?.kind === "edit"
      ? (elementAnnotations.find(
          (annotation) => annotation.id === activeReviewDraft.noteId,
        ) ?? null)
      : null;
  const [activeElementPickerMode, setActiveElementPickerMode] = useState<
    "annotate" | "grab" | null
  >(null);
  const [isResumingElementPicker, setIsResumingElementPicker] = useState(false);
  const elementPickerControllerRef = useRef<AbortController | null>(null);
  const elementPickerEpochRef = useRef<number | null>(null);
  const cookieImportInputRef = useRef<HTMLInputElement | null>(null);
  const [cookieImportMessage, setCookieImportMessage] = useState<string | null>(
    null,
  );
  const [cookieImportMessageTone, setCookieImportMessageTone] = useState<
    "error" | "success" | null
  >(null);
  const [isImportingCookies, setIsImportingCookies] = useState(false);
  const [isCookieImportWizardOpen, setIsCookieImportWizardOpen] =
    useState(false);
  const [isClearingImportedCookies, setIsClearingImportedCookies] =
    useState(false);
  const currentCookieImport = useSyncExternalStore(
    subscribeBrowserCookieImportRecord,
    browserCookieImportRecordSnapshot,
    () => null,
  );

  const onUpdateRef = useRef(onUpdate);
  const recordVisitRef = useRef(recordVisit);
  onUpdateRef.current = onUpdate;
  recordVisitRef.current = recordVisit;
  const initialUrlRef = useRef(resolvedInitialUrl);
  const [attachedBrowserViewIdentity, setAttachedBrowserViewIdentity] =
    useState<BrowserViewAttachIdentity | null>(null);
  const isBrowserViewAttached =
    attachedBrowserViewIdentity !== null &&
    attachedBrowserViewIdentity.environmentId === environmentId &&
    attachedBrowserViewIdentity.tabId === tabId &&
    attachedBrowserViewIdentity.threadId === threadId;
  const hasPage = currentUrl.length > 0;
  const isInitialNavigationPending =
    initialUrlRef.current.length > 0 &&
    (state === null ||
      state.isLoading ||
      state.url.length === 0 ||
      state.url === "about:blank");
  const supportsNativePaneFocus =
    desktopBrowser?.focus !== undefined &&
    desktopBrowser.onFocus !== undefined &&
    desktopBrowser.setVisibleWithoutFocus !== undefined;
  const browserControlRegistrationRef = useRef<ReturnType<
    typeof registerBrowserControlTab
  > | null>(null);
  const browserControlSnapshotRef = useRef({
    active: canShowNativeBrowserView,
    state,
    url: currentUrl,
  });

  useLayoutEffect(() => {
    browserControlSnapshotRef.current = {
      active: canShowNativeBrowserView,
      state,
      url: currentUrl,
    };
  }, [canShowNativeBrowserView, currentUrl, state]);

  useEffect(() => {
    if (desktopBrowser === null || !isBrowserViewAttached || !hasPage) return;
    const snapshot = browserControlSnapshotRef.current;
    const registration = registerBrowserControlTab({
      active: snapshot.active,
      desktopBrowser,
      tabId,
      threadId,
      projectId,
      state: snapshot.state,
      url: snapshot.url,
      openTab: onControlOpenTab,
      closeTab: onControlCloseTab,
    });
    browserControlRegistrationRef.current = registration;
    return () => {
      if (browserControlRegistrationRef.current === registration) {
        browserControlRegistrationRef.current = null;
      }
      registration.dispose();
    };
  }, [
    desktopBrowser,
    hasPage,
    isBrowserViewAttached,
    onControlCloseTab,
    onControlOpenTab,
    projectId,
    tabId,
    threadId,
  ]);

  useEffect(() => {
    browserControlRegistrationRef.current?.update({
      active: canShowNativeBrowserView,
      state,
      url: currentUrl,
    });
  }, [canShowNativeBrowserView, currentUrl, state]);
  const runElementPickerCleanup = useCallback(() => {
    const expectedNavigationEpoch =
      elementPickerEpochRef.current ?? state?.navigationEpoch;
    const runPageScript = desktopBrowser?.experimental_runBrowserPageScript;
    if (runPageScript === undefined || expectedNavigationEpoch === undefined) {
      return;
    }
    void runPageScript(
      {
        expectedNavigationEpoch,
        input: {},
        requestId: `cancel-element-picker-${crypto.randomUUID()}`,
        source: browserCancelElementPickerSource,
        tabId,
        timeoutMs: 5_000,
        world: "isolated",
      },
      {},
    ).catch(() => {});
  }, [desktopBrowser, state?.navigationEpoch, tabId]);

  const cancelElementPicker = useCallback(() => {
    runElementPickerCleanup();
    elementPickerControllerRef.current?.abort();
    elementPickerControllerRef.current = null;
    setActiveElementPickerMode(null);
  }, [runElementPickerCleanup]);

  const closeElementAnnotation = useCallback(() => {
    const record = annotationRecordRef.current;
    if (record === null || record === undefined) return;
    const elements = record.elements;
    if (elements === null || elements.review === null) return;
    setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
      ...elements,
      review: null,
    });
  }, [annotationKey]);

  const addElementAnnotation = useCallback(
    (comment: string, intent: BrowserElementAnnotationIntent) => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined) return;
      const elements = record.elements;
      if (elements === null) return;
      const draft = elements.review;
      if (draft === null || draft.kind !== "new") {
        return;
      }
      const note: BrowserElementAnnotationNote = {
        annotation: draft.annotation,
        comment,
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID(),
        pageId: tabId,
        intent,
        screenshotUrl: draft.screenshotUrl,
        priority: "important",
      };
      setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
        pageSnapshotUrl: elements.pageSnapshotUrl,
        notes: [...elements.notes, note],
        review: null,
      });
      runElementPickerCleanup();
    },
    [annotationKey, runElementPickerCleanup, tabId],
  );

  const updateElementReviewDraft = useCallback(
    (draft: BrowserElementReviewDraft) => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined) return;
      const elements = record.elements;
      if (elements === null) return;
      setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
        ...elements,
        review: draft,
      });
    },
    [annotationKey],
  );

  const updateElementAnnotation = useCallback(
    (comment: string, intent: BrowserElementAnnotationIntent) => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined) return;
      const elements = record.elements;
      if (elements === null) return;
      const draft = elements.review;
      if (draft === null || draft.kind !== "edit") {
        return;
      }
      setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
        ...elements,
        notes: elements.notes.map((annotation) =>
          annotation.id === draft.noteId
            ? { ...annotation, comment, intent }
            : annotation,
        ),
        review: null,
      });
    },
    [annotationKey],
  );

  const moveElementAnnotation = useCallback(
    (noteId: string, direction: "up" | "down") => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined || record.elements === null) return;
      const sourceIndex = record.elements.notes.findIndex((note) => note.id === noteId);
      const targetIndex = sourceIndex + (direction === "up" ? -1 : 1);
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= record.elements.notes.length) {
        return;
      }
      const notes = [...record.elements.notes];
      [notes[sourceIndex], notes[targetIndex]] = [notes[targetIndex], notes[sourceIndex]];
      setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
        ...record.elements,
        notes,
      });
    },
    [annotationKey],
  );

  const clearElementAnnotations = useCallback(() => {
    const record = annotationRecordRef.current;
    if (record === null || record === undefined || record.elements === null) {
      return;
    }
    setBrowserAnnotationElements(annotationKey, record.navigationEpoch, null);
  }, [annotationKey]);

  const editElementAnnotation = useCallback(
    (note: BrowserElementAnnotationNote) => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined) return;
      const elements = record.elements;
      if (elements === null) return;
      setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
        ...elements,
        review: {
          comment: note.comment,
          intent: note.intent,
          kind: "edit",
          noteId: note.id,
        },
      });
    },
    [annotationKey],
  );

  const removeElementAnnotation = useCallback(
    (id: string) => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined) return;
      const elements = record.elements;
      if (elements === null) return;
      const notes = elements.notes.filter((annotation) => annotation.id !== id);
      setBrowserAnnotationElements(annotationKey, record.navigationEpoch, {
        pageSnapshotUrl: notes.length > 0 ? elements.pageSnapshotUrl : null,
        notes,
        review:
          elements.review?.kind === "edit" && elements.review.noteId === id
            ? null
            : elements.review,
      });
    },
    [annotationKey],
  );

  const closeScreenshotAnnotation = useCallback(() => {
    const record = annotationRecordRef.current;
    if (record === null || record === undefined || record.screenshot === null) {
      return;
    }
    setBrowserAnnotationScreenshot(annotationKey, record.navigationEpoch, null);
  }, [annotationKey]);

  const publishScreenshotEditor = useCallback(
    (editor: BrowserScreenshotEditorSnapshot) => {
      const record = annotationRecordRef.current;
      if (record === null || record === undefined || record.screenshot === null) {
        return;
      }
      setBrowserAnnotationScreenshot(annotationKey, record.navigationEpoch, {
        ...record.screenshot,
        editor,
      });
    },
    [annotationKey],
  );

  const annotationTargetRef = useRef<{ epoch: number | null; url: string | null }>(
    { epoch: null, url: null },
  );
  useEffect(() => {
    const epoch = state?.navigationEpoch;
    if (epoch === undefined) return;
    const previous = annotationTargetRef.current;
    const firstObservation = previous.epoch === null;
    const epochChanged = previous.epoch !== epoch;
    const urlChanged = previous.url !== null && previous.url !== currentUrl;
    annotationTargetRef.current = { epoch, url: currentUrl };
    if (firstObservation) {
      markBrowserAnnotationEpoch(annotationKey, epoch);
      const stored = annotationRecordRef.current;
      if (stored !== null && stored.navigationEpoch !== epoch) {
        clearBrowserAnnotationRecord(annotationKey);
      }
      return;
    }
    if (!epochChanged && !urlChanged) return;
    if (epochChanged) {
      markBrowserAnnotationEpoch(annotationKey, epoch);
    }
    clearBrowserAnnotationRecord(annotationKey);
    cancelElementPicker();
    setIsResumingElementPicker(false);
  }, [annotationKey, cancelElementPicker, currentUrl, state?.navigationEpoch]);

  useEffect(
    () => () => {
      const controller = elementPickerControllerRef.current;
      elementPickerControllerRef.current = null;
      controller?.abort();
      const epoch = elementPickerEpochRef.current;
      const runPageScript = desktopBrowser?.experimental_runBrowserPageScript;
      if (epoch !== null && runPageScript !== undefined) {
        void runPageScript(
          {
            expectedNavigationEpoch: epoch,
            input: {},
            requestId: `cancel-element-picker-${crypto.randomUUID()}`,
            source: browserCancelElementPickerSource,
            tabId,
            timeoutMs: 5_000,
            world: "isolated",
          },
          {},
        ).catch(() => {});
      }
    },
    [desktopBrowser, tabId],
  );
  const pageLoadErrorText = state?.errorText ?? null;
  const hasPageLoadError = pageLoadErrorText !== null && hasPage;
  const isBrowserDimmingModalOpen = useIsBrowserDimmingModalOpen();
  const lastSentBoundsRef = useRef<BbDesktopBrowserViewBounds | null>(null);
  const handlePluginOverlayLeaseChange = useCallback(
    (owner: symbol, open: boolean) => {
      setPluginOverlayLeases((current) => {
        if (current.has(owner) === open) return current;
        const next = new Set(current);
        if (open) next.add(owner);
        else next.delete(owner);
        return next;
      });
    },
    [],
  );

  useLayoutEffect(() => {
    const element = navigationControlsRef.current;
    if (element === null) return;
    const measure = () => {
      const width = Math.round(element.getBoundingClientRect().width);
      setBrowserChromeWidth(width > 0 ? width : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const readBounds = useCallback(() => {
    const element = browserViewportRef.current;
    if (element === null) {
      return null;
    }
    return browserViewBoundsFromElement({ element });
  }, []);

  const sendBounds = useCallback(
    (bounds: BbDesktopBrowserViewBounds) => {
      if (desktopBrowser === null) {
        return;
      }
      lastSentBoundsRef.current = bounds;
      desktopBrowser.setBounds({ tabId, bounds });
      updateDesktopBrowserViewAperture({ bounds, tabId });
    },
    [desktopBrowser, tabId],
  );

  const syncPlacement = useCallback(
    ({ force }: SyncBrowserViewPlacementArgs) => {
      const bounds = readBounds();
      if (bounds === null) {
        return;
      }
      const lastSentBounds = lastSentBoundsRef.current;
      if (
        !force &&
        lastSentBounds !== null &&
        browserViewBoundsEqual({ a: lastSentBounds, b: bounds })
      ) {
        return;
      }
      sendBounds(bounds);
    },
    [readBounds, sendBounds],
  );

  const syncBounds = useCallback(() => {
    syncPlacement({ force: true });
  }, [syncPlacement]);

  const syncBoundsIfChanged = useCallback(() => {
    syncPlacement({ force: false });
  }, [syncPlacement]);

  const syncInitialBounds = useCallback(() => {
    const bounds = readBounds();
    lastSentBoundsRef.current = bounds;
    return bounds ?? EMPTY_BROWSER_VIEW_BOUNDS;
  }, [readBounds]);

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    const initialBounds = syncInitialBounds();
    const mountUrl = initialUrlRef.current;
    registerBrowserView({ environmentId, tabId, threadId });
    desktopBrowser.attach({
      tabId,
      url: mountUrl,
      bounds: initialBounds,
      visible: false,
    });
    setAttachedBrowserViewIdentity({ environmentId, tabId, threadId });

    let lastSeenState: BbDesktopBrowserState | null = null;
    const unsubscribe = desktopBrowser.onState((nextState) => {
      if (nextState.tabId !== tabId) {
        return;
      }
      if (
        lastSeenState !== null &&
        (lastSeenState.url !== nextState.url ||
          (nextState.isLoading && !lastSeenState.isLoading))
      ) {
        setFindMatches(null);
      }
      lastSeenState = nextState;
      setState(nextState);
      const isInitialBlankState =
        initialUrlRef.current.length > 0 && nextState.url.length === 0;
      if (!isInitialBlankState) {
        setCurrentUrl(nextState.url);
        onUpdateRef.current({
          tabId,
          url: nextState.url,
          title: nextState.title,
        });
      }
      if (
        !isInitialBlankState &&
        !nextState.isLoading &&
        nextState.url.length > 0
      ) {
        recordVisitRef.current({
          url: nextState.url,
          title: nextState.title,
        });
      }
    });

    const unsubscribeSnapshot = desktopBrowser.onSnapshot?.((snapshot) => {
      if (snapshot.tabId !== tabId) {
        return;
      }
      setResizeSnapshotUrl(snapshot.dataUrl);
    });

    const unsubscribeFindResult = desktopBrowser.onFindResult?.((result) => {
      if (result.tabId !== tabId) {
        return;
      }
      setFindMatches({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });

    return () => {
      unsubscribe();
      unsubscribeSnapshot?.();
      unsubscribeFindResult?.();
      if (isFindOpenRef.current) {
        desktopBrowser.stopFindInPage?.({ tabId, action: "clearSelection" });
      }
      visibilityCoordinator?.release(tabId);
    };
  }, [
    desktopBrowser,
    environmentId,
    syncInitialBounds,
    visibilityCoordinator,
    tabId,
    threadId,
  ]);

  useEffect(() => {
    const element = browserViewportRef.current;
    if (element === null || desktopBrowser === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      syncBoundsIfChanged();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }

    window.addEventListener(
      BROWSER_VIEW_BOUNDS_SYNC_EVENT,
      syncBoundsIfChanged,
    );
    window.addEventListener("resize", syncBoundsIfChanged);

    return () => {
      window.removeEventListener(
        BROWSER_VIEW_BOUNDS_SYNC_EVENT,
        syncBoundsIfChanged,
      );
      window.removeEventListener("resize", syncBoundsIfChanged);
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  const isElementAnnotationOverlayOpen =
    activeElementPickerMode === null &&
    !isResumingElementPicker &&
    elementAnnotationPageSnapshotUrl !== null &&
    (pendingElementAnnotation !== null || elementAnnotations.length > 0);
  const isViewVisible =
    canShowNativeBrowserView &&
    (canHandleBrowserCommands || supportsNativePaneFocus) &&
    hasPage &&
    !isInitialNavigationPending &&
    !hasPageLoadError &&
    isBrowserViewAttached &&
    !isBrowserDimmingModalOpen &&
    !isCookieImportWizardOpen &&
    resizeSnapshotUrl === null &&
    screenshotAnnotationUrl === null &&
    !isElementAnnotationOverlayOpen &&
    pluginOverlayLeases.size === 0;
  const isNativeBrowserViewVisible = isViewVisible && toastSnapshotUrl === null;
  useEffect(() => {
    if (!isToastSnapshotActive) {
      setToastSnapshotUrl(null);
      return;
    }
    if (
      toastSnapshotUrl !== null ||
      !isViewVisible ||
      state === null ||
      desktopBrowser?.experimental_captureBrowserPage === undefined
    ) {
      return;
    }
    let cancelled = false;
    void desktopBrowser
      .experimental_captureBrowserPage({
        expectedNavigationEpoch: state.navigationEpoch,
        format: "png",
        quality: 100,
        tabId,
      })
      .then(async (snapshot) => {
        if (snapshot.navigationEpoch !== state.navigationEpoch) return;
        await preloadBrowserSnapshot(snapshot.dataUrl);
        if (!cancelled) setToastSnapshotUrl(snapshot.dataUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    desktopBrowser,
    isToastSnapshotActive,
    isViewVisible,
    state,
    tabId,
    toastSnapshotUrl,
  ]);
  const pointForBrowserInput = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const viewport = browserViewportRef.current;
      if (viewport === null) return null;
      const bounds = viewport.getBoundingClientRect();
      return {
        x: Math.max(0, event.clientX - bounds.left),
        y: Math.max(0, event.clientY - bounds.top),
      };
    },
    [],
  );
  const sendBrowserPointerInput = useCallback(
    (events: BbDesktopBrowserPointerInputEvent[]) => {
      const navigationEpoch = state?.navigationEpoch;
      if (
        desktopBrowser?.experimental_sendBrowserPointerInput === undefined ||
        navigationEpoch === undefined
      ) {
        return;
      }
      void desktopBrowser
        .experimental_sendBrowserPointerInput({
          expectedNavigationEpoch: navigationEpoch,
          events,
          tabId,
        })
        .catch(() => {});
    },
    [desktopBrowser, state, tabId],
  );
  const handleBrowserPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isNativeBrowserViewVisible || event.pointerType !== "mouse") return;
      const point = pointForBrowserInput(event);
      if (point === null) return;
      sendBrowserPointerInput([{ type: "mouseMove", ...point }]);
    },
    [isNativeBrowserViewVisible, pointForBrowserInput, sendBrowserPointerInput],
  );
  const handleBrowserPointerButton = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isNativeBrowserViewVisible) return;
      const point = pointForBrowserInput(event);
      if (point === null) return;
      let button: "left" | "middle" | "right" | null = null;
      if (event.button === 0) button = "left";
      else if (event.button === 1) button = "middle";
      else if (event.button === 2) button = "right";
      if (button === null) return;
      event.preventDefault();
      event.stopPropagation();
      desktopBrowser?.focus?.(tabId);
      sendBrowserPointerInput([
        {
          type: event.type === "pointerdown" ? "mouseDown" : "mouseUp",
          button,
          clickCount: Math.min(2, Math.max(1, event.detail ?? 1)),
          ...point,
        },
      ]);
    },
    [
      desktopBrowser,
      isNativeBrowserViewVisible,
      pointForBrowserInput,
      sendBrowserPointerInput,
      tabId,
    ],
  );
  const handleBrowserWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!isNativeBrowserViewVisible) return;
      const point = pointForBrowserInput(event);
      if (point === null) return;
      event.preventDefault();
      event.stopPropagation();
      sendBrowserPointerInput([
        {
          type: "mouseWheel",
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          ...point,
        },
      ]);
    },
    [isNativeBrowserViewVisible, pointForBrowserInput, sendBrowserPointerInput],
  );
  useLayoutEffect(() => {
    if (visibilityCoordinator === null) return;
    if (isNativeBrowserViewVisible) {
      visibilityCoordinator.show(tabId, syncBounds, {
        focus: canHandleBrowserCommands,
      });
    } else if (hasPageLoadError) {
      visibilityCoordinator.hide(tabId);
    } else {
      visibilityCoordinator.cover(tabId);
    }
  }, [
    canHandleBrowserCommands,
    hasPageLoadError,
    visibilityCoordinator,
    tabId,
    isNativeBrowserViewVisible,
    syncBounds,
  ]);
  useLayoutEffect(
    () => () => {
      visibilityCoordinator?.hide(tabId);
    },
    [visibilityCoordinator, tabId],
  );

  useEffect(() => {
    if (desktopBrowser?.onFocus === undefined || onNativeFocus === undefined) {
      return;
    }
    return desktopBrowser.onFocus((focusedTabId) => {
      if (focusedTabId === tabId) onNativeFocus();
    });
  }, [desktopBrowser, onNativeFocus, tabId]);

  useEffect(() => {
    if (!isNativeBrowserViewVisible || !canHandleBrowserCommands) return;
    desktopBrowser?.focus?.(tabId);
  }, [
    canHandleBrowserCommands,
    desktopBrowser,
    isNativeBrowserViewVisible,
    tabId,
  ]);

  useEffect(() => {
    if (addressFocusRequest === null) {
      return;
    }
    if (addressFocusRequest.tabId !== tabId) {
      return;
    }
    if (isPointerCoarse) {
      onAddressFocusRequestConsumed?.(addressFocusRequest);
      return;
    }

    setAddressDraft(currentUrl);
    setIsEditing(true);
    addressInputRef.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      addressInputRef.current?.focus({ preventScroll: true });
      onAddressFocusRequestConsumed?.(addressFocusRequest);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    addressFocusRequest,
    currentUrl,
    isPointerCoarse,
    onAddressFocusRequestConsumed,
    tabId,
  ]);

  const navigateToInput = useCallback(
    (rawInput: string) => {
      const url = resolveBrowserAddressInput(rawInput);
      if (url === null) {
        return;
      }
      setCurrentUrl(url);
      setIsEditing(false);
      desktopBrowser?.navigate({ tabId, url });
    },
    [desktopBrowser, tabId],
  );

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToInput(addressDraft);
    },
    [addressDraft, navigateToInput],
  );

  const handleAddressFocus = useCallback(() => {
    setAddressDraft(currentUrl);
    setIsEditing(true);
  }, [currentUrl]);

  const handleReloadOrStop = useCallback(() => {
    if (state?.isLoading ?? false) {
      desktopBrowser?.stop(tabId);
      return;
    }
    desktopBrowser?.reload(tabId);
  }, [desktopBrowser, state?.isLoading, tabId]);

  const handleTrustLocalhostCertificate = useCallback(() => {
    desktopBrowser?.experimental_trustLocalhostCertificate?.({ tabId });
  }, [desktopBrowser, tabId]);

  const handleFocusLocation = useCallback((): boolean => {
    if (!canHandleBrowserCommands || desktopBrowser === null) return false;
    setAddressDraft(currentUrl);
    setIsEditing(true);
    addressInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      addressInputRef.current?.focus({ preventScroll: true });
      addressInputRef.current?.select();
    });
    return true;
  }, [canHandleBrowserCommands, currentUrl, desktopBrowser]);

  useAppCommandHandler("browser.focusLocation", handleFocusLocation, 100);

  const canFindInPage =
    canShowNativeBrowserView &&
    desktopBrowser !== null &&
    desktopBrowser.findInPage !== undefined &&
    hasPage;

  const runFind = useCallback(
    (args: Omit<BbDesktopBrowserFindInPageRequest, "tabId">) => {
      desktopBrowser?.findInPage?.({ tabId, ...args });
    },
    [desktopBrowser, tabId],
  );

  const clearFind = useCallback(() => {
    desktopBrowser?.stopFindInPage?.({ tabId, action: "clearSelection" });
    setFindMatches(null);
  }, [desktopBrowser, tabId]);

  const focusFindInput = useCallback(() => {
    findInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true });
      findInputRef.current?.select();
    });
  }, []);

  const handleFindQueryChange = useCallback(
    (rawQuery: string) => {
      const query = rawQuery.slice(0, BB_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH);
      setFindQuery(query);
      if (query.length === 0) {
        clearFind();
        return;
      }
      runFind({ text: query, forward: true, newSession: true });
    },
    [clearFind, runFind],
  );

  const handleFindNext = useCallback(() => {
    if (findQuery.length === 0) return;
    runFind({ text: findQuery, forward: true, newSession: false });
  }, [findQuery, runFind]);

  const handleFindPrevious = useCallback(() => {
    if (findQuery.length === 0) return;
    runFind({ text: findQuery, forward: false, newSession: false });
  }, [findQuery, runFind]);

  const handleCloseFind = useCallback(() => {
    setIsFindOpen(false);
    clearFind();
  }, [clearFind]);

  const handleOpenFind = useCallback((): boolean => {
    if (!canFindInPage) return false;
    setIsFindOpen(true);
    if (findQuery.length > 0) {
      runFind({ text: findQuery, forward: true, newSession: true });
    }
    focusFindInput();
    return true;
  }, [canFindInPage, findQuery, focusFindInput, runFind]);

  useAppCommandHandler("browser.find", handleOpenFind, 100);

  useEffect(() => {
    if (isFindOpen && !canFindInPage) {
      setIsFindOpen(false);
      clearFind();
    }
  }, [canFindInPage, clearFind, isFindOpen]);
  useAppCommandHandler(
    "browser.reload",
    () => {
      if (!canHandleBrowserCommands || desktopBrowser === null || !hasPage) {
        return false;
      }
      desktopBrowser.reload(tabId);
      return true;
    },
    100,
  );

  const handleOpenExternal = useCallback(() => {
    getBbDesktopInfo()?.openExternalUrl(currentUrl);
  }, [currentUrl]);

  const canPickPageElement =
    activeElementPickerMode === null &&
    pendingElementAnnotation === null &&
    isViewVisible &&
    state !== null &&
    desktopBrowser?.experimental_runBrowserPageScript !== undefined;
  const startElementPicker = useCallback(
    async (mode: "annotate" | "grab") => {
      if (
        desktopBrowser?.experimental_runBrowserPageScript === undefined ||
        state === null ||
        state.navigationEpoch === undefined ||
        !isViewVisible ||
        activeElementPickerMode !== null
      ) {
        return;
      }
      const expectedNavigationEpoch = state.navigationEpoch;
      const pickerTheme = browserElementPickerTheme();
      const controller = new AbortController();
      elementPickerControllerRef.current?.abort();
      elementPickerControllerRef.current = controller;
      elementPickerEpochRef.current = expectedNavigationEpoch;
      setActiveElementPickerMode(mode);
      desktopBrowser.focus?.(tabId);
      try {
        const result = await desktopBrowser.experimental_runBrowserPageScript(
          {
            input: pickerTheme,
            requestId: `element-picker-${crypto.randomUUID()}`,
            source: browserElementPickerSource,
            tabId,
            expectedNavigationEpoch,
            timeoutMs: 120_000,
            world: "isolated",
          },
          { signal: controller.signal },
        );
        if (result.navigationEpoch !== expectedNavigationEpoch) {
          return;
        }
        const capture = browserElementAnnotationCaptureSchema.safeParse(
          result.value,
        );
        if (!capture.success) {
          return;
        }
        const annotation = redactBrowserElementAnnotation(capture.data);
        if (annotation === null || controller.signal.aborted) {
          return;
        }
        if (mode === "grab") {
          const text = browserElementAnnotationAgentText(annotation);
          if (text !== null) {
            void copyToClipboardWithToast(text);
          }
          return;
        }
        let screenshotUrl: string | null = null;
        let pageSnapshotUrl: string | null = null;
        if (desktopBrowser.experimental_captureBrowserPage !== undefined) {
          try {
            const screenshot =
              await desktopBrowser.experimental_captureBrowserPage({
                expectedNavigationEpoch: result.navigationEpoch,
                format: "jpeg",
                quality: 82,
                tabId,
              });
            if (
              screenshot.navigationEpoch === result.navigationEpoch &&
              !controller.signal.aborted
            ) {
              screenshotUrl = await cropBrowserElementScreenshot({
                annotation,
                capture: screenshot,
              });
              pageSnapshotUrl = screenshot.dataUrl;
            }
          } catch {}
        }
        if (controller.signal.aborted) return;
        const existingElements = annotationRecordRef.current?.elements;
        setBrowserAnnotationElements(
          annotationKey,
          expectedNavigationEpoch,
          {
            notes: existingElements?.notes ?? [],
            pageSnapshotUrl,
            review: {
              annotation,
              comment: "",
              intent: "change",
              kind: "new",
              screenshotUrl,
            },
          },
        );
      } catch {
      } finally {
        if (elementPickerControllerRef.current === controller) {
          elementPickerControllerRef.current = null;
          setActiveElementPickerMode(null);
        }
      }
    },
    [
      annotationKey,
      desktopBrowser,
      activeElementPickerMode,
      isViewVisible,
      state,
      tabId,
    ],
  );
  useEffect(() => {
    if (!isResumingElementPicker || !isViewVisible) return;
    setIsResumingElementPicker(false);
    void startElementPicker("annotate");
  }, [isResumingElementPicker, isViewVisible, startElementPicker]);
  const canAnnotateScreenshot =
    screenshotAnnotationUrl === null &&
    isViewVisible &&
    state !== null &&
    desktopBrowser?.experimental_captureBrowserPage !== undefined;
  const startScreenshotAnnotation = useCallback(async () => {
    if (
      desktopBrowser?.experimental_captureBrowserPage === undefined ||
      state === null ||
      !isViewVisible
    ) {
      return;
    }
    const expectedNavigationEpoch = state.navigationEpoch;
    try {
      const screenshot = await desktopBrowser.experimental_captureBrowserPage({
        expectedNavigationEpoch,
        format: "png",
        quality: 100,
        tabId,
      });
      if (screenshot.navigationEpoch !== expectedNavigationEpoch) return;
      await preloadBrowserSnapshot(screenshot.dataUrl);
      setBrowserAnnotationScreenshot(annotationKey, expectedNavigationEpoch, {
        editor: createEmptyBrowserScreenshotEditor(),
        screenshotUrl: screenshot.dataUrl,
      });
    } catch {}
  }, [annotationKey, desktopBrowser, isViewVisible, state, tabId]);
  const canImportCookies =
    !isImportingCookies &&
    !isClearingImportedCookies &&
    isViewVisible &&
    desktopBrowser?.experimental_importCookies !== undefined;
  const handleCookieImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.item(0);
      event.currentTarget.value = "";
      if (file === null || file === undefined) return;
      if (desktopBrowser?.experimental_importCookies === undefined) return;
      setCookieImportMessage(null);
      setCookieImportMessageTone(null);
      setIsImportingCookies(true);
      try {
        const source: unknown = JSON.parse(await file.text());
        const cookies: BbDesktopBrowserCookieImport[] =
          parseBrowserCookieImport(source);
        setBrowserCookieImportRecord(null);
        const result = await desktopBrowser.experimental_importCookies({
          tabId,
          cookies,
        });
        setBrowserCookieImportRecord({
          fileName: file.name,
          importedCookies: result.importedCookies,
          kind: "file",
        });
        setCookieImportMessageTone("success");
        setCookieImportMessage(
          `Imported ${result.importedCookies} ${result.importedCookies === 1 ? "cookie" : "cookies"}`,
        );
      } catch (error) {
        setCookieImportMessageTone("error");
        setCookieImportMessage(
          error instanceof Error ? error.message : "Cookie import failed",
        );
      } finally {
        setIsImportingCookies(false);
      }
    },
    [desktopBrowser, tabId],
  );
  const handleOpenCookieImportWizard = useCallback(async () => {
    setCookieImportMessage(null);
    setCookieImportMessageTone(null);
    setCookieImportSources(null);
    setIsCookieImportWizardOpen(true);
    if (desktopBrowser?.experimental_listCookieImportSources === undefined) {
      setCookieImportSources([]);
      return;
    }
    setIsLoadingCookieImportSources(true);
    try {
      const result = await desktopBrowser.experimental_listCookieImportSources({
        tabId,
      });
      setCookieImportSources(result.sources);
    } catch (error) {
      setCookieImportSources([]);
      setCookieImportMessageTone("error");
      setCookieImportMessage(
        error instanceof Error
          ? error.message
          : "Could not find browser profiles",
      );
    } finally {
      setIsLoadingCookieImportSources(false);
    }
  }, [desktopBrowser, tabId]);
  const handleCookieImportFromBrowser = useCallback(
    async (family: string, profileId: string) => {
      if (desktopBrowser?.experimental_importCookiesFromBrowser === undefined) {
        return;
      }
      setCookieImportMessage(null);
      setCookieImportMessageTone(null);
      setIsImportingCookies(true);
      try {
        setBrowserCookieImportRecord(null);
        const result =
          await desktopBrowser.experimental_importCookiesFromBrowser({
            family,
            profileId,
            tabId,
          });
        setCookieImportMessageTone("success");
        const source = cookieImportSources?.find(
          (candidate) => candidate.family === family,
        );
        const profile = source?.profiles.find(
          (candidate) => candidate.id === profileId,
        );
        setBrowserCookieImportRecord({
          family,
          importedCookies: result.importedCookies,
          kind: "browser",
          profileId,
          profileLabel: profile?.label ?? profileId,
          sourceLabel: source?.label ?? family,
        });
        setCookieImportMessage(
          `Imported ${result.importedCookies} ${result.importedCookies === 1 ? "cookie" : "cookies"} from ${source?.label ?? family}`,
        );
      } catch (error) {
        setCookieImportMessageTone("error");
        setCookieImportMessage(
          error instanceof Error
            ? error.message
            : "Browser cookie import failed",
        );
      } finally {
        setIsImportingCookies(false);
      }
    },
    [cookieImportSources, desktopBrowser, tabId],
  );
  const handleClearImportedCookies = useCallback(async () => {
    if (desktopBrowser?.experimental_clearImportedCookies === undefined) return;
    setCookieImportMessage(null);
    setCookieImportMessageTone(null);
    setIsClearingImportedCookies(true);
    try {
      await desktopBrowser.experimental_clearImportedCookies({ tabId });
      setBrowserCookieImportRecord(null);
      setCookieImportMessageTone("success");
      setCookieImportMessage("Cleared imported browser session");
    } catch (error) {
      setCookieImportMessageTone("error");
      setCookieImportMessage(
        error instanceof Error
          ? error.message
          : "Could not clear imported browser session",
      );
    } finally {
      setIsClearingImportedCookies(false);
    }
  }, [desktopBrowser, tabId]);
  if (desktopBrowser === null) {
    return <BrowserUnavailable />;
  }

  return (
    <div data-app-browser className="flex h-full min-h-0 flex-col">
      <input
        ref={cookieImportInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(event) => {
          void handleCookieImport(event);
        }}
      />
      <BrowserChrome
        addressDraft={addressDraft}
        isEditing={isEditing}
        state={state}
        currentUrl={currentUrl}
        addressInputRef={addressInputRef}
        onAddressChange={setAddressDraft}
        onAddressFocus={handleAddressFocus}
        onAddressBlur={() => setIsEditing(false)}
        onSubmit={handleAddressSubmit}
        onBack={() => {
          desktopBrowser.goBack(tabId);
        }}
        onForward={() => {
          desktopBrowser.goForward(tabId);
        }}
        onReloadOrStop={handleReloadOrStop}
        onOpenExternal={handleOpenExternal}
        locationShortcut={locationShortcut}
        reloadShortcut={reloadShortcut}
        navigationControlsRef={navigationControlsRef}
        annotationAction={
          <>
            <NavButton
              icon="EditFile"
              label="Annotate screenshot"
              disabled={!canAnnotateScreenshot}
              onClick={() => {
                void startScreenshotAnnotation();
              }}
            />
            <NavButton
              icon={activeElementPickerMode === "grab" ? "X" : "Eye"}
              label={
                activeElementPickerMode === "grab"
                  ? "Cancel element selection"
                  : "Grab page element"
              }
              disabled={
                !canPickPageElement && activeElementPickerMode !== "grab"
              }
              onClick={() => {
                if (activeElementPickerMode === "grab") {
                  cancelElementPicker();
                  return;
                }
                void startElementPicker("grab");
              }}
            />
            <NavButton
              icon={
                activeElementPickerMode === "annotate"
                  ? "X"
                  : "MessageSquarePlus"
              }
              label={
                activeElementPickerMode === "annotate"
                  ? "Cancel element annotation"
                  : "Select and annotate page element"
              }
              disabled={
                !canPickPageElement && activeElementPickerMode !== "annotate"
              }
              onClick={() => {
                if (activeElementPickerMode === "annotate") {
                  cancelElementPicker();
                  return;
                }
                void startElementPicker("annotate");
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Import browser session"
              disabled={!canImportCookies}
              onClick={() => {
                void handleOpenCookieImportWizard();
              }}
              className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
            >
              <Icon name="File" aria-hidden />
              Import
            </Button>
          </>
        }
        pluginActions={
          <>
            {activeAgentRequestCount > 0 ? (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-state-hover px-2 text-xs text-muted-foreground"
              >
                <span className="size-1.5 animate-pulse rounded-full bg-info motion-reduce:animate-none" />
                Agent using tab
              </span>
            ) : null}
            <PluginBrowserActions
              key={`${tabId}:${threadId}:${projectId ?? ""}:${currentUrl}`}
              chromeWidth={browserChromeWidth}
              desktopBrowser={desktopBrowser}
              tabId={tabId}
              navigationEpoch={state?.navigationEpoch ?? null}
              threadId={threadId}
              projectId={projectId}
              url={currentUrl}
              overlayRoot={pluginOverlayRoot}
              onOverlayLeaseChange={handlePluginOverlayLeaseChange}
            />
          </>
        }
      />
      {isFindOpen ? (
        <BrowserFindBar
          inputRef={findInputRef}
          query={findQuery}
          matches={findMatches}
          onQueryChange={handleFindQueryChange}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          onClose={handleCloseFind}
          shortcut={findShortcut}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div
          ref={browserViewportRef}
          data-browser-viewport=""
          className="absolute inset-0"
          onPointerDown={handleBrowserPointerButton}
          onPointerMove={handleBrowserPointerMove}
          onPointerUp={handleBrowserPointerButton}
          onContextMenu={(event) => {
            if (!isNativeBrowserViewVisible) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onWheel={handleBrowserWheel}
        />
        <div
          ref={setPluginOverlayRoot}
          data-browser-plugin-overlay-root=""
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
        />
        {isCookieImportWizardOpen ? (
          <BrowserCookieImportWizard
            currentImport={currentCookieImport}
            isImporting={isImportingCookies}
            isClearing={isClearingImportedCookies}
            isLoadingSources={isLoadingCookieImportSources}
            message={cookieImportMessage}
            messageTone={cookieImportMessageTone}
            sources={cookieImportSources}
            onClose={() => setIsCookieImportWizardOpen(false)}
            onClear={() => {
              void handleClearImportedCookies();
            }}
            onImportFromBrowser={(family, profileId) => {
              void handleCookieImportFromBrowser(family, profileId);
            }}
            onImportFromFile={() => cookieImportInputRef.current?.click()}
          />
        ) : null}
        {toastSnapshotUrl === null ? null : (
          <img
            src={toastSnapshotUrl}
            alt=""
            draggable={false}
            data-browser-toast-snapshot=""
            className="pointer-events-none absolute inset-0 size-full"
          />
        )}
        {isElementAnnotationOverlayOpen ? (
          <img
            src={elementAnnotationPageSnapshotUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full"
          />
        ) : null}
        {screenshotAnnotationUrl !== null ? (
          <BrowserScreenshotAnnotation
            screenshotUrl={screenshotAnnotationUrl}
            onClose={closeScreenshotAnnotation}
            initialEditorState={annotationRecord?.screenshot?.editor}
            onEditorStateChange={publishScreenshotEditor}
          />
        ) : activeReviewDraft !== null && activeReviewDraft.kind === "new" ? (
          <BrowserElementAnnotationReview
            key="new-annotation"
            annotation={activeReviewDraft.annotation}
            dialogLabel="Add page annotation"
            screenshotUrl={activeReviewDraft.screenshotUrl}
            comment={activeReviewDraft.comment}
            intent={activeReviewDraft.intent}
            onCommentChange={(comment) =>
              updateElementReviewDraft({ ...activeReviewDraft, comment })
            }
            onIntentChange={(intent) =>
              updateElementReviewDraft({ ...activeReviewDraft, intent })
            }
            submitLabel="Add"
            onSubmit={addElementAnnotation}
            onClose={closeElementAnnotation}
          />
        ) : activeReviewDraft !== null &&
          activeReviewDraft.kind === "edit" &&
          editingElementAnnotation !== null ? (
          <BrowserElementAnnotationReview
            key={`edit-${editingElementAnnotation.id}`}
            annotation={editingElementAnnotation.annotation}
            dialogLabel="Edit page annotation"
            screenshotUrl={editingElementAnnotation.screenshotUrl}
            comment={activeReviewDraft.comment}
            intent={activeReviewDraft.intent}
            onCommentChange={(comment) =>
              updateElementReviewDraft({ ...activeReviewDraft, comment })
            }
            onIntentChange={(intent) =>
              updateElementReviewDraft({ ...activeReviewDraft, intent })
            }
            submitLabel="Save"
            onSubmit={updateElementAnnotation}
            onClose={closeElementAnnotation}
          />
        ) : hasPageLoadError ? (
          <BrowserPageLoadError
            errorText={pageLoadErrorText}
            onOpenExternal={handleOpenExternal}
            onRetry={handleReloadOrStop}
            onTrustLocalhostCertificate={handleTrustLocalhostCertificate}
            url={currentUrl}
          />
        ) : hasPage && !isBrowserDimmingModalOpen ? null : (
          <BrowserNewTabScreen
            onNavigateInput={navigateToInput}
            recent={recent}
            onClearRecent={clearRecent}
          />
        )}
        {screenshotAnnotationUrl === null &&
        pendingElementAnnotation === null &&
        editingElementAnnotation === null &&
        !activeElementPickerMode &&
        !isResumingElementPicker &&
        elementAnnotations.length > 0 ? (
          <BrowserElementAnnotationTray
            annotations={elementAnnotations}
            tabId={tabId}
            onAddToChat={onSelectionAddToChat}
            onClear={() => {
              clearElementAnnotations();
            }}
            onCopy={(text) => {
              void copyToClipboardWithToast(text, {
                successMessage: "Page annotations copied",
                errorMessage: "Failed to copy page annotations",
              });
            }}
            onEdit={(note) => editElementAnnotation(note)}
            onRemove={(id) => removeElementAnnotation(id)}
            onMove={moveElementAnnotation}
            onSelectElement={() => {
              setIsResumingElementPicker(true);
            }}
          />
        ) : null}
        {hasPage && resizeSnapshotUrl !== null ? (
          <img
            src={resizeSnapshotUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full"
          />
        ) : null}
      </div>
    </div>
  );
}
