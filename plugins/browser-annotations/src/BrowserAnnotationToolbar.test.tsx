// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserAnnotationAnnotateAction,
  BrowserAnnotationGrabAction,
  BrowserAnnotationScreenshotAction,
} from "./BrowserAnnotationToolbar";
import type { PluginBrowserActionProps } from "@get-bb/plugin-sdk/app";
import {
  registerAnnotationToolbarController,
  type AnnotationControllerInteractionState,
  type AnnotationToolbarController,
} from "./annotation-toolbar-bridge";

function toolbarProps(
  overrides: Partial<PluginBrowserActionProps> = {},
): PluginBrowserActionProps {
  return {
    tabId: "tab-1",
    navigationEpoch: 7,
    threadId: "thread-1",
    projectId: "project-1",
    url: "https://example.test/page",
    ...overrides,
  };
}

function stubController(
  state: Omit<AnnotationControllerInteractionState, "browserControlAvailable"> &
    Partial<
      Pick<AnnotationControllerInteractionState, "browserControlAvailable">
    >,
): AnnotationToolbarController & { listeners: Set<() => void> } {
  const { browserControlAvailable = true, ...rest } = state;
  const interactionState: AnnotationControllerInteractionState = {
    ...rest,
    browserControlAvailable,
  };
  const listeners = new Set<() => void>();
  const api: AnnotationToolbarController & { listeners: Set<() => void> } = {
    listeners,
    getInteractionState: () => interactionState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startPicker: vi.fn(),
    cancelPicker: vi.fn(),
    startScreenshotEditor: vi.fn(),
  };
  registerAnnotationToolbarController("tab-1", api);
  return api;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrowserAnnotationToolbar", () => {
  it("disables actions while no controller is mounted for the tab", () => {
    const props = toolbarProps();
    render(
      <>
        <BrowserAnnotationScreenshotAction {...props} />
        <BrowserAnnotationGrabAction {...props} />
        <BrowserAnnotationAnnotateAction {...props} />
      </>,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Annotate screenshot",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Grab page element",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Select and annotate page element",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("toggles cancel while a picker is active", () => {
    const api = stubController({
      pickerMode: "grab",
      reviewOpen: false,
      editorOpen: false,
    });
    render(<BrowserAnnotationGrabAction {...toolbarProps()} />);
    const cancel = screen.getByRole("button", {
      name: "Cancel element selection",
    });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cancel);
    expect(api.cancelPicker).toHaveBeenCalledOnce();
  });

  it("disables screenshot while the editor or a picker overlay is open", () => {
    stubController({
      pickerMode: null,
      reviewOpen: false,
      editorOpen: true,
    });
    render(<BrowserAnnotationScreenshotAction {...toolbarProps()} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Annotate screenshot",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
