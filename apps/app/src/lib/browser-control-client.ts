import type {
  BrowserActionabilityPolicy,
  BrowserControlAction,
  BrowserOpenTabRequestMessage,
  BrowserOpenTabResponseMessage,
  BrowserControlRequestMessage,
  BrowserControlResponseMessage,
  BrowserTabDescriptor,
  BrowserTabTarget,
  BrowserFrameTarget,
  JsonValue,
} from "@bb/server-contract";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import {
  BROWSER_CONTROL_MAX_FRAMES,
  isAllowedBrowserNavigationUrl,
  isBrowserTransitionWaitAction,
} from "@bb/domain";
import {
  browserElementAnnotationCaptureSchema,
  redactBrowserElementAnnotation,
} from "./browser-element-annotation";
import { wsManager } from "./ws";
import {
  isDocumentVisible,
  subscribeToDocumentVisibility,
} from "./document-visibility";

interface RegisteredBrowserTab {
  descriptor: BrowserTabDescriptor;
  desktopBrowser: BbDesktopBrowserApi;
  openTab: ((url: string) => Promise<BrowserTabTarget>) | null;
  closeTab: (() => void) | null;
  ready: boolean;
}
interface BrowserControlOwnerTab {
  tabId: string;
  title: string | null;
  url: string;
}

interface RegisteredBrowserOwner {
  activateTab: (tabId: string) => Promise<BrowserTabTarget>;
  closeTab: (tabId: string) => void;
  active: boolean;
  openTab: (url: string) => Promise<BrowserTabTarget>;
  ownerId: string;
  projectId: string | null;
  tabs: readonly BrowserControlOwnerTab[];
  threadId: string | null;
}

interface RegisterBrowserControlTabArgs {
  active: boolean;
  desktopBrowser: BbDesktopBrowserApi;
  projectId: string | null;
  state: BbDesktopBrowserState | null;
  tabId: string;
  threadId: string | null;
  url: string;
  openTab?: (url: string) => Promise<BrowserTabTarget>;
  closeTab?: () => void;
}

interface RegisterBrowserControlOwnerArgs {
  activateTab: (tabId: string) => Promise<BrowserTabTarget>;
  closeTab: (tabId: string) => void;
  active: boolean;
  openTab: (url: string) => Promise<BrowserTabTarget>;
  ownerId: string;
  projectId: string | null;
  tabs: readonly BrowserControlOwnerTab[];
  threadId: string | null;
}
interface BrowserThreadOwnerActivation {
  projectId: string;
  signal: AbortSignal;
  threadId: string;
}

interface BrowserThreadOwnerActivator {
  activate(args: BrowserThreadOwnerActivation): Promise<void>;
}

interface BrowserOwnerRegistrationWaiter {
  projectId: string;
  threadId: string;
  resolve(owner: RegisteredBrowserOwner): void;
  reject(error: Error): void;
  unlinkAbort(): void;
}

export interface BrowserThreadOwnerActivatorRegistration {
  dispose(): void;
}

export interface BrowserControlTabRegistration {
  update(
    args: Pick<RegisterBrowserControlTabArgs, "active" | "state" | "url">,
  ): void;
  dispose(): void;
}

export interface BrowserControlOwnerRegistration {
  dispose(): void;
  updateTabs(tabs: readonly BrowserControlOwnerTab[]): void;
}

const registeredTabs = new Map<string, RegisteredBrowserTab>();
const registeredOwners = new Map<string, RegisteredBrowserOwner>();
const activeRequestCounts = new Map<string, number>();
const activityListeners = new Set<() => void>();
const requestControllers = new Map<string, AbortController>();
const ownerRegistrationWaiters = new Set<BrowserOwnerRegistrationWaiter>();
let threadOwnerActivator: BrowserThreadOwnerActivator | null = null;
const tabRegistrationWaiters = new Map<
  string,
  {
    reject: (reason: Error) => void;
    resolve: (target: BrowserTabTarget) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
interface BrowserTargetWaiter {
  target: BrowserTabTarget;
  resolve: (target: BrowserTabTarget) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const tabTargetWaiters = new Map<string, Set<BrowserTargetWaiter>>();

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
function publicBrowserError(
  error: unknown,
  fallbackCode: string,
): { code: string; message: string } {
  const code = error instanceof Error ? error.name : fallbackCode;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+': Error: /u, "")
    .slice(0, 2_048);
  return { code, message };
}

const clientId = randomId();
const windowId = randomId();
function sendClientState(): void {
  const tabs = new Map<
    string,
    Omit<BrowserTabDescriptor, "clientId" | "windowId">
  >();
  for (const owner of registeredOwners.values()) {
    for (const tab of owner.tabs) {
      tabs.set(tab.tabId, {
        tabId: tab.tabId,
        threadId: owner.threadId,
        projectId: owner.projectId,
        url: tab.url,
        title: tab.title,
        connected: false,
        active: false,
        navigationEpoch: 0,
      });
    }
  }
  for (const { descriptor } of registeredTabs.values()) {
    const {
      clientId: _clientId,
      windowId: _windowId,
      ...clientTab
    } = descriptor;
    tabs.set(descriptor.tabId, clientTab);
  }
  wsManager.sendBrowserClientState({
    type: "browser-client-state",
    clientId,
    windowId,
    active: isDocumentVisible(),
    canActivateThreadOwner: threadOwnerActivator !== null,
    tabs: [...tabs.values()],
    owners: [...registeredOwners.values()].map(
      ({ active, ownerId, projectId, threadId }) => ({
        active,
        ownerId,
        projectId,
        threadId,
      }),
    ),
  });
}

function targetEquals(a: BrowserTabTarget, b: BrowserTabTarget): boolean {
  return (
    a.clientId === b.clientId &&
    a.windowId === b.windowId &&
    a.tabId === b.tabId &&
    a.navigationEpoch === b.navigationEpoch
  );
}

export function waitForBrowserControlTab(
  tabId: string,
): Promise<BrowserTabTarget> {
  const existing = registeredTabs.get(tabId);
  if (existing?.ready === true) {
    return Promise.resolve(targetFor(existing));
  }
  let resolve: ((target: BrowserTabTarget) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<BrowserTabTarget>(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  if (resolve === undefined || reject === undefined) {
    throw new Error("Browser tab registration waiter did not initialize");
  }
  const resolveWaiter = resolve;
  const rejectWaiter = reject;
  const timeout = setTimeout(() => {
    tabRegistrationWaiters.delete(tabId);
    rejectWaiter(
      new Error("The new visible Browser tab did not become available"),
    );
  }, 30_000);
  tabRegistrationWaiters.set(tabId, {
    resolve: resolveWaiter,
    reject: rejectWaiter,
    timeout,
  });
  return promise;
}

function targetFor(tab: RegisteredBrowserTab): BrowserTabTarget {
  return {
    clientId,
    windowId,
    tabId: tab.descriptor.tabId,
    navigationEpoch: tab.descriptor.navigationEpoch,
  };
}
function notifyBrowserTargetWaiters(tabId: string): void {
  const waiters = tabTargetWaiters.get(tabId);
  if (waiters === undefined) return;
  const current = registeredTabs.get(tabId);
  if (current === undefined) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("The Browser tab was detached"));
    }
    tabTargetWaiters.delete(tabId);
    return;
  }
  const observed = targetFor(current);
  for (const waiter of waiters) {
    if (
      observed.clientId !== waiter.target.clientId ||
      observed.windowId !== waiter.target.windowId ||
      observed.tabId !== waiter.target.tabId
    ) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.reject(new Error("The Browser tab target changed"));
    } else if (observed.navigationEpoch === waiter.target.navigationEpoch) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.resolve(observed);
    } else if (observed.navigationEpoch > waiter.target.navigationEpoch) {
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.reject(
        new Error("A second Browser navigation overtook the wait result"),
      );
    }
  }
  if (waiters.size === 0) tabTargetWaiters.delete(tabId);
}

function waitForBrowserTarget(
  target: BrowserTabTarget,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<BrowserTabTarget> {
  const current = registeredTabs.get(target.tabId);
  if (current !== undefined) {
    const observed = targetFor(current);
    if (targetEquals(observed, target)) return Promise.resolve(observed);
    if (
      observed.clientId !== target.clientId ||
      observed.windowId !== target.windowId ||
      observed.navigationEpoch > target.navigationEpoch
    ) {
      return Promise.reject(
        new Error("A second Browser navigation overtook the wait result"),
      );
    }
  }
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Browser wait was cancelled", "AbortError"),
    );
  }
  let resolvePromise!: (target: BrowserTabTarget) => void;
  let rejectPromise!: (reason: Error) => void;
  const promise = new Promise<BrowserTabTarget>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  let settled = false;
  let waiter: BrowserTargetWaiter;
  const waiters = tabTargetWaiters.get(target.tabId) ?? new Set();
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(waiter.timeout);
    signal.removeEventListener("abort", onAbort);
    waiters.delete(waiter);
    if (waiters.size === 0) tabTargetWaiters.delete(target.tabId);
    callback();
  };
  const onAbort = (): void =>
    finish(() =>
      rejectPromise(
        new DOMException("Browser wait was cancelled", "AbortError"),
      ),
    );
  waiter = {
    target,
    resolve: (observed) => finish(() => resolvePromise(observed)),
    reject: (error) => finish(() => rejectPromise(error)),
    timeout: setTimeout(
      () =>
        finish(() =>
          rejectPromise(
            new Error("The Browser tab revision was not published"),
          ),
        ),
      timeoutMs,
    ),
  };
  waiters.add(waiter);
  tabTargetWaiters.set(target.tabId, waiters);
  signal.addEventListener("abort", onAbort, { once: true });
  notifyBrowserTargetWaiters(target.tabId);
  return promise;
}

function ownerForTab(tab: RegisteredBrowserTab): RegisteredBrowserOwner | null {
  const matchingOwners = [...registeredOwners.values()].filter(
    (owner) =>
      owner.threadId === tab.descriptor.threadId &&
      owner.projectId === tab.descriptor.projectId,
  );
  const activeOwners = matchingOwners.filter((owner) => owner.active);
  const candidates = activeOwners.length > 0 ? activeOwners : matchingOwners;
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function setRequestActive(tabId: string, active: boolean): void {
  const current = activeRequestCounts.get(tabId) ?? 0;
  const next = active ? current + 1 : Math.max(0, current - 1);
  if (next === 0) activeRequestCounts.delete(tabId);
  else activeRequestCounts.set(tabId, next);
  for (const listener of activityListeners) listener();
}
function browserFrameForAction(
  action: BrowserControlAction,
): BrowserFrameTarget | undefined {
  const frameForPointerTarget = (
    target: Extract<
      BrowserControlAction,
      {
        kind:
          | "click"
          | "hover"
          | "right-click"
          | "middle-click"
          | "double-click";
      }
    >["target"],
  ): BrowserFrameTarget | undefined =>
    target.target === "locator" ? target.locator.frame : undefined;
  switch (action.kind) {
    case "snapshot":
      return action.frame;
    case "click":
    case "hover":
    case "right-click":
    case "middle-click":
    case "double-click":
      return frameForPointerTarget(action.target);
    case "drag": {
      const from =
        action.from.target === "locator"
          ? action.from.locator.frame
          : undefined;
      const to =
        action.to.target === "locator" ? action.to.locator.frame : undefined;
      const sameFrame =
        from === undefined
          ? to === undefined
          : to !== undefined &&
            from.frameId === to.frameId &&
            from.documentEpoch === to.documentEpoch;
      if (!sameFrame) {
        throw new Error("Browser drag endpoints must use the same frame");
      }
      return from;
    }
    case "type":
    case "select":
    case "select-multiple":
    case "upload":
    case "check":
    case "uncheck":
    case "focus":
    case "scroll-into-view":
    case "screenshot-element":
      return action.locator.frame;
    case "wait":
      return action.criteria.kind === "text"
        ? action.criteria.frame
        : action.criteria.kind === "locator"
          ? action.criteria.locator.frame
          : undefined;
    default:
      return undefined;
  }
}

const resolveLocatorSource = `
  const resolveLocator = (locator) => {
    let root = document;
    if (Array.isArray(locator.selectors)) {
      let element = null;
      for (let index = 0; index < locator.selectors.length; index += 1) {
        const matches = Array.from(root.querySelectorAll(locator.selectors[index]));
        if (matches.length === 0) throw new Error("Browser target was not found");
        if (matches.length > 1) throw new Error("Browser locator matched multiple targets");
        element = matches[0];
        if (!(element instanceof Element)) throw new Error("Browser target was not found");
        if (index < locator.selectors.length - 1) {
          if (!(element.shadowRoot instanceof ShadowRoot)) throw new Error("Browser target shadow root is unavailable");
          root = element.shadowRoot;
        }
      }
      return element;
    }
    const implicitRole = (element) => {
      if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
      if (element instanceof HTMLButtonElement) return "button";
      if (element instanceof HTMLSelectElement) return element.multiple ? "listbox" : "combobox";
      if (element instanceof HTMLTextAreaElement) return "textbox";
      if (element instanceof HTMLInputElement) {
        if (element.type === "checkbox") return "checkbox";
        if (element.type === "radio") return "radio";
        if (["button", "reset", "submit"].includes(element.type)) return "button";
        return "textbox";
      }
      if (/^H[1-6]$/.test(element.tagName)) return "heading";
      if (element instanceof HTMLImageElement) return "img";
      return null;
    };
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => root.getElementById(id)?.textContent || "").join(" ")
        : "";
      return (element.getAttribute("aria-label") || labelledText ||
        (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent || element.value : "") ||
        element.getAttribute("alt") || element.getAttribute("title") || element.textContent || "")
        .replace(/\\s+/g, " ").trim();
    };
    const expectedRole = locator.role.toLowerCase();
    const expectedName = locator.name?.toLocaleLowerCase();
    const matches = Array.from(root.querySelectorAll("*")).filter((candidate) => {
      const role = (candidate.getAttribute("role") || implicitRole(candidate) || "").toLowerCase();
      if (role !== expectedRole) return false;
      return expectedName === undefined || accessibleName(candidate).toLocaleLowerCase() === expectedName;
    });
    if (matches.length === 0) throw new Error("Browser target was not found");
    if (matches.length > 1) throw new Error("Browser accessibility locator matched multiple targets");
    return matches[0];
  };
`;

const actionableTargetSource = `async ({ input, requireEditable }) => { ${resolveLocatorSource}
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const target = input.target?.target === "locator"
    ? resolveLocator(input.target.locator)
    : input.locator
      ? resolveLocator(input.locator)
      : document.elementFromPoint(input.target.x, input.target.y);
  if (!(target instanceof Element)) throw new Error("Browser target is not actionable");
  if (!target.isConnected) throw new Error("Browser target is detached");
  if (target.matches(":disabled,[aria-disabled='true']")) throw new Error("Browser target is disabled");
  if (requireEditable && !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) {
    throw new Error("Browser target is not editable");
  }
  target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
  await nextFrame();
  const stableFrameCount = Math.max(1, Math.min(4, Number(input.stableFrameCount ?? 2)));
  let rect = target.getBoundingClientRect();
  for (let index = 1; index < stableFrameCount; index += 1) {
    await nextFrame();
    const next = target.getBoundingClientRect();
    if (
      rect.x !== next.x ||
      rect.y !== next.y ||
      rect.width !== next.width ||
      rect.height !== next.height
    ) {
      throw new Error("Browser target is moving");
    }
    rect = next;
  }
  const style = getComputedStyle(target);
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    style.pointerEvents === "none"
  ) {
    throw new Error("Browser target is not visible");
  }
  if (requireEditable) {
    target.focus();
    let active = target.ownerDocument.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active !== target) throw new Error("Browser target did not accept focus");
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) throw new Error("Browser target is outside the viewport");
  const hit = document.elementFromPoint(x, y);
  if (!(hit instanceof Element) || (hit !== target && !target.contains(hit))) {
    throw new Error("Browser target is covered");
  }
  return { x, y, tag: target.localName };
}`;

const trustedClickSource = `({ input }) =>
  (${actionableTargetSource})({ input, requireEditable: false })`;

const trustedCheckSource = `async ({ input }) => { ${resolveLocatorSource}
  const point = await (${actionableTargetSource})({ input, requireEditable: false });
  const target = resolveLocator(input.locator);
  if (!(target instanceof HTMLInputElement) || (target.type !== "checkbox" && target.type !== "radio")) {
    throw new Error("Browser target is not a checkbox or radio");
  }
  if (input.kind === "uncheck" && target.type !== "checkbox") {
    throw new Error("Browser target is not a checkbox");
  }
  return {
    ...point,
    inputType: target.type,
    needsClick: input.kind === "check" ? !target.checked : target.checked,
  };
}`;

const trustedTypeSource = `({ input }) =>
  (${actionableTargetSource})({ input, requireEditable: true })`;
const keyTargetSource = `() => {
  let target = document.activeElement;
  while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
  if (!(target instanceof HTMLElement) || target === document.body) {
    throw new Error("Browser keyboard target is not focused");
  }
  if (target.matches(":disabled,[aria-disabled='true']")) {
    throw new Error("Browser keyboard target is disabled");
  }
  const eligible =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement ||
    target.isContentEditable ||
    target.tabIndex >= 0;
  if (!eligible) throw new Error("Browser keyboard target is not eligible");
  return { tag: target.localName };
}`;

const resolvePointerSource = `({ input }) => {
  const resolvePoint = ${actionableTargetSource};
  const targetFor = async (target) => {
    const point = await resolvePoint({ input: { target }, requireEditable: false });
    return {
      x: point.x,
      y: point.y,
      inViewport: point.x >= 0 && point.y >= 0 && point.x <= innerWidth && point.y <= innerHeight,
    };
  };
  return input.kind === "drag"
    ? { from: await targetFor(input.from), to: await targetFor(input.to) }
    : { target: await targetFor(input.target) };
}`;

const resolveElementRectSource = `async ({ input }) => { ${resolveLocatorSource}
  await (${actionableTargetSource})({ input, requireEditable: false });
  const element = resolveLocator(input.locator);
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + scrollX,
    y: rect.top + scrollY,
    width: rect.width,
    height: rect.height,
  };
}`;

function isBrowserPageRect(value: JsonValue): value is JsonValue & {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height)
  );
}

type BrowserPointerCoordinate = {
  x: number;
  y: number;
  inViewport: boolean;
} & JsonValue;

function isBrowserPointerCoordinate(value: JsonValue): value is JsonValue & {
  from?: BrowserPointerCoordinate;
  target?: BrowserPointerCoordinate;
  to?: BrowserPointerCoordinate;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const isCoordinate = (candidate: JsonValue | undefined): boolean =>
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate) &&
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    typeof candidate.inViewport === "boolean";
  return (
    (value.target === undefined || isCoordinate(value.target)) &&
    (value.from === undefined || isCoordinate(value.from)) &&
    (value.to === undefined || isCoordinate(value.to))
  );
}
type BrowserTrustedInputPoint = JsonValue & {
  x: number;
  y: number;
  tag: string;
  inputType?: "checkbox" | "radio";
  needsClick?: boolean;
};

function isBrowserTrustedInputPoint(
  value: JsonValue,
): value is BrowserTrustedInputPoint {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.tag === "string" &&
    (value.inputType === undefined ||
      value.inputType === "checkbox" ||
      value.inputType === "radio") &&
    (value.needsClick === undefined || typeof value.needsClick === "boolean")
  );
}
type BrowserPageScriptRunner = NonNullable<
  BbDesktopBrowserApi["experimental_runBrowserPageScript"]
>;

function isTransientActionabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "Browser target is moving" ||
    message === "Browser target is not visible" ||
    message === "Browser target is outside the viewport" ||
    message === "Browser target is covered" ||
    message === "Browser target is detached" ||
    message === "Browser target was not found" ||
    message === "Browser target shadow root is unavailable" ||
    message === "Browser pointer target must be visible in the viewport" ||
    message === "Browser drag endpoints must be visible in the viewport"
  );
}

async function resolveTrustedInputPoint(
  tab: RegisteredBrowserTab,
  action: Extract<
    BrowserControlAction,
    { kind: "click" | "type" | "check" | "uncheck" }
  >,
  signal: AbortSignal,
  actionabilityPolicy: BrowserActionabilityPolicy,
  run: BrowserPageScriptRunner,
): Promise<BrowserTrustedInputPoint> {
  const deadline = Date.now() + actionabilityPolicy.timeoutMs;
  let lastError: unknown = new Error("Browser target was not actionable");
  while (Date.now() <= deadline) {
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const remaining = deadline - Date.now();
    if (remaining < 100) break;
    try {
      const result = await run(
        {
          tabId: tab.descriptor.tabId,
          expectedNavigationEpoch: tab.descriptor.navigationEpoch,
          requestId: randomId(),
          frame: browserFrameForAction(action),
          source:
            action.kind === "click"
              ? trustedClickSource
              : action.kind === "type"
                ? trustedTypeSource
                : trustedCheckSource,
          input: {
            ...action,
            stableFrameCount: actionabilityPolicy.stableFrameCount,
          },
          timeoutMs: remaining,
        },
        { signal },
      );
      if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
        throw new Error("Browser tab changed while resolving native input");
      }
      if (!isBrowserTrustedInputPoint(result.value)) {
        throw new Error(
          "Browser native input target resolution returned an invalid point",
        );
      }
      return result.value;
    } catch (error) {
      if (!isTransientActionabilityError(error)) throw error;
      lastError = error;
    }
    const delayMs = Math.min(
      actionabilityPolicy.pollIntervalMs,
      Math.max(0, deadline - Date.now()),
    );
    if (delayMs === 0) break;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      const abort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Browser input was cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Browser target was not actionable before the timeout");
}
async function resolveActionablePointer(
  tab: RegisteredBrowserTab,
  action: Extract<
    BrowserControlAction,
    {
      kind: "hover" | "right-click" | "middle-click" | "double-click" | "drag";
    }
  >,
  signal: AbortSignal,
  actionabilityPolicy: BrowserActionabilityPolicy,
  run: BrowserPageScriptRunner,
): Promise<JsonValue> {
  const deadline = Date.now() + actionabilityPolicy.timeoutMs;
  let lastError: unknown = new Error(
    "Browser pointer target was not actionable",
  );
  while (Date.now() <= deadline) {
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const remaining = deadline - Date.now();
    if (remaining < 100) break;
    try {
      const result = await run(
        {
          tabId: tab.descriptor.tabId,
          expectedNavigationEpoch: tab.descriptor.navigationEpoch,
          frame: browserFrameForAction(action),
          requestId: randomId(),
          source: resolvePointerSource,
          input: {
            ...action,
            stableFrameCount: actionabilityPolicy.stableFrameCount,
          },
          timeoutMs: remaining,
        },
        { signal },
      );
      if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
        throw new Error("Browser tab changed while resolving a pointer target");
      }
      if (!isBrowserPointerCoordinate(result.value)) {
        throw new Error(
          "Browser pointer target resolution returned an invalid result",
        );
      }
      const target = result.value.target;
      const from = result.value.from;
      const to = result.value.to;
      if (
        (target !== undefined && !target.inViewport) ||
        (from !== undefined && !from.inViewport) ||
        (to !== undefined && !to.inViewport)
      ) {
        throw new Error(
          action.kind === "drag"
            ? "Browser drag endpoints must be visible in the viewport"
            : "Browser pointer target must be visible in the viewport",
        );
      }
      return result.value;
    } catch (error) {
      if (!isTransientActionabilityError(error)) throw error;
      lastError = error;
    }
    const delayMs = Math.min(
      actionabilityPolicy.pollIntervalMs,
      Math.max(0, deadline - Date.now()),
    );
    if (delayMs === 0) break;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      const abort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new DOMException("Browser input was cancelled", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Browser pointer target was not actionable before the timeout");
}

const annotationCaptureSource = `({ input }) => { ${resolveLocatorSource}
  const element = input.element.target === "locator"
    ? resolveLocator(input.element.locator)
    : document.elementFromPoint(input.element.x, input.element.y);
  if (!(element instanceof Element)) throw new Error("Browser annotation target was not found");
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const selectedEditable =
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLInputElement &&
      !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(element.type)) ||
    element.isContentEditable ||
    element.closest("[contenteditable]") !== null;
  const hasSensitiveDescendant = Array.from(element.querySelectorAll("*")).some((candidate) =>
    candidate instanceof HTMLInputElement && candidate.type === "password" ||
    Array.from(candidate.attributes).some((attribute) =>
      /(?:pass(?:word)?|secret|token|api[-_]?key|credential|authorization|cookie|session)/i.test(attribute.name + attribute.value),
    ),
  );
  const editable = selectedEditable || hasSensitiveDescendant;
  const attributes = {};
  for (const attribute of Array.from(element.attributes).slice(0, 32)) {
    attributes[attribute.name.slice(0, 64)] = attribute.value.slice(0, 256);
  }
  const text = editable ? "" : (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 1024);
  return {
    accessibility: {
      ariaLabel: element.getAttribute("aria-label")?.slice(0, 256) || null,
      ariaLabelledBy: element.getAttribute("aria-labelledby")?.slice(0, 256) || null,
      description: element.getAttribute("aria-description")?.slice(0, 256) || null,
      name: (element.getAttribute("aria-label") || text).slice(0, 256) || null,
      role: element.getAttribute("role")?.slice(0, 128) || element.localName.slice(0, 128)
    },
    capturedAt: new Date().toISOString(),
    ancestorPath: [],
    dom: {
      attributes,
      classes: Array.from(element.classList).slice(0, 16).map((value) => value.slice(0, 128)),
      id: element.id.slice(0, 256) || null,
      selector: element.localName.slice(0, 1024),
      tag: element.localName.slice(0, 64)
    },
    editable,
    fullDomPath: element.localName.slice(0, 2048),
    html: null,
    nearbyText: [],
    nearbyElements: [],
    reactComponents: null,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    rectPage: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
    sourceFile: null,
    styles: {
      backgroundColor: style.backgroundColor, border: style.border, borderRadius: style.borderRadius,
      color: style.color, display: style.display, fontFamily: style.fontFamily, fontSize: style.fontSize,
      fontWeight: style.fontWeight, height: style.height, lineHeight: style.lineHeight, margin: style.margin,
      opacity: style.opacity, padding: style.padding, position: style.position, textAlign: style.textAlign,
      width: style.width, zIndex: style.zIndex
    },
    selectedText: getSelection()?.toString().replace(/\\s+/g, " ").trim().slice(0, 500) || null,
    text,
    title: document.title.slice(0, 1024) || null,
    url: location.href.slice(0, 4096),
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { x: scrollX, y: scrollY }
  };
}`;

const snapshotScript = `async ({ input, signal }) => {
  const maxNodes = Math.max(1, Math.min(2000, Number(input.maxNodes ?? 500)));
  const interactiveOnly = input.mode === "interactive";
  const interactiveSelector = "a[href],button,input,select,textarea,[role],[tabindex],[contenteditable=true],summary";
  const queue = [{ root: document, shadowHosts: [] }];
  const nodes = [];
  let scanned = 0;
  let truncated = false;
  const selectorFor = (element, root) => {
    if (element.id && root.querySelectorAll("#" + CSS.escape(element.id)).length === 1) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current !== root && parts.length < 8) {
      const parent = current.parentElement;
      let part = current.localName;
      if (parent) {
        const peers = Array.from(parent.children).filter((item) => item.localName === current.localName);
        if (peers.length > 1) part += ":nth-of-type(" + (peers.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      try { if (root.querySelectorAll(candidate).length === 1) return candidate; } catch {}
      current = parent;
    }
    return parts.join(" > ");
  };
  const implicitRole = (element) => {
    if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return "link";
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLSelectElement) return element.multiple ? "listbox" : "combobox";
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (["button", "reset", "submit"].includes(element.type)) return "button";
      return "textbox";
    }
    if (/^H[1-6]$/.test(element.tagName)) return "heading";
    if (element instanceof HTMLImageElement) return "img";
    return null;
  };
  while (queue.length > 0 && nodes.length < maxNodes && scanned < 10000) {
    if (signal.aborted) throw new Error("Browser snapshot cancelled");
    const scope = queue.shift();
    const walker = document.createTreeWalker(scope.root, NodeFilter.SHOW_ELEMENT);
    let element;
    while ((element = walker.nextNode()) && nodes.length < maxNodes && scanned < 10000) {
      scanned += 1;
      const rect = element.getBoundingClientRect();
      if (element.shadowRoot) queue.push({ root: element.shadowRoot, shadowHosts: [...scope.shadowHosts, selectorFor(element, scope.root)] });
      if (rect.width <= 0 || rect.height <= 0) continue;
      const interactive = element.matches(interactiveSelector);
      if (interactiveOnly && !interactive) continue;
      const editable = element.matches("input,textarea,[contenteditable]") || element.closest("[contenteditable]") !== null || element.isContentEditable || document.designMode === "on";
      const text = editable ? "" : (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
      const label = element.getAttribute("aria-label") || "";
      const role = element.getAttribute("role") || implicitRole(element) || (interactive ? element.localName : "");
      if (!interactive && !text && !label) continue;
      nodes.push({
        locator: { selectors: [...scope.shadowHosts, selectorFor(element, scope.root)] },
        tag: element.localName,
        role: role || null,
        name: label || text.slice(0, 120) || null,
        text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        interactive
      });
    }
  }
  truncated = queue.length > 0 || nodes.length >= maxNodes || scanned >= 10000;
  return { url: location.href, title: document.title || null, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, nodes, scanned, truncated };
}`;

function scriptForAction(
  action: BrowserControlAction,
  actionabilityPolicy: BrowserActionabilityPolicy,
): {
  source: string;
  input: JsonValue;
  timeoutMs: number;
  world?: "isolated" | "main";
} | null {
  switch (action.kind) {
    case "snapshot":
      return { source: snapshotScript, input: action, timeoutMs: 30_000 };
    case "select":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLSelectElement) || element.disabled) throw new Error("Browser target is not an enabled select");
          const option = Array.from(element.options).find((candidate) => candidate.value === input.value);
          if (option === undefined || option.disabled) throw new Error("Browser select option is unavailable");
          element.value = input.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { selected: input.value };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "select-multiple":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLSelectElement) || !element.multiple || element.disabled) throw new Error("Browser target is not an enabled multiple select");
          const requested = new Set(input.values);
          const available = new Set(Array.from(element.options).filter((option) => !option.disabled).map((option) => option.value));
          for (const value of requested) if (!available.has(value)) throw new Error("Browser select option is unavailable");
          for (const option of Array.from(element.options)) option.selected = requested.has(option.value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { selected: Array.from(element.selectedOptions).map((option) => option.value) };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "upload":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLInputElement) || element.type !== "file" || element.disabled) throw new Error("Browser target is not an enabled file input");
          const transfer = new DataTransfer();
          for (const file of input.files) {
            const binary = atob(file.base64);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
          }
          element.files = transfer.files;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { uploaded: Array.from(element.files).map(({ name, size, type }) => ({ name, size, type })) };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "check":
    case "uncheck":
      return null;
    case "focus":
      return {
        source: `async ({ input }) => { ${resolveLocatorSource}
          await (${actionableTargetSource})({ input, requireEditable: false });
          const element = resolveLocator(input.locator);
          if (!(element instanceof HTMLElement)) throw new Error("Browser target is not focusable");
          element.focus({ preventScroll: true });
          let active = element.ownerDocument.activeElement;
          while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
          if (active !== element) throw new Error("Browser target did not accept focus");
          return { focused: true, tag: element.localName };
        }`,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "scroll-into-view":
      return {
        source: `({ input }) => { ${resolveLocatorSource}
          const element = resolveLocator(input.locator);
          element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
          const rect = element.getBoundingClientRect();
          return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, scroll: { x: scrollX, y: scrollY } };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "scroll":
      return {
        source: `({ input }) => {
          const options = { behavior: input.behavior || "auto" };
          if (input.x !== undefined || input.y !== undefined) scrollTo({ ...options, left: input.x ?? scrollX, top: input.y ?? scrollY });
          else scrollBy({ ...options, left: input.deltaX ?? 0, top: input.deltaY ?? 0 });
          return { x: scrollX, y: scrollY };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "wait":
      return {
        source: `async ({ input, signal }) => { ${resolveLocatorSource}
          const deadline = Date.now() + input.timeoutMs;
          while (Date.now() <= deadline) {
            if (signal.aborted) throw new DOMException("Browser wait was cancelled", "AbortError");
            try {
              if (input.criteria.kind === "locator") {
                const element = resolveLocator(input.criteria.locator);
                if (element instanceof Element) return { matched: true, kind: "locator" };
              } else if ((document.body?.innerText || "").includes(input.criteria.text)) {
                return { matched: true, kind: "text", text: input.criteria.text };
              }
            } catch {}
            const { promise, resolve } = Promise.withResolvers();
            setTimeout(resolve, 50);
            await promise;
          }
          throw new Error("Browser wait timed out");
        }`,
        input: { ...action, timeoutMs: actionabilityPolicy.timeoutMs },
        timeoutMs: actionabilityPolicy.timeoutMs,
      };
    case "get-storage":
      return {
        source: `() => ({
          local: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean).map((key) => [key, localStorage.getItem(key)])),
          session: Object.fromEntries(Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(Boolean).map((key) => [key, sessionStorage.getItem(key)])),
          cookies: document.cookie
        })`,
        input: null,
        timeoutMs: 10_000,
      };
    case "set-storage":
      return {
        source: `({ input }) => {
          for (const [key, value] of Object.entries(input.local)) localStorage.setItem(key, value);
          for (const [key, value] of Object.entries(input.session)) sessionStorage.setItem(key, value);
          for (const cookie of input.cookies) document.cookie = cookie;
          return { local: Object.keys(input.local).length, session: Object.keys(input.session).length, cookies: input.cookies.length };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "clear-storage":
      return {
        source: `({ input }) => {
          for (const store of input.stores) {
            if (store === "local") localStorage.clear();
            if (store === "session") sessionStorage.clear();
            if (store === "cookies") {
              for (const item of document.cookie.split(";")) {
                const name = item.split("=")[0]?.trim();
                if (name) document.cookie = name + "=; Max-Age=0; path=/";
              }
            }
          }
          return { cleared: input.stores };
        }`,
        input: action,
        timeoutMs: 10_000,
      };
    case "script":
      return {
        source: action.source,
        input: action.input,
        timeoutMs: action.timeoutMs,
        ...(action.world === undefined ? {} : { world: action.world }),
      };
    case "navigate":
    case "screenshot":
    case "screenshot-full-page":
    case "screenshot-element":
    case "hover":
    case "right-click":
    case "middle-click":
    case "double-click":
    case "drag":
    case "back":
    case "forward":
    case "reload":
    case "set-viewport-profile":
    case "clear-viewport-profile":
    case "set-dialog-handler":
    case "set-permissions":
    case "diagnostics":
    case "list-cookie-import-sources":
    case "import-cookies-from-browser":
    case "clear-imported-cookies":
    case "activate-tab":
    case "open-tab":
    case "close-tab":
    case "list-frames":
    case "annotate":
    case "click":
    case "type":
    case "key":
      return null;
  }
}

async function executeAction(
  tab: RegisteredBrowserTab,
  action: BrowserControlAction,
  signal: AbortSignal,
  actionabilityPolicy: BrowserActionabilityPolicy,
  originalTarget: BrowserTabTarget,
): Promise<JsonValue> {
  if (action.kind === "activate-tab") {
    const owner = ownerForTab(tab);
    if (owner === null) {
      throw new Error("Browser tab activation is unavailable in this panel");
    }
    return owner.activateTab(action.tabId);
  }
  if (action.kind === "open-tab") {
    const openTab = tab.openTab ?? ownerForTab(tab)?.openTab ?? null;
    if (openTab === null) {
      throw new Error("Browser tab creation is unavailable in this panel");
    }
    return openTab(action.url);
  }
  if (action.kind === "close-tab") {
    const owner = ownerForTab(tab);
    const closeTab =
      tab.closeTab ??
      (owner === null ? null : () => owner.closeTab(tab.descriptor.tabId));
    if (closeTab === null) {
      throw new Error("Browser tab close is unavailable in this panel");
    }
    const close = tab.desktopBrowser.experimental_closeBrowserTab;
    if (close === undefined) {
      throw new Error("Browser tab close requires a newer BB desktop app");
    }
    const result = await close({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed before it could be closed");
    }
    closeTab();
    return { closed: targetFor(tab) };
  }
  if (action.kind === "list-frames") {
    const list = tab.desktopBrowser.experimental_listBrowserFrames;
    if (list === undefined) {
      throw new Error(
        "Browser frame discovery requires a newer BB desktop app",
      );
    }
    const result = await list({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      maxFrames: action.maxFrames ?? BROWSER_CONTROL_MAX_FRAMES,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while frame discovery was running");
    }
    return result;
  }
  if (action.kind === "annotate") {
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    if (run === undefined) {
      throw new Error("Browser annotations require a newer BB desktop app");
    }
    const result = await run(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        frame: browserFrameForAction(action),
        requestId: randomId(),
        source: annotationCaptureSource,
        input: action,
        timeoutMs: 10_000,
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while the annotation was captured");
    }
    const capture = browserElementAnnotationCaptureSchema.safeParse(
      result.value,
    );
    if (!capture.success) {
      throw new Error("Browser annotation capture was invalid");
    }
    const annotation = redactBrowserElementAnnotation(capture.data);
    if (annotation === null || annotation.sensitive) {
      throw new Error("Browser annotation contains sensitive content");
    }
    return JSON.parse(
      JSON.stringify({
        annotation,
        intent: action.intent,
        feedback: action.feedback,
        tab: targetFor(tab),
      }),
    );
  }
  if (
    action.kind === "click" ||
    action.kind === "type" ||
    action.kind === "check" ||
    action.kind === "uncheck"
  ) {
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    const sendTrusted = tab.desktopBrowser.experimental_sendBrowserTrustedInput;
    if (run === undefined || sendTrusted === undefined) {
      throw new Error("Native Browser input requires a newer BB desktop app");
    }
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const resolved = await resolveTrustedInputPoint(
      tab,
      action,
      signal,
      actionabilityPolicy,
      run,
    );
    if (
      (action.kind === "check" || action.kind === "uncheck") &&
      resolved.inputType === undefined
    ) {
      throw new Error(
        "Browser native checkbox resolution returned an invalid target",
      );
    }
    if (
      (action.kind === "check" || action.kind === "uncheck") &&
      !resolved.needsClick
    ) {
      return action.kind === "check"
        ? { checked: true, type: resolved.inputType ?? "checkbox" }
        : { checked: false };
    }
    const result = await sendTrusted(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        frame: browserFrameForAction(action),
        action:
          action.kind === "type"
            ? {
                kind: "type",
                text: action.text,
                clear: action.clear ?? false,
              }
            : {
                kind: "click",
                x: resolved.x,
                y: resolved.y,
                button: "left",
                clickCount: 1,
              },
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while native input was sent");
    }
    if (action.kind === "click") return { clicked: true };
    if (action.kind === "type") return { typed: true };
    return action.kind === "check"
      ? { checked: true, type: resolved.inputType ?? "checkbox" }
      : { checked: false };
  }
  if (action.kind === "key") {
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    const sendTrusted = tab.desktopBrowser.experimental_sendBrowserTrustedInput;
    if (run === undefined || sendTrusted === undefined) {
      throw new Error(
        "Native Browser keyboard input requires a newer BB desktop app",
      );
    }
    if (signal.aborted) {
      throw new DOMException("Browser input was cancelled", "AbortError");
    }
    const focused = await run(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        source: keyTargetSource,
        input: action,
        timeoutMs: actionabilityPolicy.timeoutMs,
      },
      { signal },
    );
    if (focused.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while checking keyboard focus");
    }
    const result = await sendTrusted(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        action: {
          kind: "key",
          key: action.key,
          code: action.code,
          modifiers: action.modifiers ?? [],
        },
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while native input was sent");
    }
    return { pressed: action.key };
  }
  if (
    action.kind === "hover" ||
    action.kind === "right-click" ||
    action.kind === "middle-click" ||
    action.kind === "double-click" ||
    action.kind === "drag"
  ) {
    const run = tab.desktopBrowser.experimental_runBrowserPageScript;
    const sendPointer = tab.desktopBrowser.experimental_sendBrowserPointerInput;
    if (run === undefined || sendPointer === undefined) {
      throw new Error(
        "Native Browser pointer actions require a newer BB desktop app",
      );
    }
    const resolvedValue = await resolveActionablePointer(
      tab,
      action,
      signal,
      actionabilityPolicy,
      run,
    );
    if (!isBrowserPointerCoordinate(resolvedValue)) {
      throw new Error(
        "Browser pointer target resolution returned an invalid result",
      );
    }
    const target = resolvedValue.target;
    const from = resolvedValue.from;
    const to = resolvedValue.to;
    const events =
      action.kind === "hover"
        ? [{ type: "mouseMove" as const, x: target!.x, y: target!.y }]
        : action.kind === "right-click" || action.kind === "middle-click"
          ? [
              { type: "mouseMove" as const, x: target!.x, y: target!.y },
              {
                type: "mouseDown" as const,
                x: target!.x,
                y: target!.y,
                button:
                  action.kind === "right-click"
                    ? ("right" as const)
                    : ("middle" as const),
                clickCount: 1,
              },
              {
                type: "mouseUp" as const,
                x: target!.x,
                y: target!.y,
                button:
                  action.kind === "right-click"
                    ? ("right" as const)
                    : ("middle" as const),
                clickCount: 1,
              },
            ]
          : action.kind === "double-click"
            ? [
                { type: "mouseMove" as const, x: target!.x, y: target!.y },
                {
                  type: "mouseDown" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
                {
                  type: "mouseUp" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
                {
                  type: "mouseDown" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 2,
                },
                {
                  type: "mouseUp" as const,
                  x: target!.x,
                  y: target!.y,
                  button: "left" as const,
                  clickCount: 2,
                },
              ]
            : [
                { type: "mouseMove" as const, x: from!.x, y: from!.y },
                {
                  type: "mouseDown" as const,
                  x: from!.x,
                  y: from!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
                { type: "mouseMove" as const, x: to!.x, y: to!.y },
                {
                  type: "mouseUp" as const,
                  x: to!.x,
                  y: to!.y,
                  button: "left" as const,
                  clickCount: 1,
                },
              ];
    const result = await sendPointer(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        frame: browserFrameForAction(action),
        events,
      },
      { signal },
    );
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error(
        "Browser tab changed while native pointer input was sent",
      );
    }
    return result;
  }
  if (
    action.kind === "back" ||
    action.kind === "forward" ||
    action.kind === "reload"
  ) {
    if (action.kind === "back") tab.desktopBrowser.goBack(tab.descriptor.tabId);
    if (action.kind === "forward")
      tab.desktopBrowser.goForward(tab.descriptor.tabId);
    if (action.kind === "reload")
      tab.desktopBrowser.reload(tab.descriptor.tabId);
    return { accepted: true, action: action.kind };
  }
  if (
    action.kind === "set-viewport-profile" ||
    action.kind === "clear-viewport-profile"
  ) {
    const setProfile =
      tab.desktopBrowser.experimental_setBrowserViewportProfile;
    const clearProfile =
      tab.desktopBrowser.experimental_clearBrowserViewportProfile;
    if (action.kind === "clear-viewport-profile") {
      if (clearProfile === undefined) {
        throw new Error(
          "Browser viewport profiles require a newer BB desktop app",
        );
      }
      await clearProfile({ tabId: tab.descriptor.tabId });
      return { cleared: true };
    }
    if (setProfile === undefined || clearProfile === undefined) {
      throw new Error(
        "Browser viewport profiles require a newer BB desktop app",
      );
    }
    const result = await setProfile({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      profile: action.profile,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      await clearProfile({
        tabId: tab.descriptor.tabId,
        generation: result.generation,
      });
      throw new Error(
        "Browser tab changed while viewport emulation was applied",
      );
    }
    if (signal.aborted) {
      await clearProfile({
        tabId: tab.descriptor.tabId,
        generation: result.generation,
      });
      throw new DOMException(
        "Browser viewport profile was cancelled",
        "AbortError",
      );
    }
    return result;
  }
  if (action.kind === "list-cookie-import-sources") {
    const list = tab.desktopBrowser.experimental_listCookieImportSources;
    if (list === undefined) {
      throw new Error("Browser cookie import requires a newer BB desktop app");
    }
    return list({ tabId: tab.descriptor.tabId });
  }
  if (action.kind === "import-cookies-from-browser") {
    const importCookies =
      tab.desktopBrowser.experimental_importCookiesFromBrowser;
    if (importCookies === undefined) {
      throw new Error("Browser cookie import requires a newer BB desktop app");
    }
    if (signal.aborted) {
      throw new DOMException(
        "Browser cookie import was cancelled",
        "AbortError",
      );
    }
    const result = await importCookies({
      tabId: tab.descriptor.tabId,
      family: action.family,
      profileId: action.profileId,
    });
    return result;
  }
  if (action.kind === "clear-imported-cookies") {
    const clear = tab.desktopBrowser.experimental_clearImportedCookies;
    if (clear === undefined) {
      throw new Error("Browser cookie import requires a newer BB desktop app");
    }
    await clear({ tabId: tab.descriptor.tabId });
    return { cleared: true };
  }
  if (
    action.kind === "set-dialog-handler" ||
    action.kind === "set-permissions" ||
    action.kind === "diagnostics" ||
    action.kind === "screenshot-full-page" ||
    action.kind === "screenshot-element"
  ) {
    const automate = tab.desktopBrowser.experimental_runBrowserAutomation;
    if (automate === undefined) {
      throw new Error("Browser automation requires a newer BB desktop app");
    }
    let desktopAction:
      | {
          kind: "set-dialog-handler";
          behavior: "accept" | "dismiss";
          promptText?: string;
        }
      | {
          kind: "set-permissions";
          decision: "allow" | "deny";
          permissions: string[];
        }
      | { kind: "diagnostics" }
      | {
          kind: "capture-full-page";
          format: "png";
          quality: 100;
        }
      | {
          kind: "capture-clip";
          format: "png" | "jpeg";
          quality: number;
          x: number;
          y: number;
          width: number;
          height: number;
          frame?: BrowserFrameTarget;
        };
    if (action.kind === "screenshot-element") {
      const run = tab.desktopBrowser.experimental_runBrowserPageScript;
      if (run === undefined) {
        throw new Error(
          "Browser element screenshots require a newer BB desktop app",
        );
      }
      const rect = await run(
        {
          tabId: tab.descriptor.tabId,
          expectedNavigationEpoch: tab.descriptor.navigationEpoch,
          frame: browserFrameForAction(action),
          requestId: randomId(),
          source: resolveElementRectSource,
          input: {
            ...action,
            stableFrameCount: actionabilityPolicy.stableFrameCount,
          },
          timeoutMs: actionabilityPolicy.timeoutMs,
        },
        { signal },
      );
      if (!isBrowserPageRect(rect.value)) {
        throw new Error(
          "Browser screenshot target returned an invalid rectangle",
        );
      }
      desktopAction = {
        kind: "capture-clip",
        format: action.format,
        quality: action.quality,
        x: rect.value.x,
        y: rect.value.y,
        width: rect.value.width,
        height: rect.value.height,
        ...(browserFrameForAction(action) === undefined
          ? {}
          : { frame: browserFrameForAction(action) }),
      };
    } else if (action.kind === "screenshot-full-page") {
      desktopAction = {
        kind: "capture-full-page",
        format: "png",
        quality: 100,
      };
    } else {
      desktopAction = action;
    }
    const result = await automate({
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      action: desktopAction,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while automation was running");
    }
    return result.value;
  }
  if (
    action.kind === "wait" &&
    action.criteria.kind !== "locator" &&
    action.criteria.kind !== "text"
  ) {
    const wait = tab.desktopBrowser.experimental_waitBrowserEvent;
    if (wait === undefined) {
      throw new Error("Browser event waits require a newer BB desktop app");
    }
    const result = await wait(
      {
        tabId: tab.descriptor.tabId,
        expectedNavigationEpoch: tab.descriptor.navigationEpoch,
        requestId: randomId(),
        criteria: action.criteria,
      },
      { signal },
    );
    const transition = isBrowserTransitionWaitAction(action);
    if (
      !transition &&
      result.navigationEpoch !== originalTarget.navigationEpoch
    ) {
      throw new Error("Browser tab changed while waiting for an event");
    }
    const observedTarget = transition
      ? await waitForBrowserTarget(
          { ...originalTarget, navigationEpoch: result.navigationEpoch },
          actionabilityPolicy.timeoutMs,
          signal,
        )
      : targetFor(tab);
    if (!transition && !targetEquals(originalTarget, observedTarget)) {
      throw new Error("Browser tab changed while waiting for an event");
    }
    if (
      typeof result.value !== "object" ||
      result.value === null ||
      Array.isArray(result.value)
    ) {
      throw new Error("Browser event wait returned an invalid result");
    }
    return {
      ...result.value,
      target: originalTarget,
      ...(targetEquals(originalTarget, observedTarget)
        ? {}
        : { originalTarget, observedTarget }),
    };
  }
  if (action.kind === "navigate") {
    if (!isAllowedBrowserNavigationUrl(action.url)) {
      throw new Error("Browser navigation URL is not allowed");
    }
    tab.desktopBrowser.navigate({
      tabId: tab.descriptor.tabId,
      url: action.url,
    });
    return { navigating: true, url: action.url };
  }
  if (action.kind === "screenshot") {
    const capture = tab.desktopBrowser.experimental_captureBrowserPage;
    if (capture === undefined)
      throw new Error("Browser screenshots require a newer BB desktop app");
    const result = await capture({
      tabId: tab.descriptor.tabId,
      format: action.format ?? "png",
      quality: action.quality ?? 85,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
    });
    if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
      throw new Error("Browser tab changed while the screenshot was captured");
    }
    return result;
  }
  const script = scriptForAction(action, actionabilityPolicy);
  const run = tab.desktopBrowser.experimental_runBrowserPageScript;
  if (script === null || run === undefined) {
    throw new Error("Browser page actions require a newer BB desktop app");
  }
  const locatorActionability =
    action.kind === "select" ||
    action.kind === "select-multiple" ||
    action.kind === "upload" ||
    action.kind === "focus";
  const result = await run(
    {
      tabId: tab.descriptor.tabId,
      expectedNavigationEpoch: tab.descriptor.navigationEpoch,
      frame: browserFrameForAction(action),
      requestId: randomId(),
      ...script,
      ...(locatorActionability
        ? {
            input: {
              ...action,
              stableFrameCount: actionabilityPolicy.stableFrameCount,
            },
          }
        : {}),
    },
    { signal },
  );
  if (result.navigationEpoch !== tab.descriptor.navigationEpoch) {
    throw new Error("Browser tab changed while the action was running");
  }
  if (action.kind === "wait") {
    if (
      typeof result.value !== "object" ||
      result.value === null ||
      Array.isArray(result.value)
    ) {
      throw new Error("Browser wait returned an invalid result");
    }
    const observedTarget = targetFor(tab);
    return {
      ...result.value,
      target: originalTarget,
      ...(targetEquals(originalTarget, observedTarget)
        ? {}
        : { originalTarget, observedTarget }),
    };
  }
  return result.value;
}

async function handleRequest(
  message: BrowserControlRequestMessage,
): Promise<void> {
  const tab = registeredTabs.get(message.target.tabId);
  if (tab === undefined || !targetEquals(message.target, targetFor(tab))) {
    wsManager.sendBrowserControlResponse({
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ...(tab === undefined ? {} : { observedTarget: targetFor(tab) }),
      ok: false,
      error: {
        code: "BrowserControlTargetChangedError",
        message: "The target Browser tab is no longer at that page revision",
      },
    });
    return;
  }
  const controller = new AbortController();
  requestControllers.set(message.requestId, controller);
  setRequestActive(message.target.tabId, true);
  let response: BrowserControlResponseMessage;
  try {
    const value = await executeAction(
      tab,
      message.action,
      controller.signal,
      message.actionabilityPolicy,
      message.target,
    );
    const observedTarget = targetFor(tab);
    response = {
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ...(targetEquals(observedTarget, message.target)
        ? {}
        : { observedTarget }),
      ok: true,
      value,
    };
  } catch (error) {
    const observedTarget = targetFor(tab);
    response = {
      type: "browser-control-response",
      requestId: message.requestId,
      target: message.target,
      ...(targetEquals(observedTarget, message.target)
        ? {}
        : { observedTarget }),
      ok: false,
      error: publicBrowserError(error, "BrowserControlError"),
    };
  } finally {
    requestControllers.delete(message.requestId);
    setRequestActive(message.target.tabId, false);
  }
  wsManager.sendBrowserControlResponse(response);
}

function matchingThreadOwners(
  threadId: string,
  projectId: string,
): RegisteredBrowserOwner[] {
  const matches = [...registeredOwners.values()].filter(
    (owner) => owner.threadId === threadId && owner.projectId === projectId,
  );
  const active = matches.filter((owner) => owner.active);
  return active.length > 0 ? active : matches;
}

function resolveOwnerRegistrationWaiters(): void {
  for (const waiter of ownerRegistrationWaiters) {
    const matches = matchingThreadOwners(waiter.threadId, waiter.projectId);
    if (matches.length === 0) continue;
    ownerRegistrationWaiters.delete(waiter);
    waiter.unlinkAbort();
    const owner = matches[0];
    if (matches.length === 1 && owner !== undefined) {
      waiter.resolve(owner);
    } else {
      waiter.reject(
        new Error(
          "Multiple Browser panel owners mounted for the target thread",
        ),
      );
    }
  }
}

function waitForThreadOwner(
  threadId: string,
  projectId: string,
  signal: AbortSignal,
): Promise<RegisteredBrowserOwner> {
  const matches = matchingThreadOwners(threadId, projectId);
  const owner = matches[0];
  if (matches.length === 1 && owner !== undefined)
    return Promise.resolve(owner);
  if (matches.length > 1) {
    return Promise.reject(
      new Error("Multiple Browser panel owners mounted for the target thread"),
    );
  }
  if (signal.aborted) {
    return Promise.reject(
      new DOMException("Browser tab creation was cancelled", "AbortError"),
    );
  }
  let resolve!: (owner: RegisteredBrowserOwner) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RegisteredBrowserOwner>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let waiter: BrowserOwnerRegistrationWaiter;
  const abort = () => {
    ownerRegistrationWaiters.delete(waiter);
    reject(
      new DOMException("Browser tab creation was cancelled", "AbortError"),
    );
  };
  waiter = {
    projectId,
    threadId,
    resolve,
    reject,
    unlinkAbort: () => signal.removeEventListener("abort", abort),
  };
  ownerRegistrationWaiters.add(waiter);
  signal.addEventListener("abort", abort, { once: true });
  return promise;
}

async function handleOpenRequest(
  message: BrowserOpenTabRequestMessage,
): Promise<void> {
  if (message.clientId !== clientId || message.windowId !== windowId) return;
  const controller = new AbortController();
  requestControllers.set(message.requestId, controller);
  let response: BrowserOpenTabResponseMessage;
  let ownerId =
    message.mode === "owner" ? message.ownerId : `thread:${message.threadId}`;
  try {
    let owner: RegisteredBrowserOwner;
    if (message.mode === "owner") {
      const registeredOwner = registeredOwners.get(message.ownerId);
      if (registeredOwner === undefined) {
        throw new Error("The selected Browser panel is no longer available");
      }
      owner = registeredOwner;
    } else {
      if (threadOwnerActivator === null) {
        throw new Error(
          "This BB app cannot activate a Browser panel for another thread",
        );
      }
      await threadOwnerActivator.activate({
        projectId: message.projectId,
        signal: controller.signal,
        threadId: message.threadId,
      });
      owner = await waitForThreadOwner(
        message.threadId,
        message.projectId,
        controller.signal,
      );
      ownerId = owner.ownerId;
    }
    if (controller.signal.aborted) {
      throw new DOMException(
        "Browser tab creation was cancelled",
        "AbortError",
      );
    }
    const target = await owner.openTab(message.url);
    response = {
      type: "browser-open-tab-response",
      requestId: message.requestId,
      clientId,
      windowId,
      ownerId,
      ok: true,
      target,
    };
  } catch (error) {
    response = {
      type: "browser-open-tab-response",
      requestId: message.requestId,
      clientId,
      windowId,
      ownerId,
      ok: false,
      error: publicBrowserError(error, "BrowserOpenTabError"),
    };
  } finally {
    requestControllers.delete(message.requestId);
  }
  wsManager.sendBrowserOpenTabResponse(response);
}

wsManager.onBrowserOpenTabRequest((message) => void handleOpenRequest(message));

wsManager.onBrowserControlRequest((message) => void handleRequest(message));
wsManager.onBrowserControlCancel((message) => {
  requestControllers.get(message.requestId)?.abort(message.reason);
});
wsManager.onConnectionStateChange(() => {
  if (wsManager.getConnectionState() === "connected") return;
  for (const controller of requestControllers.values()) {
    controller.abort("client-disconnected");
  }
});
wsManager.onConnected(() => sendClientState());
subscribeToDocumentVisibility(sendClientState);

export function registerBrowserThreadOwnerActivator(
  activator: BrowserThreadOwnerActivator,
): BrowserThreadOwnerActivatorRegistration {
  if (threadOwnerActivator !== null) {
    throw new Error("A Browser thread owner activator is already registered");
  }
  threadOwnerActivator = activator;
  sendClientState();
  return {
    dispose() {
      if (threadOwnerActivator !== activator) return;
      threadOwnerActivator = null;
      sendClientState();
    },
  };
}

export function registerBrowserControlOwner(
  args: RegisterBrowserControlOwnerArgs,
): BrowserControlOwnerRegistration {
  const registration = { ...args };
  registeredOwners.set(args.ownerId, registration);
  sendClientState();
  resolveOwnerRegistrationWaiters();
  return {
    updateTabs(tabs) {
      if (registeredOwners.get(args.ownerId) !== registration) return;
      registration.tabs = tabs;
      sendClientState();
    },
    dispose() {
      if (registeredOwners.get(args.ownerId) !== registration) return;
      registeredOwners.delete(args.ownerId);
      sendClientState();
    },
  };
}

export function registerBrowserControlTab(
  args: RegisterBrowserControlTabArgs,
): BrowserControlTabRegistration {
  const descriptorFor = (
    next: Pick<RegisterBrowserControlTabArgs, "active" | "state" | "url">,
  ): BrowserTabDescriptor => ({
    clientId,
    windowId,
    tabId: args.tabId,
    threadId: args.threadId,
    projectId: args.projectId,
    url: next.state?.url ?? next.url,
    title: next.state?.title ?? null,
    connected: true,
    active: next.active,
    navigationEpoch: next.state?.navigationEpoch ?? 0,
  });
  const registration: RegisteredBrowserTab = {
    descriptor: descriptorFor(args),
    desktopBrowser: args.desktopBrowser,
    openTab: args.openTab ?? null,
    closeTab: args.closeTab ?? null,
    ready: (args.state?.navigationEpoch ?? 0) > 0,
  };
  registeredTabs.set(args.tabId, registration);
  if (registration.ready) {
    const waiter = tabRegistrationWaiters.get(args.tabId);
    if (waiter !== undefined) {
      tabRegistrationWaiters.delete(args.tabId);
      clearTimeout(waiter.timeout);
      waiter.resolve(targetFor(registration));
    }
  }
  notifyBrowserTargetWaiters(args.tabId);
  sendClientState();
  return {
    update(next) {
      if (registeredTabs.get(args.tabId) !== registration) return;
      const descriptor = descriptorFor(next);
      const changed =
        JSON.stringify(descriptor) !== JSON.stringify(registration.descriptor);
      registration.descriptor = descriptor;
      registration.ready = (next.state?.navigationEpoch ?? 0) > 0;
      if (registration.ready) {
        const waiter = tabRegistrationWaiters.get(args.tabId);
        if (waiter !== undefined) {
          tabRegistrationWaiters.delete(args.tabId);
          clearTimeout(waiter.timeout);
          waiter.resolve(targetFor(registration));
        }
      }
      notifyBrowserTargetWaiters(args.tabId);
      if (changed) sendClientState();
    },
    dispose() {
      if (registeredTabs.get(args.tabId) !== registration) return;
      registeredTabs.delete(args.tabId);
      notifyBrowserTargetWaiters(args.tabId);
      sendClientState();
    },
  };
}

export function subscribeBrowserControlActivity(
  listener: () => void,
): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function browserControlActivitySnapshot(tabId: string): number {
  return activeRequestCounts.get(tabId) ?? 0;
}
