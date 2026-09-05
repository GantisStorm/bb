import { useState, type FormEvent } from "react";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { formatRelativeTime } from "@/lib/relative-time";
import type { BrowserHistoryEntry } from "@/lib/browser-history";
import {
  LAUNCHER_ROW_BASE_CLASS,
  LAUNCHER_ROW_ICON_CLASS,
  LauncherRowTrailing,
  LauncherSectionHeader,
} from "./launcherRow";

interface BrowserNewTabScreenProps {
  onNavigateInput: (rawInput: string) => void;
  recent: readonly BrowserHistoryEntry[];
  onClearRecent: () => void;
}

interface BrowserRecentRowProps {
  entry: BrowserHistoryEntry;
  now: number;
  onNavigate: (url: string) => void;
}

function BrowserRecentRow({ entry, now, onNavigate }: BrowserRecentRowProps) {
  const host = getBrowserUrlHost(entry.url);
  const title = entry.title?.trim();
  const primary = title && title.length > 0 ? title : host;
  const relativeTime = formatRelativeTime({ timestamp: entry.visitedAt, now });

  return (
    <button
      type="button"
      onClick={() => onNavigate(entry.url)}
      title={entry.url}
      className={cn(LAUNCHER_ROW_BASE_CLASS, "hover:bg-state-hover")}
    >
      <span className={LAUNCHER_ROW_ICON_CLASS}>
        <Icon
          name="Browser"
          className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
          aria-hidden
        />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-foreground">{primary}</span>
        {primary !== host ? (
          <span className="truncate font-mono text-muted-foreground [flex-shrink:9999]">
            {host}
          </span>
        ) : null}
      </span>
      <LauncherRowTrailing idle={relativeTime} isActive={false} />
    </button>
  );
}

export function BrowserNewTabScreen({
  onNavigateInput,
  recent,
  onClearRecent,
}: BrowserNewTabScreenProps) {
  const [address, setAddress] = useState("");
  const now = Date.now();
  const hasRecent = recent.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input = address.trim();
    if (input.length === 0) return;
    onNavigateInput(input);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6 pt-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <section
          aria-labelledby="browser-new-tab-heading"
          className="flex flex-col items-center pt-8 text-center"
        >
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
            <Icon name="Globe" className="size-5" aria-hidden />
          </span>
          <h2
            id="browser-new-tab-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Browse the web
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter a website or search the web.
          </p>
          <form
            className="mt-5 flex w-full max-w-lg gap-2"
            onSubmit={handleSubmit}
          >
            <label className="sr-only" htmlFor="browser-new-tab-address">
              Website address or search
            </label>
            <div className="relative min-w-0 flex-1">
              <Icon
                name="Search"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="browser-new-tab-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Search or enter a website"
                className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              type="submit"
              disabled={address.trim().length === 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              Go
              <Icon name="ArrowRight" className="size-4" aria-hidden />
            </button>
          </form>
          <button
            type="button"
            onClick={() => onNavigateInput("https://www.google.com/")}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="Globe" className="size-3.5" aria-hidden />
            Google
          </button>
        </section>
        {hasRecent ? (
          <section>
            <LauncherSectionHeader
              label="Recently visited"
              count={recent.length}
              action={
                <button
                  type="button"
                  onClick={onClearRecent}
                  aria-label="Clear recently visited"
                  className={cn(
                    "rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    COARSE_POINTER_TEXT_SM_CLASS,
                  )}
                >
                  Clear
                </button>
              }
            />
            <ul aria-label="Recently visited" className="flex flex-col gap-px">
              {recent.map((entry) => (
                <li key={entry.url}>
                  <BrowserRecentRow
                    entry={entry}
                    now={now}
                    onNavigate={onNavigateInput}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
