// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  activateDesktopBrowserViewAperture,
  deactivateDesktopBrowserViewAperture,
  resetDesktopBrowserViewAperture,
  updateDesktopBrowserViewAperture,
} from "./desktop-browser-view-aperture";

afterEach(() => {
  resetDesktopBrowserViewAperture();
  document.body.replaceChildren();
});

describe("desktop browser view aperture", () => {
  it("only exposes the active native browser viewport", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    Object.defineProperty(root, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(20, 30, 1_200, 800),
    });

    activateDesktopBrowserViewAperture("browser:a");
    updateDesktopBrowserViewAperture({
      tabId: "browser:b",
      bounds: { x: 100, y: 80, width: 500, height: 350 },
    });
    updateDesktopBrowserViewAperture({
      tabId: "browser:a",
      bounds: { x: 100, y: 80, width: 500, height: 350 },
    });
    expect(document.body.hasAttribute("data-desktop-browser-view-aperture")).toBe(
      true,
    );

    expect(root.hasAttribute("data-desktop-browser-view-aperture")).toBe(true);
    expect(root.style.getPropertyValue("--bb-desktop-browser-aperture-x")).toBe("80px");
    expect(root.style.getPropertyValue("--bb-desktop-browser-aperture-y")).toBe("50px");
    expect(root.style.getPropertyValue("--bb-desktop-browser-aperture-width")).toBe("500px");
    expect(root.style.getPropertyValue("--bb-desktop-browser-aperture-height")).toBe("350px");

    deactivateDesktopBrowserViewAperture("browser:b");
    expect(root.hasAttribute("data-desktop-browser-view-aperture")).toBe(true);

    deactivateDesktopBrowserViewAperture("browser:a");
    expect(root.hasAttribute("data-desktop-browser-view-aperture")).toBe(false);
    expect(document.body.hasAttribute("data-desktop-browser-view-aperture")).toBe(
      false,
    );
  });
});
