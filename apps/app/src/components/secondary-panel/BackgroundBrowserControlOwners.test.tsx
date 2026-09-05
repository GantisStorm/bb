// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const browserControl = vi.hoisted(() => ({
  activator: null as null | {
    activate(args: {
      projectId: string;
      signal: AbortSignal;
      threadId: string;
    }): Promise<void>;
  },
  registerOwner: vi.fn(),
}));

vi.mock("jotai", () => ({ useAtomValue: () => null }));
vi.mock("@/lib/split-layout/atoms", () => ({ splitLayoutAtom: {} }));
vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ projectId: undefined, threadId: undefined }),
}));
vi.mock("@/lib/bb-desktop", () => ({
  isDesktopBrowserAvailable: () => true,
}));
vi.mock("@/lib/browser-control-client", () => ({
  registerBrowserControlOwner: (args: unknown) => {
    browserControl.registerOwner(args);
    return { dispose: vi.fn(), updateTabs: vi.fn() };
  },
  registerBrowserThreadOwnerActivator: (
    activator: typeof browserControl.activator,
  ) => {
    browserControl.activator = activator;
    return { dispose: vi.fn() };
  },
  waitForBrowserControlTab: vi.fn(),
}));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: (threadId: string) => ({
    data: {
      id: threadId,
      environmentId: "env-1",
      projectId: "project-a",
    },
  }),
}));
vi.mock("./useThreadFileTabs", () => ({
  useThreadFileTabs: () => ({
    activateTab: vi.fn(),
    activeBrowserTab: null,
    browserTabs: [],
    closeTab: vi.fn(),
    openTab: vi.fn(),
    updateBrowserTab: vi.fn(),
  }),
}));

import { BackgroundBrowserControlOwners } from "./BackgroundBrowserControlOwners";

describe("BackgroundBrowserControlOwners", () => {
  beforeEach(() => {
    browserControl.activator = null;
    browserControl.registerOwner.mockClear();
  });

  it("registers an unmounted destination without changing the visible layout", async () => {
    const view = render(<BackgroundBrowserControlOwners />);
    await waitFor(() => expect(browserControl.activator).not.toBeNull());

    await act(async () => {
      await browserControl.activator?.activate({
        projectId: "project-a",
        signal: new AbortController().signal,
        threadId: "thread-background",
      });
    });

    await waitFor(() =>
      expect(browserControl.registerOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          active: false,
          ownerId: "background-thread:thread-background",
          projectId: "project-a",
          threadId: "thread-background",
        }),
      ),
    );
    expect(view.container.textContent).toBe("");
  });
});
