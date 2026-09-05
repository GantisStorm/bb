import {
  browserControlErrorSchema,
  browserPageLocatorSchema,
  browserTabTargetSchema,
  browserWaitCriteriaSchema,
  type BrowserControlAction,
  type BrowserControlError,
} from "@bb/server-contract";
import type {
  BbPluginApi,
  PluginAgentToolContext,
  PluginCliContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

const timeoutMsSchema = z.number().int().min(100).max(120_000).optional();
const BROWSER_BATCH_MAX_BYTES = 16 * 1024 * 1024;
const browserAgentPointerTargetSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("locator"),
      locator: browserPageLocatorSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("point"),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
    })
    .strict(),
]);

const agentBrowserControlActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("list-frames"),
      maxFrames: z.number().int().min(1).max(64).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("snapshot"),
      mode: z.enum(["dom", "interactive"]),
      maxNodes: z.number().int().min(1).max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("click"),
      target: browserAgentPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("hover"),
      target: browserAgentPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("double-click"),
      target: browserAgentPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("right-click"),
      target: browserAgentPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("middle-click"),
      target: browserAgentPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("drag"),
      from: browserAgentPointerTargetSchema,
      to: browserAgentPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      locator: browserPageLocatorSchema,
      text: z.string().max(65_536),
      clear: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("select"),
      locator: browserPageLocatorSchema,
      value: z.string().min(1).max(2_048),
    })
    .strict(),
  z
    .object({
      kind: z.literal("select-multiple"),
      locator: browserPageLocatorSchema,
      values: z.array(z.string().min(1).max(2_048)).min(1).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      locator: browserPageLocatorSchema,
      files: z
        .array(
          z
            .object({
              name: z.string().min(1).max(255),
              mimeType: z.string().max(255),
              base64: z.string().max(2_000_000),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
  z
    .object({ kind: z.literal("check"), locator: browserPageLocatorSchema })
    .strict(),
  z
    .object({ kind: z.literal("uncheck"), locator: browserPageLocatorSchema })
    .strict(),
  z
    .object({ kind: z.literal("focus"), locator: browserPageLocatorSchema })
    .strict(),
  z
    .object({
      kind: z.literal("scroll-into-view"),
      locator: browserPageLocatorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("annotate"),
      element: browserAgentPointerTargetSchema,
      intent: z.enum(["fix", "change", "question", "approve"]),
      feedback: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.string().min(1).max(64),
      code: z.string().min(1).max(64).optional(),
      modifiers: z
        .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
        .max(4)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scroll"),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      deltaX: z.number().finite().optional(),
      deltaY: z.number().finite().optional(),
      behavior: z.enum(["auto", "smooth"]).optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.x !== undefined ||
        value.y !== undefined ||
        value.deltaX !== undefined ||
        value.deltaY !== undefined,
      "scroll requires an absolute position or delta",
    ),
  z
    .object({
      kind: z.literal("navigate"),
      url: z.string().min(1).max(16_384),
    })
    .strict(),
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("forward") }).strict(),
  z.object({ kind: z.literal("reload") }).strict(),
  z
    .object({
      kind: z.literal("open-tab"),
      url: z.string().min(1).max(16_384),
    })
    .strict(),
  z
    .object({
      kind: z.literal("activate-tab"),
      tabId: z.string().min(1).max(256),
    })
    .strict(),
  z.object({ kind: z.literal("close-tab") }).strict(),
  z
    .object({
      kind: z.literal("set-viewport-profile"),
      profile: z.enum(["phone-390x844", "tablet-768x1024", "desktop-1280x720"]),
    })
    .strict(),
  z.object({ kind: z.literal("clear-viewport-profile") }).strict(),
  z
    .object({
      kind: z.literal("wait"),
      criteria: browserWaitCriteriaSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-dialog-handler"),
      behavior: z.enum(["accept", "dismiss"]),
      promptText: z.string().max(4_096).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set-permissions"),
      decision: z.enum(["allow", "deny"]),
      permissions: z
        .array(
          z.enum([
            "clipboard-read",
            "clipboard-sanitized-write",
            "display-capture",
            "fullscreen",
            "geolocation",
            "media",
            "notifications",
          ]),
        )
        .max(7),
    })
    .strict(),
  z.object({ kind: z.literal("diagnostics") }).strict(),
  z.object({ kind: z.literal("get-storage") }).strict(),
  z
    .object({
      kind: z.literal("set-storage"),
      local: z.record(z.string().max(256), z.string().max(65_536)),
      session: z.record(z.string().max(256), z.string().max(65_536)),
      cookies: z.array(z.string().min(1).max(4_096)).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clear-storage"),
      stores: z
        .array(z.enum(["local", "session", "cookies"]))
        .min(1)
        .max(3),
    })
    .strict(),
  z.object({ kind: z.literal("list-cookie-import-sources") }).strict(),
  z
    .object({
      kind: z.literal("import-cookies-from-browser"),
      family: z.string().min(1).max(64),
      profileId: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clear-imported-cookies"),
      confirm: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("screenshot"),
      format: z.enum(["png", "jpeg"]).optional(),
      quality: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("screenshot-full-page") }).strict(),
  z
    .object({
      kind: z.literal("screenshot-element"),
      locator: browserPageLocatorSchema,
      format: z.enum(["png", "jpeg"]),
      quality: z.number().int().min(1).max(100),
    })
    .strict(),
]);

const listOperationSchema = z
  .object({
    operation: z.literal("list"),
    threadId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const openOperationSchema = z
  .object({
    operation: z.literal("open"),
    url: z.string().min(1).max(16_384).optional(),
    clientId: z.string().min(1).max(128).optional(),
    windowId: z.string().min(1).max(128).optional(),
    ownerId: z.string().min(1).max(256).optional(),
    threadId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    timeoutMs: timeoutMsSchema,
  })
  .strict();

const runOperationSchema = z
  .object({
    operation: z.literal("run"),
    target: browserTabTargetSchema,
    action: agentBrowserControlActionSchema,
    timeoutMs: timeoutMsSchema,
  })
  .strict();
const batchOperationSchema = z
  .object({
    operation: z.literal("batch"),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            action: agentBrowserControlActionSchema,
            target: browserTabTargetSchema,
          })
          .strict(),
      )
      .min(1)
      .max(16),
    concurrency: z.number().int().min(1).max(4),
    timeoutMs: z.number().int().min(100).max(120_000),
  })
  .strict();

const scriptOperationSchema = z
  .object({
    operation: z.literal("script"),
    target: browserTabTargetSchema,
    code: z.string().min(1).max(65_536),
    timeoutMs: timeoutMsSchema,
  })
  .strict();

const waitOperationSchema = z
  .object({
    operation: z.literal("wait"),
    target: browserTabTargetSchema,
    criteria: browserWaitCriteriaSchema,
    timeoutMs: z.number().int().min(100).max(120_000),
  })
  .strict();

const diagnosticsOperationSchema = z
  .object({
    operation: z.literal("diagnostics"),
    target: browserTabTargetSchema,
    timeoutMs: timeoutMsSchema,
  })
  .strict();

export const browserOperationSchema = z
  .discriminatedUnion("operation", [
    listOperationSchema,
    openOperationSchema,
    runOperationSchema,
    batchOperationSchema,
    scriptOperationSchema,
    waitOperationSchema,
    diagnosticsOperationSchema,
  ])
  .superRefine((operation, context) => {
    if (operation.operation !== "batch") return;
    const ids = new Set(operation.items.map((item) => item.id));
    if (ids.size !== operation.items.length) {
      context.addIssue({
        code: "custom",
        message: "Browser batch item ids must be unique",
        path: ["items"],
      });
    }
    if (
      new TextEncoder().encode(JSON.stringify(operation)).byteLength >
      BROWSER_BATCH_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Browser batch request exceeds the aggregate byte limit",
      });
    }
  });
export type BrowserOperation = z.output<typeof browserOperationSchema>;

type BrowserContext = PluginAgentToolContext | PluginCliContext;
type BrowserAccess = Pick<BbPluginApi, "experimental_browser">;

function browserOperationError(error: unknown): BrowserControlError {
  let body: unknown = undefined;
  if (typeof error === "object" && error !== null && "body" in error) {
    body = error.body;
  }
  const parsed = browserControlErrorSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "Browser action failed";
  const code =
    error instanceof Error && error.name.length > 0 && error.name !== "Error"
      ? error.name
      : "browser_action_failed";
  return { code, message: message.slice(0, 2_048) };
}

const diagnosticsSource = `({ signal }) => {
  if (signal.aborted) throw signal.reason;
  const entries = performance.getEntriesByType("navigation");
  const navigation = entries.length === 0 ? null : entries[entries.length - 1];
  return {
    url: location.href,
    title: document.title || null,
    readyState: document.readyState,
    bodyText: (document.body?.innerText || "").slice(0, 16_384),
    navigation: navigation === null ? null : {
      type: navigation.type,
      duration: Math.round(navigation.duration),
      domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
      load: Math.round(navigation.loadEventEnd)
    }
  };
}`;

export async function executeBrowserOperation(args: {
  browser: BrowserAccess;
  context: BrowserContext;
  defaultHomepageUrl?: string;
  operation: BrowserOperation;
}): Promise<unknown> {
  const { browser, context, defaultHomepageUrl, operation } = args;
  if (operation.operation === "list") {
    const usesContextScope =
      operation.threadId === undefined && operation.projectId === undefined;
    const threadId = usesContextScope ? context.threadId : operation.threadId;
    const projectId = usesContextScope
      ? context.projectId
      : operation.projectId;
    const filter = {
      ...(threadId === null || threadId === undefined ? {} : { threadId }),
      ...(projectId === null || projectId === undefined ? {} : { projectId }),
      ...(operation.active === undefined ? {} : { active: operation.active }),
    };
    return {
      tabs: browser.experimental_browser.listTabs(context, filter),
      owners: browser.experimental_browser.listOwners(context, filter),
    };
  }
  if (operation.operation === "open") {
    return browser.experimental_browser.openTab(
      context,
      operation.url ?? defaultHomepageUrl ?? "https://www.google.com/",
      {
        ...(operation.clientId === undefined
          ? {}
          : { clientId: operation.clientId }),
        ...(operation.windowId === undefined
          ? {}
          : { windowId: operation.windowId }),
        ...(operation.ownerId === undefined
          ? {}
          : { ownerId: operation.ownerId }),
        ...(operation.threadId === undefined
          ? {}
          : { threadId: operation.threadId }),
        ...(operation.projectId === undefined
          ? {}
          : { projectId: operation.projectId }),
        ...(operation.timeoutMs === undefined
          ? {}
          : { timeoutMs: operation.timeoutMs }),
      },
    );
  }
  if (operation.operation === "run") {
    return browser.experimental_browser.run(
      operation.target,
      operation.action,
      {
        context,
        timeoutMs: operation.timeoutMs,
      },
    );
  }
  if (operation.operation === "wait") {
    return browser.experimental_browser.run(
      operation.target,
      {
        kind: "wait",
        criteria: operation.criteria,
      },
      {
        context,
        timeoutMs: operation.timeoutMs,
      },
    );
  }
  if (operation.operation === "batch") {
    const results = [];
    let responseBytes = 0;
    for (
      let offset = 0;
      offset < operation.items.length;
      offset += operation.concurrency
    ) {
      const group = operation.items.slice(
        offset,
        offset + operation.concurrency,
      );
      const groupResults = await Promise.all(
        group.map(async (item) => {
          try {
            const value = await browser.experimental_browser.run(
              item.target,
              item.action,
              { context, timeoutMs: operation.timeoutMs },
            );
            return { id: item.id, ok: true as const, value };
          } catch (error) {
            return {
              id: item.id,
              ok: false as const,
              error: browserOperationError(error),
            };
          }
        }),
      );
      for (const result of groupResults) {
        const bytes = new TextEncoder().encode(
          JSON.stringify(result),
        ).byteLength;
        if (responseBytes + bytes > BROWSER_BATCH_MAX_BYTES) {
          results.push({
            id: result.id,
            ok: false,
            error: {
              code: "browser_batch_response_too_large",
              message:
                "Browser batch response exceeded the aggregate byte limit",
            },
          });
        } else {
          results.push(result);
          responseBytes += bytes;
        }
      }
    }
    return { results };
  }
  if (operation.operation === "script") {
    const action: BrowserControlAction = {
      kind: "script",
      source: operation.code,
      input: null,
      timeoutMs: operation.timeoutMs ?? 30_000,
    };
    return browser.experimental_browser.run(operation.target, action, {
      context,
      timeoutMs: operation.timeoutMs,
    });
  }
  const timeoutMs = operation.timeoutMs ?? 30_000;
  const [native, page] = await Promise.all([
    browser.experimental_browser.run(
      operation.target,
      { kind: "diagnostics" },
      { context, timeoutMs },
    ),
    browser.experimental_browser.run(
      operation.target,
      {
        kind: "script",
        source: diagnosticsSource,
        input: null,
        timeoutMs,
      },
      { context, timeoutMs },
    ),
  ]);
  return { native, page };
}
