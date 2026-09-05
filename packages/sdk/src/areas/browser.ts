import type {
  BrowserBatchRequest,
  BrowserBatchResponse,
  BrowserControlError,
  BrowserControlRequest,
  BrowserControlResponse,
  BrowserFrameDescriptor,
  BrowserFrameTarget,
  BrowserOpenRequest,
  BrowserOpenResponse,
  BrowserTabTarget,
  BrowserTabsResponse,
  BrowserWaitCriteria,
  BrowserWaitResult,
} from "@bb/server-contract";
export type {
  BrowserControlError,
  BrowserFrameDescriptor,
  BrowserFrameTarget,
  BrowserWaitCriteria,
  BrowserWaitResult,
};
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface BrowserTabsArgs {
  signal?: AbortSignal;
}

export interface BrowserBatchArgs extends BrowserBatchRequest {
  signal?: AbortSignal;
}

export interface BrowserControlArgs extends BrowserControlRequest {
  signal?: AbortSignal;
}

export interface BrowserOpenArgs extends BrowserOpenRequest {
  signal?: AbortSignal;
}

export interface BrowserWaitArgs {
  target: BrowserTabTarget;
  criteria: BrowserWaitCriteria;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type BrowserBatchResult = BrowserBatchResponse;
export type BrowserTabsResult = BrowserTabsResponse;
export type BrowserControlResult = BrowserControlResponse;
export type BrowserOpenResult = BrowserOpenResponse;

export interface BrowserArea {
  batch(args: BrowserBatchArgs): Promise<BrowserBatchResult>;
  control(args: BrowserControlArgs): Promise<BrowserControlResult>;
  open(args: BrowserOpenArgs): Promise<BrowserOpenResult>;
  tabs(args?: BrowserTabsArgs): Promise<BrowserTabsResult>;
  wait(args: BrowserWaitArgs): Promise<BrowserControlResult>;
}

export function createBrowserArea(args: CreateSdkAreaArgs): BrowserArea {
  const { transport } = args;
  return {
    batch(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.batch.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    tabs(input = {}) {
      return transport.readJson(
        transport.api.v1.browser.tabs.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    open(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.open.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    control(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.control.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    wait(input) {
      return transport.readJson(
        transport.api.v1.browser.control.$post(
          {
            json: {
              action: { kind: "wait", criteria: input.criteria },
              target: input.target,
              timeoutMs: input.timeoutMs,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}
