import {
  BROWSER_CONTROL_MAX_TIMEOUT_MS,
  BROWSER_CONTROL_MIN_TIMEOUT_MS,
  browserActionabilityPolicySchema,
  browserControlActionSchema,
  browserControlErrorSchema,
  browserFrameDescriptorSchema,
  browserFrameTargetSchema,
  browserTabDescriptorSchema,
  browserTabOwnerDescriptorSchema,
  browserTabTargetSchema,
  browserWaitCriteriaSchema,
  browserWaitResultSchema,
  jsonValueSchema,
} from "@bb/domain";
import type {
  BrowserControlError,
  BrowserFrameDescriptor,
  BrowserFrameTarget,
  BrowserWaitCriteria,
  BrowserWaitResult,
} from "@bb/domain";
import { z } from "zod";

export {
  browserActionabilityPolicySchema,
  browserControlErrorSchema,
  browserFrameDescriptorSchema,
  browserFrameTargetSchema,
  browserWaitCriteriaSchema,
  browserWaitResultSchema,
};
export type {
  BrowserControlError,
  BrowserFrameDescriptor,
  BrowserFrameTarget,
  BrowserWaitCriteria,
  BrowserWaitResult,
};
export const browserTabsResponseSchema = z
  .object({
    tabs: z.array(browserTabDescriptorSchema),
    owners: z.array(browserTabOwnerDescriptorSchema),
  })
  .strict();
export type BrowserTabsResponse = z.infer<typeof browserTabsResponseSchema>;

export const browserOpenRequestSchema = z
  .object({
    url: z.string().min(1).max(16_384),
    clientId: z.string().min(1).max(128).optional(),
    windowId: z.string().min(1).max(128).optional(),
    ownerId: z.string().min(1).max(256).optional(),
    threadId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
      .max(BROWSER_CONTROL_MAX_TIMEOUT_MS)
      .default(30_000),
  })
  .strict();
export type BrowserOpenRequest = z.infer<typeof browserOpenRequestSchema>;

export const browserOpenResponseSchema = z
  .object({ target: browserTabTargetSchema })
  .strict();
export type BrowserOpenResponse = z.infer<typeof browserOpenResponseSchema>;

export const browserControlRequestSchema = z
  .object({
    action: browserControlActionSchema,
    target: browserTabTargetSchema,
    timeoutMs: z
      .number()
      .int()
      .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
      .max(BROWSER_CONTROL_MAX_TIMEOUT_MS)
      .default(30_000),
  })
  .strict();
export type BrowserControlRequest = z.infer<typeof browserControlRequestSchema>;

export const browserControlResponseSchema = z
  .object({ value: jsonValueSchema })
  .strict();
export type BrowserControlResponse = z.infer<
  typeof browserControlResponseSchema
>;
const browserBatchItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    action: browserControlActionSchema,
    target: browserTabTargetSchema,
  })
  .strict();

export const browserBatchRequestSchema = z
  .object({
    items: z.array(browserBatchItemSchema).min(1).max(16),
    concurrency: z.number().int().min(1).max(4).default(4),
    timeoutMs: z
      .number()
      .int()
      .min(BROWSER_CONTROL_MIN_TIMEOUT_MS)
      .max(BROWSER_CONTROL_MAX_TIMEOUT_MS)
      .default(30_000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.id)).size === value.items.length,
    "Browser batch item ids must be unique",
  )
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      16 * 1024 * 1024,
    "Browser batch request exceeds the aggregate byte limit",
  );
export type BrowserBatchRequest = z.infer<typeof browserBatchRequestSchema>;

export const browserBatchResponseSchema = z
  .object({
    results: z.array(
      z.discriminatedUnion("ok", [
        z
          .object({
            id: z.string().min(1).max(128),
            ok: z.literal(true),
            value: jsonValueSchema,
          })
          .strict(),
        z
          .object({
            id: z.string().min(1).max(128),
            ok: z.literal(false),
            error: browserControlErrorSchema,
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export type BrowserBatchResponse = z.infer<typeof browserBatchResponseSchema>;
