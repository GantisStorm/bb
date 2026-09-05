import type { BbDesktopBrowserViewBounds } from "@bb/desktop-contract";

const APERTURE_ATTRIBUTE = "data-desktop-browser-view-aperture";
const APERTURE_HEIGHT_PROPERTY = "--bb-desktop-browser-aperture-height";
const APERTURE_WIDTH_PROPERTY = "--bb-desktop-browser-aperture-width";
const APERTURE_X_PROPERTY = "--bb-desktop-browser-aperture-x";
const APERTURE_Y_PROPERTY = "--bb-desktop-browser-aperture-y";

let activeTabId: string | null = null;
function rootElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("root");
}

export function activateDesktopBrowserViewAperture(tabId: string): void {
  activeTabId = tabId;
}

export function updateDesktopBrowserViewAperture({
  bounds,
  tabId,
}: {
  bounds: BbDesktopBrowserViewBounds;
  tabId: string;
}): void {
  if (activeTabId !== tabId) return;
  const root = rootElement();
  if (root === null) return;
  const rootBounds = root.getBoundingClientRect();
  document.body.setAttribute(APERTURE_ATTRIBUTE, "");
  root.setAttribute(APERTURE_ATTRIBUTE, "");
  root.style.setProperty(
    APERTURE_X_PROPERTY,
    `${Math.round(bounds.x - rootBounds.left)}px`,
  );
  root.style.setProperty(
    APERTURE_Y_PROPERTY,
    `${Math.round(bounds.y - rootBounds.top)}px`,
  );
  root.style.setProperty(APERTURE_WIDTH_PROPERTY, `${bounds.width}px`);
  root.style.setProperty(APERTURE_HEIGHT_PROPERTY, `${bounds.height}px`);
}

export function deactivateDesktopBrowserViewAperture(tabId: string): void {
  if (activeTabId !== tabId || typeof document === "undefined") return;
  activeTabId = null;
  document.body.removeAttribute(APERTURE_ATTRIBUTE);
  const root = rootElement();
  if (root === null) return;
  root.removeAttribute(APERTURE_ATTRIBUTE);
  root.style.removeProperty(APERTURE_HEIGHT_PROPERTY);
  root.style.removeProperty(APERTURE_WIDTH_PROPERTY);
  root.style.removeProperty(APERTURE_X_PROPERTY);
  root.style.removeProperty(APERTURE_Y_PROPERTY);
}

export function resetDesktopBrowserViewAperture(): void {
  activeTabId = null;
  if (typeof document === "undefined") return;
  document.body.removeAttribute(APERTURE_ATTRIBUTE);
  const root = rootElement();
  if (root === null) return;
  root.removeAttribute(APERTURE_ATTRIBUTE);
  root.style.removeProperty(APERTURE_HEIGHT_PROPERTY);
  root.style.removeProperty(APERTURE_WIDTH_PROPERTY);
  root.style.removeProperty(APERTURE_X_PROPERTY);
  root.style.removeProperty(APERTURE_Y_PROPERTY);
}
