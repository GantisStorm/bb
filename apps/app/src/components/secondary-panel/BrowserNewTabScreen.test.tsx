// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserNewTabScreen } from "./BrowserNewTabScreen";

afterEach(cleanup);

describe("BrowserNewTabScreen", () => {
  it("provides a website entry point before any history exists", () => {
    const onNavigateInput = vi.fn();

    render(
      <BrowserNewTabScreen
        recent={[]}
        onClearRecent={vi.fn()}
        onNavigateInput={onNavigateInput}
      />,
    );

    expect(screen.getByRole("heading", { name: "Browse the web" })).toBeDefined();
    fireEvent.change(screen.getByLabelText("Website address or search"), {
      target: { value: "google.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(onNavigateInput).toHaveBeenCalledWith("google.com");
  });

  it("opens Google from the new-tab shortcut", () => {
    const onNavigateInput = vi.fn();

    render(
      <BrowserNewTabScreen
        recent={[]}
        onClearRecent={vi.fn()}
        onNavigateInput={onNavigateInput}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    expect(onNavigateInput).toHaveBeenCalledWith("https://www.google.com/");
  });
});
