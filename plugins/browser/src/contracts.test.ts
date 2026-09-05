import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  BrowserControlAction,
  BrowserTabDescriptor,
  BrowserTabOwnerDescriptor,
  BrowserTabTarget,
} from "@bb/server-contract";
import type {
  PluginAgentToolContext,
  PluginBrowserOpenOptions,
} from "@get-bb/plugin-sdk";
import {
  browserOperationSchema,
  executeBrowserOperation,
} from "./contracts.js";

const target: BrowserTabTarget = {
  clientId: "client-a",
  windowId: "window-a",
  tabId: "tab-a",
  navigationEpoch: 4,
};

const tab: BrowserTabDescriptor = {
  ...target,
  threadId: "thread-a",
  projectId: "project-a",
  url: "https://example.com",
  title: "Example",
  connected: true,
  active: true,
};

const owner: BrowserTabOwnerDescriptor = {
  active: true,
  clientId: target.clientId,
  windowId: target.windowId,
  ownerId: "owner-a",
  threadId: tab.threadId,
  projectId: tab.projectId,
};

const agentContext: PluginAgentToolContext = {
  threadId: "thread-a",
  projectId: "project-a",
  signal: new AbortController().signal,
};

describe("Browser operation contract", () => {
  it("keeps the agent tool schema nonrecursive", () => {
    expect(
      JSON.stringify(z.toJSONSchema(browserOperationSchema)),
    ).not.toContain('"$ref"');
  });

  it("routes agent operations through the native browser service", async () => {
    const calls: Array<{
      target: BrowserTabTarget;
      action: BrowserControlAction;
      timeoutMs: number | undefined;
    }> = [];
    const openCalls: Array<{
      url: string;
      options: PluginBrowserOpenOptions;
    }> = [];
    const listTabsFilters: Array<{
      threadId?: string;
      projectId?: string;
      active?: boolean;
    }> = [];
    const listOwnerFilters: Array<{
      threadId?: string;
      projectId?: string;
      active?: boolean;
    }> = [];
    const browser = {
      experimental_browser: {
        listTabs(
          _context: PluginAgentToolContext,
          filter?: { threadId?: string; projectId?: string; active?: boolean },
        ) {
          listTabsFilters.push(filter ?? {});
          return [tab];
        },
        listOwners(
          _context: PluginAgentToolContext,
          filter?: { threadId?: string; projectId?: string; active?: boolean },
        ) {
          listOwnerFilters.push(filter ?? {});
          return [owner];
        },
        async openTab(
          _context: PluginAgentToolContext,
          url: string,
          options: PluginBrowserOpenOptions = {},
        ): Promise<BrowserTabTarget> {
          openCalls.push({ url, options });
          return target;
        },
        async run(
          nextTarget: BrowserTabTarget,
          action: BrowserControlAction,
          options: {
            context: PluginAgentToolContext;
            timeoutMs?: number;
          },
        ) {
          calls.push({
            target: nextTarget,
            action,
            timeoutMs: options.timeoutMs,
          });
          return { captured: true };
        },
      },
    };
    const operation = browserOperationSchema.parse({
      operation: "run",
      target,
      action: { kind: "snapshot", mode: "interactive" },
    });

    await executeBrowserOperation({
      browser,
      context: agentContext,
      operation,
    });
    await executeBrowserOperation({
      browser,
      context: agentContext,
      operation: browserOperationSchema.parse({ operation: "list" }),
    });
    await executeBrowserOperation({
      browser,
      context: agentContext,
      operation: browserOperationSchema.parse({
        operation: "open",
        projectId: "project-b",
        threadId: "thread-b",
        url: "file:///Users/test/page.html",
      }),
    });
    await executeBrowserOperation({
      browser,
      context: agentContext,
      defaultHomepageUrl: "https://search.example/",
      operation: browserOperationSchema.parse({
        operation: "open",
      }),
    });

    expect(listTabsFilters).toEqual([
      { threadId: "thread-a", projectId: "project-a" },
    ]);
    expect(listOwnerFilters).toEqual([
      { threadId: "thread-a", projectId: "project-a" },
    ]);
    expect(calls).toEqual([
      {
        target,
        action: { kind: "snapshot", mode: "interactive" },
        timeoutMs: undefined,
      },
    ]);
    expect(openCalls).toEqual([
      {
        url: "file:///Users/test/page.html",
        options: { projectId: "project-b", threadId: "thread-b" },
      },
      { url: "https://search.example/", options: {} },
    ]);
  });

  it("rejects ambiguous agent targets before service dispatch", () => {
    expect(
      browserOperationSchema.safeParse({
        operation: "run",
        target: {
          clientId: target.clientId,
          windowId: target.windowId,
          tabId: target.tabId,
        },
        action: { kind: "snapshot", mode: "interactive" },
      }).success,
    ).toBe(false);
  });
});
