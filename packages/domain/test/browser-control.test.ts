import { describe, expect, it } from "vitest";
import {
  browserClientStateMessageSchema,
  browserControlActionSchema,
  browserOpenTabRequestMessageSchema,
  browserOpenTabResponseMessageSchema,
  isAllowedBrowserNavigationUrl,
} from "../src/browser-control.js";
const target = {
  clientId: "client-a",
  windowId: "window-a",
  tabId: "tab-a",
  navigationEpoch: 0,
};

describe("Browser tab owner messages", () => {
  it("advertises a panel owner before it has any tabs", () => {
    expect(
      browserClientStateMessageSchema.parse({
        type: "browser-client-state",
        clientId: target.clientId,
        windowId: target.windowId,
        active: true,
        canActivateThreadOwner: true,
        tabs: [],
        owners: [
          {
            ownerId: "owner-a",
            threadId: "thread-a",
            projectId: "project-a",
            active: true,
          },
        ],
      }),
    ).toMatchObject({ tabs: [], owners: [{ ownerId: "owner-a" }] });
  });
  it("accepts inactive tab inventory entries without actionable state", () => {
    const state = browserClientStateMessageSchema.parse({
      type: "browser-client-state",
      clientId: target.clientId,
      windowId: target.windowId,
      active: true,
      canActivateThreadOwner: false,
      owners: [],
      tabs: [
        {
          tabId: "tab-inactive",
          threadId: "thread-a",
          projectId: "project-a",
          url: "https://example.test/",
          title: "Inactive",
          connected: false,
          active: false,
          navigationEpoch: 0,
        },
      ],
    });
    expect(state.tabs[0]).toMatchObject({
      tabId: "tab-inactive",
      connected: false,
      active: false,
    });
  });

  it("binds targetless open requests and responses to an exact owner", () => {
    const request = browserOpenTabRequestMessageSchema.parse({
      type: "browser-open-tab-request",
      mode: "owner",
      requestId: "request-a",
      clientId: target.clientId,
      windowId: target.windowId,
      ownerId: "owner-a",
      url: "file:///Users/test/page.html",
    });
    expect(request.mode).toBe("owner");
    if (request.mode !== "owner") {
      throw new Error("Expected owner-bound Browser open request");
    }
    expect(request.ownerId).toBe("owner-a");
    expect(
      browserOpenTabResponseMessageSchema.parse({
        type: "browser-open-tab-response",
        requestId: request.requestId,
        clientId: request.clientId,
        windowId: request.windowId,
        ownerId: request.ownerId,
        ok: true,
        target,
      }),
    ).toMatchObject({ ok: true, target });
    expect(
      browserOpenTabResponseMessageSchema.safeParse({
        type: "browser-open-tab-response",
        requestId: request.requestId,
        clientId: request.clientId,
        windowId: request.windowId,
        ownerId: request.ownerId,
        ok: true,
      }).success,
    ).toBe(false);
  });
});
describe("Browser automation boundaries", () => {
  it("rejects executable and credentialed file navigation", () => {
    expect(isAllowedBrowserNavigationUrl("https://example.test/")).toBe(true);
    expect(isAllowedBrowserNavigationUrl("file:///Users/test/page.html")).toBe(
      true,
    );
    expect(isAllowedBrowserNavigationUrl("javascript:alert(1)")).toBe(false);
    expect(
      isAllowedBrowserNavigationUrl(
        "file://user:password@localhost/Users/test/page.html",
      ),
    ).toBe(false);
  });

  it("parses expanded Browser actions and enforces destructive confirmation", () => {
    expect(
      [
        {
          kind: "upload",
          locator: {
            frame: { frameId: "frame-a", documentEpoch: 1 },
            role: "textbox",
            name: "Upload",
          },
          files: [
            {
              name: "input.txt",
              mimeType: "text/plain",
              base64: "aGVsbG8=",
            },
          ],
        },
        {
          kind: "wait",
          criteria: { kind: "text", text: "Complete" },
        },
        {
          kind: "set-dialog-handler",
          behavior: "accept",
          promptText: "approved",
        },
        { kind: "list-cookie-import-sources" },
        {
          kind: "import-cookies-from-browser",
          family: "chrome",
          profileId: "Default",
        },
        { kind: "clear-imported-cookies", confirm: true },
      ].every((action) => browserControlActionSchema.safeParse(action).success),
    ).toBe(true);
    expect(
      browserControlActionSchema.safeParse({
        kind: "clear-imported-cookies",
        confirm: false,
      }).success,
    ).toBe(false);
  });
});
