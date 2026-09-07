// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cropBrowserElementScreenshot } from "./element-crop";
import { readBrowserElementPickerTheme } from "./element-picker-theme";
import { redactBrowserElementAnnotation } from "./element-capture";

let originalRootStyle: string | null;
beforeEach(() => {
  originalRootStyle = document.documentElement.getAttribute("style");
});
afterEach(() => {
  if (originalRootStyle === null)
    document.documentElement.removeAttribute("style");
  else document.documentElement.setAttribute("style", originalRootStyle);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createAnnotation(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return redactBrowserElementAnnotation({
    accessibility: {
      ariaLabel: null,
      ariaLabelledBy: null,
      description: null,
      name: "Card",
      role: "button",
    },
    ancestorPath: ["main"],
    capturedAt: "2026-01-01T00:00:00.000Z",
    devicePixelRatio: 1,
    dom: {
      attributes: { role: "button" },
      classes: [],
      id: "card",
      selector: "#card",
      tag: "button",
    },
    editable: false,
    fullDomPath: "main > button#card",
    html: "<button>Card</button>",
    nearbyElements: [],
    nearbyText: [],
    reactComponents: null,
    rect,
    rectPage: { height: 200, width: 400, x: 100, y: 250 },
    scroll: { x: 0, y: 200 },
    selectedText: null,
    sourceFile: null,
    styles: {
      backgroundColor: "rgb(255, 255, 255)",
      border: "",
      borderRadius: "",
      color: "rgb(0, 0, 0)",
      display: "block",
      fontFamily: "",
      fontSize: "14px",
      fontWeight: "400",
      height: "",
      lineHeight: "",
      margin: "",
      opacity: "1",
      padding: "",
      position: "static",
      textAlign: "",
      width: "",
      zIndex: "auto",
    },
    text: "Card",
    title: "Page",
    url: "https://example.test/page",
    viewport: { height: 900, width: 1440 },
  })!;
}

function captureDraw() {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 2880;
      naturalHeight = 1800;
      src = "";
      async decode(): Promise<void> {}
    },
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,cropped",
  );
  return drawImage;
}

describe("element crop", () => {
  it.each([
    {
      name: "clips negative coordinates without including neighboring pixels",
      rect: { x: -20, y: -10, width: 40, height: 20 },
      source: [0, 0, 40, 20],
      output: [40, 20],
    },
    {
      name: "clips the lower-right edge in screenshot pixel coordinates",
      rect: { x: 1430, y: 890, width: 40, height: 30 },
      source: [2860, 1780, 20, 20],
      output: [20, 20],
    },
    {
      name: "caps large crops while preserving aspect ratio",
      rect: { x: 100, y: 50, width: 800, height: 400 },
      source: [200, 100, 1600, 800],
      output: [640, 320],
    },
  ])("$name", async ({ rect, source, output }) => {
    const drawImage = captureDraw();
    await cropBrowserElementScreenshot({
      annotation: createAnnotation(rect),
      dataUrl: "data:image/jpeg;base64,page",
    });
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(
      expect.any(Image),
      ...source,
      0,
      0,
      ...output,
    );
  });

  it("does not capture unrelated pixels for an entirely offscreen element", async () => {
    captureDraw();
    const result = await cropBrowserElementScreenshot({
      annotation: createAnnotation({ x: -50, y: 0, width: 20, height: 20 }),
      dataUrl: "data:image/jpeg;base64,page",
    });
    expect(result).toBeNull();
  });
});

describe("picker theme", () => {
  it("tracks theme overrides and falls back through the host text tokens", () => {
    const style = document.documentElement.style;
    style.setProperty("--ring", "rgb(10, 20, 30)");
    style.setProperty("--foreground", "rgb(40, 50, 60)");
    style.setProperty("--ink", "rgb(70, 80, 90)");
    expect(readBrowserElementPickerTheme().outlineColor).toBe(
      "rgb(10, 20, 30)",
    );
    style.setProperty("--ring", "rgb(100, 110, 120)");
    expect(readBrowserElementPickerTheme().outlineColor).toBe(
      "rgb(100, 110, 120)",
    );
    style.removeProperty("--ring");
    expect(readBrowserElementPickerTheme().outlineColor).toBe(
      "rgb(40, 50, 60)",
    );
    style.removeProperty("--foreground");
    expect(readBrowserElementPickerTheme().outlineColor).toBe(
      "rgb(70, 80, 90)",
    );
    style.removeProperty("--ink");
    style.color = "rgb(130, 140, 150)";
    expect(readBrowserElementPickerTheme().outlineColor).toBe(
      "rgb(130, 140, 150)",
    );
  });
});
