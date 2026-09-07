import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  type ExperimentalBrowserControllerProps,
  type ExperimentalBrowserCookieImportSource,
  type PluginBrowserActionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  PersistentResponsiveDrawerShell,
  usePersistentOverlayFocus,
  useResponsiveDrawerRealization,
  useResponsiveRoot,
} from "@bb/shared-ui/responsive-overlay";
import { BrowserCookieImportWizard } from "./BrowserCookieImportWizard";
import { parseBrowserCookieImport } from "./browser-cookie-import";
import {
  browserCookieImportRecordSnapshot,
  setBrowserCookieImportRecord,
  subscribeBrowserCookieImportRecord,
  type BrowserCookieImportRecord,
} from "./browser-cookie-import-state";

const controllers = new Map<string, { open: () => void }>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  for (const listener of listeners) listener();
}

export function BrowserImportAction(props: PluginBrowserActionProps) {
  const controller = useSyncExternalStore(
    subscribe,
    () => controllers.get(props.tabId) ?? null,
    () => null,
  );
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Import browser session"
      disabled={controller === null}
      onClick={() => controller?.open()}
      className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
    >
      <Icon name="File" aria-hidden />
      Import
    </Button>
  );
}

export function BrowserImportController(
  props: ExperimentalBrowserControllerProps,
) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<
    ExperimentalBrowserCookieImportSource[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"import" | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error" | null>(null);
  const currentImport = useSyncExternalStore(
    subscribeBrowserCookieImportRecord,
    browserCookieImportRecordSnapshot,
    () => null,
  );
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const lifecycleGeneration = useRef(0);
  const openRef = useRef(false);
  const busyRef = useRef<"import" | "clear" | null>(null);
  const runtime = useRef(props);
  runtime.current = props;
  const close = useCallback(() => {
    generation.current++;
    openRef.current = false;
    setOpen(false);
    setLoading(false);
    runtime.current.experimental_setOverlayOpen(false);
  }, []);
  const changeOpen = useCallback(
    (next: boolean) => {
      if (!next) close();
    },
    [close],
  );
  const { isCompactViewport, onOpenChange } = useResponsiveRoot(
    open,
    changeOpen,
  );
  const { isContentRealized } = useResponsiveDrawerRealization({
    open,
    enabled: isCompactViewport,
  });
  usePersistentOverlayFocus({
    open: open && !isCompactViewport,
    panelRef: panel,
    requestClose: close,
  });
  useEffect(() => {
    const signal = props.experimental_lifecycleSignal;
    const dispose = () => {
      lifecycleGeneration.current++;
      busyRef.current = null;
      setBusy(null);
      close();
    };
    signal.addEventListener("abort", dispose);
    if (signal.aborted) dispose();
    return () => {
      signal.removeEventListener("abort", dispose);
      dispose();
    };
  }, [props.experimental_lifecycleSignal, close]);
  useEffect(() => {
    const target = props.target;
    if (
      target === null ||
      props.experimental_sessionImport === null ||
      (!props.isVisible && !open) ||
      props.experimental_lifecycleSignal.aborted
    )
      return;
    const controller = {
      open: () => {
        if (openRef.current) return;
        const native = runtime.current.experimental_sessionImport;
        if (native === null) return;
        openRef.current = true;
        const ticket = ++generation.current;
        setOpen(true);
        runtime.current.experimental_setOverlayOpen(true);
        setSources(null);
        setSourceError(null);
        setMessage(null);
        setTone(null);
        setLoading(true);
        void native
          .listSources()
          .then(
            (result) => {
              if (ticket === generation.current) setSources(result.sources);
            },
            (error) => {
              if (ticket !== generation.current) return;
              setSources([]);
              setSourceError(
                error instanceof Error
                  ? error.message
                  : "Could not find browser profiles",
              );
            },
          )
          .finally(() => {
            if (ticket === generation.current) setLoading(false);
          });
      },
    };
    controllers.set(target.tabId, controller);
    notify();
    return () => {
      if (controllers.get(target.tabId) === controller) {
        controllers.delete(target.tabId);
        notify();
      }
    };
  }, [
    props.target,
    props.experimental_sessionImport,
    props.experimental_lifecycleSignal,
    props.isVisible,
    open,
  ]);

  async function mutate(
    kind: "import" | "clear",
    operation: () => Promise<BrowserCookieImportRecord | null>,
  ) {
    if (
      busyRef.current !== null ||
      !openRef.current ||
      runtime.current.experimental_lifecycleSignal.aborted
    )
      return;
    const ticket = lifecycleGeneration.current;
    busyRef.current = kind;
    setBusy(kind);
    setMessage(null);
    setTone(null);
    try {
      const record = await operation();
      if (ticket !== lifecycleGeneration.current) return;
      setBrowserCookieImportRecord(record);
      setTone("success");
      setMessage(
        record === null
          ? "Cleared imported browser session"
          : `Imported ${record.importedCookies} ${record.importedCookies === 1 ? "cookie" : "cookies"}`,
      );
    } catch (error) {
      if (ticket !== lifecycleGeneration.current) return;
      setTone("error");
      setMessage(
        error instanceof Error ? error.message : "Cookie import failed",
      );
    } finally {
      if (ticket === lifecycleGeneration.current) {
        busyRef.current = null;
        setBusy(null);
      }
    }
  }
  const native = props.experimental_sessionImport;
  const content = (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Cookie JSON file"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file || !native) return;
          const lifecycle = lifecycleGeneration.current;
          void mutate("import", async () => {
            const text = await file.text();
            if (lifecycle !== lifecycleGeneration.current) {
              throw new DOMException(
                "Import controller was disposed",
                "AbortError",
              );
            }
            const source: unknown = JSON.parse(text);
            const result = await native.importCookies(
              parseBrowserCookieImport(source),
            );
            return {
              kind: "file",
              fileName: file.name,
              importedCookies: result.importedCookies,
            };
          });
        }}
      />
      <BrowserCookieImportWizard
        currentImport={currentImport}
        isClearing={busy === "clear"}
        isImporting={busy === "import"}
        isLoadingSources={loading}
        sourceError={sourceError}
        message={message}
        messageTone={tone}
        sources={sources}
        onClose={close}
        onImportFromFile={() => input.current?.click()}
        onClear={() => {
          if (native)
            void mutate("clear", async () => {
              await native.clear();
              return null;
            });
        }}
        onImportFromBrowser={(family, profileId) => {
          if (!native) return;
          void mutate("import", async () => {
            const source = sources?.find(
              (candidate) => candidate.family === family,
            );
            const profile = source?.profiles.find(
              (candidate) => candidate.id === profileId,
            );
            const result = await native.importFromBrowser({
              family,
              profileId,
            });
            return {
              kind: "browser",
              family,
              profileId,
              sourceLabel: source?.label ?? family,
              profileLabel: profile?.label ?? profileId,
              importedCookies: result.importedCookies,
            };
          });
        }}
      />
    </>
  );
  if (props.experimental_overlayRoot === null) return null;
  return createPortal(
    isCompactViewport ? (
      <PersistentResponsiveDrawerShell
        open={open}
        onOpenChange={onOpenChange}
        srLabel="Import browser session"
        contentClassName="h-[90dvh] overflow-hidden"
      >
        {isContentRealized ? (
          <div className="relative flex min-h-0 flex-1 flex-col">{content}</div>
        ) : null}
      </PersistentResponsiveDrawerShell>
    ) : open ? (
      <div
        ref={panel}
        role="dialog"
        aria-label="Import browser session"
        tabIndex={-1}
        className="pointer-events-auto absolute inset-0 z-30 outline-none"
      >
        {content}
      </div>
    ) : null,
    props.experimental_overlayRoot,
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_browserAction({
    id: "import-session",
    title: "Import browser session",
    component: BrowserImportAction,
  });
  app.slots.experimental_browserController({
    id: "session-import",
    component: BrowserImportController,
  });
});
