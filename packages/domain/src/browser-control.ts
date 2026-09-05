import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";

export const BROWSER_CONTROL_MAX_SCRIPT_SOURCE_BYTES = 64 * 1024;
export const BROWSER_CONTROL_MAX_INPUT_BYTES = 64 * 1024;
export const BROWSER_CONTROL_MAX_RESULT_BYTES = 9 * 1024 * 1024;
export const BROWSER_CONTROL_MIN_TIMEOUT_MS = 100;
export const BROWSER_CONTROL_MAX_TIMEOUT_MS = 120_000;
export const BROWSER_CONTROL_MAX_FRAME_ID_LENGTH = 128;
export const BROWSER_CONTROL_MAX_FRAMES = 64;

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function isAllowedBrowserNavigationUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "http:" ||
    parsed.protocol === "https:" ||
    (parsed.protocol === "file:" &&
      (parsed.hostname === "" || parsed.hostname === "localhost") &&
      parsed.username === "" &&
      parsed.password === "")
  );
}

export const browserFrameTargetSchema = z
  .object({
    frameId: z.string().min(1).max(BROWSER_CONTROL_MAX_FRAME_ID_LENGTH),
    documentEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserFrameTarget = z.infer<typeof browserFrameTargetSchema>;

export const browserFrameDescriptorSchema = z
  .object({
    frameId: z.string().min(1).max(BROWSER_CONTROL_MAX_FRAME_ID_LENGTH),
    documentEpoch: z.number().int().nonnegative(),
    parentFrameId: z
      .string()
      .min(1)
      .max(BROWSER_CONTROL_MAX_FRAME_ID_LENGTH)
      .nullable(),
    url: z.string().max(4_096),
    name: z.string().max(256).nullable(),
    depth: z.number().int().nonnegative().max(8),
  })
  .strict();
export type BrowserFrameDescriptor = z.infer<
  typeof browserFrameDescriptorSchema
>;

const browserLocatorFrameSchema = z.object({
  frame: browserFrameTargetSchema.optional(),
});

const browserCssLocatorSchema = z
  .object({
    selectors: z.array(z.string().min(1).max(2_048)).min(1).max(8),
    ...browserLocatorFrameSchema.shape,
  })
  .strict();
const browserAccessibilityLocatorSchema = z
  .object({
    role: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(512).optional(),
    ...browserLocatorFrameSchema.shape,
  })
  .strict();
export const browserPageLocatorSchema = z.union([
  browserCssLocatorSchema,
  browserAccessibilityLocatorSchema,
]);
export type BrowserPageLocator = z.infer<typeof browserPageLocatorSchema>;

export const browserTabDescriptorSchema = z
  .object({
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    threadId: z.string().min(1).max(256).nullable(),
    projectId: z.string().min(1).max(256).nullable(),
    url: z.string().max(16_384),
    title: z.string().max(2_048).nullable(),
    connected: z.boolean(),
    active: z.boolean(),
    navigationEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserTabDescriptor = z.infer<typeof browserTabDescriptorSchema>;

export const browserTabOwnerDescriptorSchema = z
  .object({
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    ownerId: z.string().min(1).max(256),
    threadId: z.string().min(1).max(256).nullable(),
    projectId: z.string().min(1).max(256).nullable(),
    active: z.boolean(),
  })
  .strict();
export type BrowserTabOwnerDescriptor = z.infer<
  typeof browserTabOwnerDescriptorSchema
>;

export const browserTabTargetSchema = browserTabDescriptorSchema.pick({
  clientId: true,
  windowId: true,
  tabId: true,
  navigationEpoch: true,
});
export type BrowserTabTarget = z.infer<typeof browserTabTargetSchema>;

const locatorTargetSchema = z
  .object({ target: z.literal("locator"), locator: browserPageLocatorSchema })
  .strict();
const pointTargetSchema = z
  .object({
    target: z.literal("point"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })
  .strict();
export const browserPointerTargetSchema = z.discriminatedUnion("target", [
  locatorTargetSchema,
  pointTargetSchema,
]);
export type BrowserPointerTarget = z.infer<typeof browserPointerTargetSchema>;

export const browserViewportProfileSchema = z.enum([
  "phone-390x844",
  "tablet-768x1024",
  "desktop-1280x720",
]);
export type BrowserViewportProfile = z.infer<
  typeof browserViewportProfileSchema
>;

export const browserWaitUrlMatchSchema = z.enum(["exact", "glob"]);
export type BrowserWaitUrlMatch = z.infer<typeof browserWaitUrlMatchSchema>;

const browserWaitUrlSchema = z
  .object({
    url: z.string().min(1).max(4_096),
    match: browserWaitUrlMatchSchema,
  })
  .strict();

export const browserWaitCriteriaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("locator"),
      locator: browserPageLocatorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      text: z.string().min(1).max(2_048),
      frame: browserFrameTargetSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("url"),
      ...browserWaitUrlSchema.shape,
    })
    .strict(),
  z
    .object({
      kind: z.literal("navigation"),
      phase: z.enum(["start", "commit"]),
      sameDocument: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("load-state"),
      document: z.enum(["current", "next"]),
      state: z.enum(["domcontentloaded", "load", "networkidle"]),
    })
    .strict(),
  z.object({ kind: z.literal("popup") }).strict(),
  z
    .object({
      kind: z.literal("request"),
      ...browserWaitUrlSchema.shape,
      method: z.string().trim().min(1).max(16).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("response"),
      ...browserWaitUrlSchema.shape,
      method: z.string().trim().min(1).max(16).optional(),
      status: z.number().int().min(100).max(599).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("download-blocked") }).strict(),
]);
export type BrowserWaitCriteria = z.infer<typeof browserWaitCriteriaSchema>;

export const browserWaitResultSchema = z
  .object({
    kind: z.enum([
      "locator",
      "text",
      "url",
      "navigation",
      "load-state",
      "popup",
      "request",
      "response",
      "download-blocked",
    ]),
    target: browserTabTargetSchema,
    originalTarget: browserTabTargetSchema.optional(),
    observedTarget: browserTabTargetSchema.optional(),
    url: z.string().max(4_096).optional(),
    method: z.string().max(16).optional(),
    status: z.number().int().min(100).max(599).optional(),
    phase: z.enum(["start", "commit", "complete"]).optional(),
    state: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
    sameDocument: z.boolean().optional(),
    blocked: z.boolean().optional(),
  })
  .strict();
export type BrowserWaitResult = z.infer<typeof browserWaitResultSchema>;

export function isBrowserTransitionWaitAction(action: {
  kind: "wait";
  criteria: BrowserWaitCriteria;
}): boolean {
  return (
    action.criteria.kind === "url" ||
    action.criteria.kind === "navigation" ||
    (action.criteria.kind === "load-state" &&
      action.criteria.document === "next")
  );
}

export const browserActionabilityPolicySchema = z
  .object({
    timeoutMs: z
      .number()
      .int()
      .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
      .max(BROWSER_CONTROL_MAX_TIMEOUT_MS),
    pollIntervalMs: z.number().int().min(16).max(250),
    stableFrameCount: z.number().int().min(1).max(4),
  })
  .strict();
export type BrowserActionabilityPolicy = z.infer<
  typeof browserActionabilityPolicySchema
>;

export const browserControlErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2_048),
    details: jsonValueSchema
      .refine(
        (value) => jsonByteLength(value) <= 8_192,
        "Browser error details are too large",
      )
      .optional(),
  })
  .strict();
export type BrowserControlError = z.infer<typeof browserControlErrorSchema>;

export const browserControlActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("list-frames"),
      maxFrames: z
        .number()
        .int()
        .min(1)
        .max(BROWSER_CONTROL_MAX_FRAMES)
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("snapshot"),
      mode: z.enum(["dom", "interactive"]),
      maxNodes: z.number().int().min(1).max(2_000).optional(),
      frame: browserFrameTargetSchema.optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("click"), target: browserPointerTargetSchema })
    .strict(),
  z
    .object({ kind: z.literal("hover"), target: browserPointerTargetSchema })
    .strict(),
  z
    .object({
      kind: z.literal("double-click"),
      target: browserPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("right-click"),
      target: browserPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("middle-click"),
      target: browserPointerTargetSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("drag"),
      from: browserPointerTargetSchema,
      to: browserPointerTargetSchema,
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
      element: browserPointerTargetSchema,
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
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("forward") }).strict(),
  z.object({ kind: z.literal("reload") }).strict(),
  z
    .object({
      kind: z.literal("set-viewport-profile"),
      profile: browserViewportProfileSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("wait"),
      criteria: browserWaitCriteriaSchema,
    })
    .strict(),
  z.object({ kind: z.literal("clear-viewport-profile") }).strict(),
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
  z
    .object({
      kind: z.literal("script"),
      frame: browserFrameTargetSchema.optional(),
      world: z.enum(["isolated", "main"]).optional(),
      source: z
        .string()
        .min(1)
        .refine(
          (value) =>
            new TextEncoder().encode(value).byteLength <=
            BROWSER_CONTROL_MAX_SCRIPT_SOURCE_BYTES,
          "Browser script source exceeds the byte limit",
        ),
      input: jsonValueSchema.refine(
        (value) => jsonByteLength(value) <= BROWSER_CONTROL_MAX_INPUT_BYTES,
        "Browser script input exceeds the byte limit",
      ),
      timeoutMs: z
        .number()
        .int()
        .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
        .max(BROWSER_CONTROL_MAX_TIMEOUT_MS),
    })
    .strict(),
]);
export type BrowserControlAction = z.infer<typeof browserControlActionSchema>;

export const browserClientStateMessageSchema = z
  .object({
    type: z.literal("browser-client-state"),
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    active: z.boolean(),
    canActivateThreadOwner: z.boolean(),
    tabs: z
      .array(
        browserTabDescriptorSchema.omit({ clientId: true, windowId: true }),
      )
      .max(128),
    owners: z
      .array(
        browserTabOwnerDescriptorSchema.omit({
          clientId: true,
          windowId: true,
        }),
      )
      .max(32),
  })
  .strict();
export type BrowserClientStateMessage = z.infer<
  typeof browserClientStateMessageSchema
>;

export const browserControlRequestMessageSchema = z
  .object({
    type: z.literal("browser-control-request"),
    requestId: z.string().min(1).max(128),
    target: browserTabTargetSchema,
    action: browserControlActionSchema,
    actionabilityPolicy: browserActionabilityPolicySchema,
  })
  .strict();
export type BrowserControlRequestMessage = z.infer<
  typeof browserControlRequestMessageSchema
>;

const browserOpenTabRequestBaseSchema = z.object({
  type: z.literal("browser-open-tab-request"),
  requestId: z.string().min(1).max(128),
  clientId: z.string().min(1).max(128),
  windowId: z.string().min(1).max(128),
  url: z.string().min(1).max(16_384),
});

export const browserOpenTabRequestMessageSchema = z.discriminatedUnion("mode", [
  browserOpenTabRequestBaseSchema
    .extend({
      mode: z.literal("owner"),
      ownerId: z.string().min(1).max(256),
    })
    .strict(),
  browserOpenTabRequestBaseSchema
    .extend({
      mode: z.literal("thread"),
      threadId: z.string().min(1).max(256),
      projectId: z.string().min(1).max(256),
    })
    .strict(),
]);
export type BrowserOpenTabRequestMessage = z.infer<
  typeof browserOpenTabRequestMessageSchema
>;

export const browserOpenTabResponseMessageSchema = z
  .object({
    type: z.literal("browser-open-tab-response"),
    requestId: z.string().min(1).max(128),
    clientId: z.string().min(1).max(128),
    windowId: z.string().min(1).max(128),
    ownerId: z.string().min(1).max(256),
    ok: z.boolean(),
    target: browserTabTargetSchema.optional(),
    error: browserControlErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ok === (value.target === undefined) ||
      value.ok === (value.error !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "successful responses require target; failures require error",
      });
    }
  });
export type BrowserOpenTabResponseMessage = z.infer<
  typeof browserOpenTabResponseMessageSchema
>;
export const browserControlCancelMessageSchema = z
  .object({
    type: z.literal("browser-control-cancel"),
    requestId: z.string().min(1).max(128),
    reason: z.enum(["cancelled", "timeout", "client-disconnected"]),
  })
  .strict();
export type BrowserControlCancelMessage = z.infer<
  typeof browserControlCancelMessageSchema
>;

export const browserControlResponseMessageSchema = z
  .object({
    type: z.literal("browser-control-response"),
    requestId: z.string().min(1).max(128),
    target: browserTabTargetSchema,
    observedTarget: browserTabTargetSchema.optional(),
    ok: z.boolean(),
    value: jsonValueSchema.optional(),
    error: browserControlErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ok === (value.value === undefined) ||
      value.ok === (value.error !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "successful responses require value; failures require error",
      });
    }
    if (jsonByteLength(value) > BROWSER_CONTROL_MAX_RESULT_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Browser response is too large",
      });
    }
  });
export type BrowserControlResponseMessage = z.infer<
  typeof browserControlResponseMessageSchema
>;
