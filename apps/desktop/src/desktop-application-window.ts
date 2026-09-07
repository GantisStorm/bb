import {
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from "electron";

export interface DesktopApplicationWindow extends BaseWindow {
  readonly webContents: WebContents;
  loadURL(url: string): Promise<void>;
}

export type DesktopHostWindow = DesktopApplicationWindow | BrowserWindow;

const applicationWindows = new Map<number, DesktopApplicationWindow>();
const applicationWindowsByWebContents = new Map<
  number,
  DesktopApplicationWindow
>();

export function createDesktopApplicationWindow(
  options: BrowserWindowConstructorOptions,
): DesktopApplicationWindow {
  const window = new BaseWindow(options);
  const rendererView = new WebContentsView({
    webPreferences: options.webPreferences,
  });
  const webContents = rendererView.webContents;
  const applicationWindow = Object.assign(window, {
    webContents,
    loadURL: (url: string) => webContents.loadURL(url),
  });
  rendererView.setBackgroundColor(options.backgroundColor ?? "#00000000");
  window.contentView.addChildView(rendererView);
  const resizeRenderer = () => {
    const { width, height } = window.getContentBounds();
    rendererView.setBounds({ x: 0, y: 0, width, height });
  };
  resizeRenderer();
  window.on("resize", resizeRenderer);
  window.on("focus", () => {
    if (!webContents.isDestroyed()) webContents.focus();
  });
  const windowId = window.id;
  const webContentsId = webContents.id;
  applicationWindows.set(windowId, applicationWindow);
  applicationWindowsByWebContents.set(webContentsId, applicationWindow);
  window.on("close", (event) => {
    if (webContents.isDestroyed()) return;
    event.preventDefault();
    webContents.close({ waitForBeforeUnload: true });
  });
  webContents.once("destroyed", () => {
    applicationWindows.delete(windowId);
    applicationWindowsByWebContents.delete(webContentsId);
    if (!window.isDestroyed()) window.destroy();
  });
  window.on("closed", () => {
    applicationWindows.delete(windowId);
    applicationWindowsByWebContents.delete(webContentsId);
    if (!webContents.isDestroyed()) webContents.close();
  });
  return applicationWindow;
}

export function isDesktopHostWindow(
  window: BaseWindow | undefined | null,
): window is DesktopHostWindow {
  return (
    window != null &&
    (applicationWindows.get(window.id) === window ||
      window instanceof BrowserWindow)
  );
}

export function desktopHostWindowForWebContents(
  contents: WebContents,
): DesktopHostWindow | null {
  return (
    applicationWindowsByWebContents.get(contents.id) ??
    BrowserWindow.fromWebContents(contents)
  );
}

export function desktopHostWindows(): DesktopHostWindow[] {
  return [...applicationWindows.values(), ...BrowserWindow.getAllWindows()];
}
