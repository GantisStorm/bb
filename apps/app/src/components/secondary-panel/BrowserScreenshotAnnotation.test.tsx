// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { BrowserScreenshotEditorSnapshot } from "./browserAnnotationState";
import { BrowserScreenshotAnnotation } from "./BrowserScreenshotAnnotation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "setPointerCapture");
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "hasPointerCapture");
  Reflect.deleteProperty(HTMLCanvasElement.prototype, "releasePointerCapture");
});

describe("BrowserScreenshotAnnotation", () => {
  it("labels every toolbar button with a tooltip", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    render(
      <TooltipProvider delayDuration={0}>
        <BrowserScreenshotAnnotation
          screenshotUrl="data:image/png;base64,AA=="
          onClose={() => {}}
        />
      </TooltipProvider>,
    );

    const buttonNames = [
      "Pen",
      "Highlighter",
      "Arrow",
      "Rectangle",
      "Ellipse",
      "Text",
      "Red ink",
      "Orange ink",
      "Yellow ink",
      "Green ink",
      "Blue ink",
      "Dark ink",
      "White ink",
      "Undo",
      "Redo",
      "Clear all",
      "Copy PNG",
      "Save PNG",
    ];
    for (const name of buttonNames) {
      expect(
        screen
          .getByRole("button", { name })
          .parentElement?.hasAttribute("data-state"),
      ).toBe(true);
    }

    const blueInkTrigger = screen.getByRole("button", {
      name: "Blue ink",
    }).parentElement;
    if (blueInkTrigger === null)
      throw new Error("Expected blue ink tooltip trigger");
    fireEvent.pointerMove(blueInkTrigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Blue ink");
  });

  it("copies the composited screenshot as a PNG", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      drawImage,
      lineCap: "round",
      lineJoin: "round",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) =>
        callback(new Blob(["annotated screenshot"], { type: "image/png" })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    const clipboardItems: Array<Record<string, Blob>> = [];
    class TestClipboardItem {
      constructor(item: Record<string, Blob>) {
        clipboardItems.push(item);
      }
    }
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
      />,
    );
    const image = screen.getByAltText("Captured browser page");
    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    Object.defineProperty(image, "naturalWidth", { value: 100 });
    Object.defineProperty(image, "naturalHeight", { value: 60 });
    fireEvent.load(image);
    fireEvent.click(screen.getByRole("button", { name: "Copy PNG" }));

    await waitFor(() => expect(write).toHaveBeenCalledOnce());

    expect(clipboardItems).toHaveLength(1);
    expect(clipboardItems[0]?.["image/png"]?.type).toBe("image/png");
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 100, 60);
    expect(drawImage).toHaveBeenCalledWith(
      canvas,
      0,
      0,
      canvas.width,
      canvas.height,
      0,
      0,
      100,
      60,
    );
  });

  it("emits committed edits and tool settings through the editor snapshot", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onEditorStateChange = vi.fn();
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );

    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(onEditorStateChange).toHaveBeenCalled();
    const committed = onEditorStateChange.mock.lastCall?.[0];
    expect(committed.shapes).toHaveLength(1);
    expect(committed.shapes[0]).toMatchObject({ kind: "pen" });
    expect(committed.past).toHaveLength(1);
    expect(committed.redo).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    const afterTool = onEditorStateChange.mock.lastCall?.[0];
    expect(afterTool.tool).toBe("arrow");
    expect(afterTool.shapes).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const afterUndo = onEditorStateChange.mock.lastCall?.[0];
    expect(afterUndo.shapes).toEqual([]);
    expect(afterUndo.redo).toHaveLength(1);
    expect(afterUndo.redo[0]).toHaveLength(1);

    Reflect.deleteProperty(HTMLCanvasElement.prototype, "setPointerCapture");
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "hasPointerCapture");
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "releasePointerCapture");
  });

  it("restores a persisted editor snapshot on remount and preserves undo history", async () => {
    const strokeRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      ellipse: vi.fn(),
      fillStyle: "",
      fillText: vi.fn(),
      font: "",
      lineCap: "round",
      lineJoin: "round",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeRect,
      strokeStyle: "",
      textBaseline: "top",
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    const rectShape = {
      color: "#3b82f6",
      from: { x: 10, y: 10 },
      id: "rect-1",
      kind: "rect" as const,
      to: { x: 50, y: 40 },
      width: 8,
    };
    const editor: BrowserScreenshotEditorSnapshot = {
      color: "#3b82f6",
      fontSize: 24,
      past: [[]],
      redo: [],
      shapes: [rectShape],
      tool: "arrow",
      width: 8,
    };
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        initialEditorState={editor}
      />,
    );

    expect(strokeRect).toHaveBeenCalledWith(10, 10, 40, 30);
    expect(
      screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Arrow" }).getAttribute("aria-pressed"),
    ).toBe("true");
    const widthSelect = screen.getByLabelText("Ink width") as HTMLSelectElement;
    expect(widthSelect.value).toBe("8");
    const fontSizeSelect = screen.getByLabelText("Text size") as HTMLSelectElement;
    expect(fontSizeSelect.value).toBe("24");
  });

  it("does not emit in-progress pointer strokes or uncommitted text as persisted state", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    const onEditorStateChange = vi.fn();
    render(
      <BrowserScreenshotAnnotation
        screenshotUrl="data:image/png;base64,AA=="
        onClose={() => {}}
        onEditorStateChange={onEditorStateChange}
      />,
    );

    const canvas = screen.getByLabelText("Drawing canvas") as HTMLCanvasElement;
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 20, pointerId: 1 });
    expect(onEditorStateChange).toHaveBeenCalledTimes(1);
    expect(onEditorStateChange.mock.lastCall?.[0].shapes).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 60,
      clientY: 60,
      pointerId: 2,
    });
    const input = screen.getByLabelText("Annotation text");
    fireEvent.change(input, { target: { value: "draft" } });
    expect(onEditorStateChange.mock.lastCall?.[0].shapes).toEqual([]);

    Reflect.deleteProperty(HTMLCanvasElement.prototype, "setPointerCapture");
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "hasPointerCapture");
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "releasePointerCapture");
  });
});
