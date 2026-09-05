import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { appToast } from "@/components/ui/app-toast";
import { copyImageToClipboardWithToast } from "@/lib/clipboard";
import type { BrowserScreenshotEditorSnapshot } from "./browserAnnotationState";

export type Tool = "pen" | "highlight" | "arrow" | "rect" | "ellipse" | "text";

type Point = { x: number; y: number };

type InkShape = {
  color: string;
  id: string;
  kind: "pen" | "highlight";
  points: Point[];
  width: number;
};

type ArrowShape = {
  color: string;
  from: Point;
  id: string;
  kind: "arrow";
  to: Point;
  width: number;
};

type BoxShape = {
  color: string;
  from: Point;
  id: string;
  kind: "rect" | "ellipse";
  to: Point;
  width: number;
};

type TextShape = {
  at: Point;
  color: string;
  fontSize: number;
  id: string;
  kind: "text";
  text: string;
};

export type Shape = InkShape | ArrowShape | BoxShape | TextShape;

type PendingText = { at: Point; id: string };

interface BrowserScreenshotAnnotationProps {
  screenshotUrl: string;
  onClose: () => void;
  initialEditorState?: BrowserScreenshotEditorSnapshot;
  onEditorStateChange?: (editor: BrowserScreenshotEditorSnapshot) => void;
}

const COLOR_OPTIONS = [
  { label: "Red ink", value: "#ef4444" },
  { label: "Orange ink", value: "#f97316" },
  { label: "Yellow ink", value: "#eab308" },
  { label: "Green ink", value: "#22c55e" },
  { label: "Blue ink", value: "#3b82f6" },
  { label: "Dark ink", value: "#111827" },
  { label: "White ink", value: "#ffffff" },
] as const;
const WIDTHS = [2, 4, 8];
const FONT_SIZES = [14, 18, 24, 32, 48];

function ScreenshotToolbarTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function normalizedRect(from: Point, to: Point) {
  return {
    height: Math.abs(to.y - from.y),
    width: Math.abs(to.x - from.x),
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
  };
}

function drawInk(context: CanvasRenderingContext2D, shape: InkShape): void {
  if (shape.points.length === 0) return;
  context.beginPath();
  context.globalAlpha = shape.kind === "highlight" ? 0.35 : 1;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth =
    shape.kind === "highlight" ? shape.width * 4 : shape.width;
  context.strokeStyle = shape.color;
  context.moveTo(shape.points[0].x, shape.points[0].y);
  for (const point of shape.points.slice(1)) context.lineTo(point.x, point.y);
  if (shape.points.length === 1) {
    context.lineTo(shape.points[0].x + 0.01, shape.points[0].y + 0.01);
  }
  context.stroke();
  context.globalAlpha = 1;
}

function drawArrow(context: CanvasRenderingContext2D, shape: ArrowShape): void {
  const { from, to, width } = shape;
  context.beginPath();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = width;
  context.strokeStyle = shape.color;
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  if (Number.isFinite(angle)) {
    const length = Math.max(10, width * 3.5);
    context.lineTo(
      to.x + length * Math.cos(angle + Math.PI - 0.45),
      to.y + length * Math.sin(angle + Math.PI - 0.45),
    );
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x + length * Math.cos(angle + Math.PI + 0.45),
      to.y + length * Math.sin(angle + Math.PI + 0.45),
    );
  }
  context.stroke();
}

function drawShape(context: CanvasRenderingContext2D, shape: Shape): void {
  if ("points" in shape) {
    drawInk(context, shape);
    return;
  }
  if (shape.kind === "text") {
    context.fillStyle = shape.color;
    context.font = `600 ${shape.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = "top";
    context.fillText(shape.text, shape.at.x, shape.at.y);
    return;
  }
  if (shape.kind === "arrow") {
    drawArrow(context, shape);
    return;
  }
  const rect = normalizedRect(shape.from, shape.to);
  context.beginPath();
  context.lineWidth = shape.width;
  context.strokeStyle = shape.color;
  if (shape.kind === "rect") {
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else {
    context.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
}

export function annotatedScreenshotBlob(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    return Promise.resolve(null);
  }
  const output = document.createElement("canvas");
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const context = output.getContext("2d");
  if (context === null) return Promise.resolve(null);
  context.drawImage(image, 0, 0, output.width, output.height);
  context.drawImage(
    canvas,
    0,
    0,
    canvas.width,
    canvas.height,
    0,
    0,
    output.width,
    output.height,
  );
  return new Promise((resolve) => output.toBlob(resolve, "image/png"));
}

export function BrowserScreenshotAnnotation({
  screenshotUrl,
  onClose,
  initialEditorState,
  onEditorStateChange,
}: BrowserScreenshotAnnotationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const activeShapeRef = useRef<Shape | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  const [color, setColor] = useState<string>(
    initialEditorState?.color ?? COLOR_OPTIONS[0].value,
  );
  const [fontSize, setFontSize] = useState(initialEditorState?.fontSize ?? 18);
  const [past, setPast] = useState<Shape[][]>(initialEditorState?.past ?? []);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [redo, setRedo] = useState<Shape[][]>(initialEditorState?.redo ?? []);
  const [shapes, setShapes] = useState<Shape[]>(
    initialEditorState?.shapes ?? [],
  );
  const [tool, setTool] = useState<Tool>(initialEditorState?.tool ?? "pen");
  const [width, setWidth] = useState(initialEditorState?.width ?? 4);

  useEffect(() => {
    onEditorStateChange?.({ color, fontSize, past, redo, shapes, tool, width });
  }, [color, fontSize, onEditorStateChange, past, redo, shapes, tool, width]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const bounds = canvas.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
    const pixelHeight = Math.max(
      1,
      Math.round(bounds.height * devicePixelRatio),
    );
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    for (const shape of shapesRef.current) drawShape(context, shape);
    if (activeShapeRef.current !== null)
      drawShape(context, activeShapeRef.current);
  }, []);

  useEffect(() => {
    shapesRef.current = shapes;
    redraw();
  }, [redraw, shapes]);

  useEffect(() => {
    const image = imageRef.current;
    if (image === null) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(image);
    return () => observer.disconnect();
  }, [redraw]);

  const commitShapes = useCallback((next: Shape[]) => {
    setShapes((current) => {
      setPast((history) => [...history, current]);
      setRedo([]);
      return next;
    });
  }, []);

  const pointForEvent = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0 || pendingText !== null) return;
      const point = pointForEvent(event);
      if (tool === "text") {
        setPendingText({ at: point, id: crypto.randomUUID() });
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      activeShapeRef.current =
        tool === "pen" || tool === "highlight"
          ? {
              color,
              id: crypto.randomUUID(),
              kind: tool,
              points: [point],
              width,
            }
          : {
              color,
              from: point,
              id: crypto.randomUUID(),
              kind: tool,
              to: point,
              width,
            };
      redraw();
    },
    [color, pendingText, pointForEvent, redraw, tool, width],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const active = activeShapeRef.current;
      if (
        active === null ||
        !event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        return;
      }
      const point = pointForEvent(event);
      if ("points" in active) {
        active.points.push(point);
      } else if ("to" in active) {
        active.to = point;
      }
      redraw();
    },
    [pointForEvent, redraw],
  );

  const commitActiveShape = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const active = activeShapeRef.current;
      activeShapeRef.current = null;
      if (active !== null) commitShapes([...shapesRef.current, active]);
      redraw();
    },
    [commitShapes, redraw],
  );

  const commitText = useCallback(
    (text: string) => {
      if (pendingText === null) return;
      const value = text.trim();
      if (value.length > 0) {
        commitShapes([
          ...shapesRef.current,
          {
            at: pendingText.at,
            color,
            fontSize,
            id: pendingText.id,
            kind: "text",
            text: value,
          },
        ]);
      }
      setPendingText(null);
    },
    [color, commitShapes, fontSize, pendingText],
  );

  const undo = useCallback(() => {
    setPast((history) => {
      const previous = history.at(-1);
      if (previous === undefined) return history;
      setShapes((current) => {
        setRedo((future) => [current, ...future]);
        return previous;
      });
      return history.slice(0, -1);
    });
  }, []);

  const redoLast = useCallback(() => {
    setRedo((future) => {
      const next = future[0];
      if (next === undefined) return future;
      setShapes((current) => {
        setPast((history) => [...history, current]);
        return next;
      });
      return future.slice(1);
    });
  }, []);

  const clear = useCallback(() => {
    if (shapesRef.current.length > 0) commitShapes([]);
    setPendingText(null);
  }, [commitShapes]);

  const copy = useCallback(async () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas === null || image === null) {
      appToast.error("Failed to copy annotated screenshot");
      return;
    }
    const blob = await annotatedScreenshotBlob(image, canvas);
    if (blob === null) {
      appToast.error("Failed to copy annotated screenshot");
      return;
    }
    await copyImageToClipboardWithToast(blob, {
      successMessage: "Annotated screenshot copied",
      errorMessage: "Failed to copy annotated screenshot",
    });
  }, []);

  const download = useCallback(async () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas === null || image === null) return;
    const blob = await annotatedScreenshotBlob(image, canvas);
    if (blob === null) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bb-browser-annotation.png";
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <section
      aria-label="Screenshot annotation"
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            Annotate screenshot
          </h2>
          <p className="text-xs text-muted-foreground">
            Draw on the page, then copy the PNG into chat.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close screenshot annotation"
          onClick={onClose}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="X" className="size-4" aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-recessed p-3">
        <div
          className="relative max-h-full max-w-full"
          style={{ aspectRatio: "auto" }}
        >
          <img
            ref={imageRef}
            src={screenshotUrl}
            alt="Captured browser page"
            draggable={false}
            onLoad={redraw}
            className="block max-h-full max-w-full select-none"
          />
          <canvas
            ref={canvasRef}
            aria-label="Drawing canvas"
            className="absolute inset-0 size-full touch-none cursor-crosshair"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={commitActiveShape}
            onPointerCancel={commitActiveShape}
          />
          {pendingText === null ? null : (
            <input
              autoFocus
              aria-label="Annotation text"
              className="absolute z-10 min-w-24 border-0 bg-transparent p-0 font-semibold leading-none outline-none"
              style={{
                color,
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                fontSize,
                left: pendingText.at.x,
                top: pendingText.at.y,
              }}
              onBlur={(event) => commitText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commitText(event.currentTarget.value);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPendingText(null);
                }
              }}
            />
          )}
        </div>
      </div>
      <TooltipProvider delayDuration={250}>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <div
            className="flex flex-wrap items-center gap-1"
            aria-label="Annotation tools"
          >
            {(
              [
                ["pen", "EditFile", "Pen"],
                ["highlight", "Palette", "Highlighter"],
                ["arrow", "ArrowUpRight", "Arrow"],
                ["rect", "Square", "Rectangle"],
                ["ellipse", "CircleArrowShrink", "Ellipse"],
                ["text", "TextWrap", "Text"],
              ] as const
            ).map(([kind, icon, label]) => (
              <ScreenshotToolbarTooltip key={kind} label={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={tool === kind}
                  onClick={() => setTool(kind)}
                  className={cn(
                    "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground",
                    tool === kind && "bg-state-hover text-foreground",
                  )}
                >
                  <Icon name={icon} className="size-4" aria-hidden />
                </button>
              </ScreenshotToolbarTooltip>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {COLOR_OPTIONS.map(({ label, value }) => (
              <ScreenshotToolbarTooltip key={value} label={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                  className={cn(
                    "size-5 rounded-full border-2 border-transparent transition-transform focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    color === value && "scale-110 border-foreground",
                  )}
                  style={{ backgroundColor: value }}
                />
              </ScreenshotToolbarTooltip>
            ))}
            <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
              Width
              <select
                aria-label="Ink width"
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
                className="h-7 rounded border border-border bg-background px-1 text-xs text-foreground"
              >
                {WIDTHS.map((option) => (
                  <option key={option} value={option}>
                    {option}px
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Text
              <select
                aria-label="Text size"
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
                className="h-7 rounded border border-border bg-background px-1 text-xs text-foreground"
              >
                {FONT_SIZES.map((option) => (
                  <option key={option} value={option}>
                    {option}px
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <ScreenshotToolbarTooltip label="Undo">
              <button
                type="button"
                aria-label="Undo"
                disabled={past.length === 0}
                onClick={undo}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon
                  name="ArrowTurnBackward"
                  className="size-3.5"
                  aria-hidden
                />
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Redo">
              <button
                type="button"
                aria-label="Redo"
                disabled={redo.length === 0}
                onClick={redoLast}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon
                  name="ArrowTurnForward"
                  className="size-3.5"
                  aria-hidden
                />
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Clear all annotations">
              <button
                type="button"
                aria-label="Clear all"
                disabled={shapes.length === 0}
                onClick={clear}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon name="Clean" className="size-3.5" aria-hidden />
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Copy annotated PNG">
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
              >
                <Icon name="Copy" className="size-3.5" aria-hidden />
                Copy PNG
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Save annotated PNG">
              <button
                type="button"
                onClick={() => void download()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Icon name="Download" className="size-3.5" aria-hidden />
                Save PNG
              </button>
            </ScreenshotToolbarTooltip>
          </div>
        </footer>
      </TooltipProvider>
    </section>
  );
}
