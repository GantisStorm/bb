import { Command } from "commander";
import {
  browserBatchRequestSchema,
  browserControlActionSchema,
  browserPageLocatorSchema,
  browserTabTargetSchema,
  browserWaitCriteriaSchema,
  type BrowserTabDescriptor,
  type BrowserTabOwnerDescriptor,
} from "@bb/server-contract";
import { action, CliExitError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";

interface BrowserJsonOptions {
  json?: boolean;
}

interface BrowserListOptions extends BrowserJsonOptions {
  active?: boolean;
  project?: string;
  thread?: string;
}

interface BrowserOpenOptions extends BrowserJsonOptions {
  client?: string;
  owner?: string;
  project?: string;
  thread?: string;
  timeout?: string;
  url: string;
  window?: string;
}

interface BrowserRunOptions extends BrowserJsonOptions {
  action: string;
  client: string;
  epoch: string;
  tab: string;
  timeout?: string;
  window: string;
}
interface BrowserBatchOptions extends BrowserJsonOptions {
  concurrency?: string;
  items: string;
  timeout?: string;
}

interface BrowserWaitOptions extends BrowserJsonOptions {
  client: string;
  document?: string;
  downloadBlocked?: boolean;
  epoch: string;
  loadState?: string;
  locator?: string;
  match?: string;
  method?: string;
  navigation?: string;
  popup?: boolean;
  request?: string;
  response?: string;
  sameDocument?: boolean;
  status?: string;
  tab: string;
  text?: string;
  timeout?: string;
  url?: string;
  window: string;
}

export function registerBrowserCommands(
  program: Command,
  getUrl: () => string,
): void {
  const browser = program
    .command("browser")
    .description("Inspect and control visible Browser tabs");

  browser
    .command("list")
    .description("List visible Browser tabs")
    .option("--thread <threadId>", "Only tabs owned by this thread")
    .option("--project <projectId>", "Only tabs owned by this project")
    .option("--active", "Only active tabs")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: BrowserListOptions) => {
        const { tabs, owners } = await createCliBbSdk(getUrl()).browser.tabs();
        const filteredTabs = tabs.filter(
          (tab) =>
            (opts.thread === undefined || tab.threadId === opts.thread) &&
            (opts.project === undefined || tab.projectId === opts.project) &&
            (!opts.active || tab.active),
        );
        const filteredOwners = owners.filter(
          (owner) =>
            (opts.thread === undefined || owner.threadId === opts.thread) &&
            (opts.project === undefined || owner.projectId === opts.project) &&
            (!opts.active || owner.active),
        );
        if (outputJson(opts, { tabs: filteredTabs, owners: filteredOwners })) {
          return;
        }
        printBrowserTabs(filteredTabs);
        printBrowserOwners(filteredOwners);
      }),
    );

  browser
    .command("open")
    .description("Open a visible Browser tab for a thread")
    .requiredOption("--url <url>", "URL to open")
    .option(
      "--thread <threadId>",
      "Destination thread; creates its first Browser tab if needed",
    )
    .option(
      "--project <projectId>",
      "Target a Browser panel owned by this project",
    )
    .option("--client <clientId>", "Target a specific Browser client")
    .option("--window <windowId>", "Target a specific Browser window")
    .option("--owner <ownerId>", "Target a specific Browser panel owner")
    .option("--timeout <seconds>", "Open timeout in seconds", "30")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: BrowserOpenOptions) => {
        const result = await createCliBbSdk(getUrl()).browser.open({
          url: opts.url,
          ...(opts.client === undefined ? {} : { clientId: opts.client }),
          ...(opts.window === undefined ? {} : { windowId: opts.window }),
          ...(opts.owner === undefined ? {} : { ownerId: opts.owner }),
          ...(opts.thread === undefined ? {} : { threadId: opts.thread }),
          ...(opts.project === undefined ? {} : { projectId: opts.project }),
          timeoutMs: parseTimeoutMs(opts.timeout),
        });
        if (outputJson(opts, result)) return;
        console.log(
          [
            result.target.clientId,
            result.target.windowId,
            result.target.tabId,
            result.target.navigationEpoch,
          ].join("\t"),
        );
      }),
    );

  browser
    .command("run")
    .description("Run a Browser action against an exact tab target")
    .requiredOption(
      "--client <clientId>",
      "Browser client ID from `bb browser list`",
    )
    .requiredOption(
      "--window <windowId>",
      "Browser window ID from `bb browser list`",
    )
    .requiredOption("--tab <tabId>", "Browser tab ID from `bb browser list`")
    .requiredOption("--epoch <n>", "Navigation epoch from `bb browser list`")
    .requiredOption("--action <json>", "Browser action JSON")
    .option("--timeout <seconds>", "Action timeout in seconds", "30")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: BrowserRunOptions) => {
        const actionInput = parseAction(opts.action);
        const target = browserTabTargetSchema.parse({
          clientId: opts.client,
          navigationEpoch: parseNavigationEpoch(opts.epoch),
          tabId: opts.tab,
          windowId: opts.window,
        });
        const result = await createCliBbSdk(getUrl()).browser.control({
          action: actionInput,
          target,
          timeoutMs: parseTimeoutMs(opts.timeout),
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result.value, null, 2));
      }),
    );
  browser
    .command("batch")
    .description("Run bounded Browser actions against explicit tab targets")
    .requiredOption("--items <json>", "JSON array of batch items")
    .option("--concurrency <n>", "Maximum concurrent actions", "4")
    .option("--timeout <seconds>", "Per-action timeout in seconds", "30")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: BrowserBatchOptions) => {
        let items: unknown;
        try {
          items = JSON.parse(opts.items);
        } catch {
          throw new CliExitError("--items must be valid JSON", 1);
        }
        const input = browserBatchRequestSchema.safeParse({
          items,
          concurrency: Number(opts.concurrency),
          timeoutMs: parseTimeoutMs(opts.timeout),
        });
        if (!input.success) {
          throw new CliExitError(
            `Invalid Browser batch: ${input.error.message}`,
            1,
          );
        }
        const result = await createCliBbSdk(getUrl()).browser.batch(input.data);
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result.results, null, 2));
      }),
    );

  browser
    .command("wait")
    .description("Wait for one explicit condition on an exact tab")
    .requiredOption(
      "--client <clientId>",
      "Browser client ID from `bb browser list`",
    )
    .requiredOption(
      "--window <windowId>",
      "Browser window ID from `bb browser list`",
    )
    .requiredOption("--tab <tabId>", "Browser tab ID from `bb browser list`")
    .requiredOption("--epoch <n>", "Navigation epoch from `bb browser list`")
    .option("--locator <json>", "Locator became available")
    .option("--text <text>", "Visible page text appeared")
    .option("--url <url>", "URL matched")
    .option("--navigation <start|commit>", "Navigation phase occurred")
    .option(
      "--same-document",
      "Require a same-document navigation (otherwise cross-document)",
    )
    .option(
      "--load-state <state>",
      "Load state: domcontentloaded, load, or networkidle",
    )
    .option("--document <current|next>", "Load-state document", "current")
    .option("--popup", "A new Browser tab opened")
    .option("--request <url>", "Request URL matched")
    .option("--response <url>", "Response URL matched")
    .option("--method <method>", "Request or response method")
    .option("--status <code>", "Response status code")
    .option("--match <exact|glob>", "URL matching mode", "exact")
    .option("--download-blocked", "A download was blocked")
    .option("--timeout <seconds>", "Wait timeout in seconds", "30")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: BrowserWaitOptions) => {
        const criteriaFlags = [
          opts.locator !== undefined,
          opts.text !== undefined,
          opts.url !== undefined,
          opts.navigation !== undefined,
          opts.loadState !== undefined,
          opts.popup === true,
          opts.request !== undefined,
          opts.response !== undefined,
          opts.downloadBlocked === true,
        ];
        if (criteriaFlags.filter(Boolean).length !== 1) {
          throw new CliExitError("Specify exactly one wait criterion", 1);
        }
        const match = opts.match ?? "exact";
        const status =
          opts.status === undefined ? undefined : Number(opts.status);
        let criteriaInput: unknown;
        if (opts.locator !== undefined) {
          criteriaInput = {
            kind: "locator",
            locator: parseLocator(opts.locator),
          };
        } else if (opts.text !== undefined) {
          criteriaInput = { kind: "text", text: opts.text };
        } else if (opts.url !== undefined) {
          criteriaInput = { kind: "url", url: opts.url, match };
        } else if (opts.navigation !== undefined) {
          criteriaInput = {
            kind: "navigation",
            phase: opts.navigation,
            sameDocument: opts.sameDocument === true,
          };
        } else if (opts.loadState !== undefined) {
          criteriaInput = {
            kind: "load-state",
            document: opts.document ?? "current",
            state: opts.loadState,
          };
        } else if (opts.popup === true) {
          criteriaInput = { kind: "popup" };
        } else if (opts.request !== undefined) {
          criteriaInput = {
            kind: "request",
            url: opts.request,
            match,
            ...(opts.method === undefined ? {} : { method: opts.method }),
          };
        } else if (opts.response !== undefined) {
          criteriaInput = {
            kind: "response",
            url: opts.response,
            match,
            ...(opts.method === undefined ? {} : { method: opts.method }),
            ...(status === undefined ? {} : { status }),
          };
        } else {
          criteriaInput = { kind: "download-blocked" };
        }
        const parsedCriteria =
          browserWaitCriteriaSchema.safeParse(criteriaInput);
        if (!parsedCriteria.success) {
          throw new CliExitError(
            `Invalid Browser wait criterion: ${parsedCriteria.error.message}`,
            1,
          );
        }
        const timeoutMs = parseTimeoutMs(opts.timeout);
        const target = browserTabTargetSchema.parse({
          clientId: opts.client,
          navigationEpoch: parseNavigationEpoch(opts.epoch),
          tabId: opts.tab,
          windowId: opts.window,
        });
        const result = await createCliBbSdk(getUrl()).browser.control({
          action: { kind: "wait", criteria: parsedCriteria.data },
          target,
          timeoutMs,
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result.value, null, 2));
      }),
    );
}

function parseAction(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CliExitError("--action must be valid JSON", 1);
  }
  const result = browserControlActionSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliExitError(
      `Invalid Browser action: ${result.error.message}`,
      1,
    );
  }
  return result.data;
}
function parseLocator(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CliExitError("--locator must be valid JSON", 1);
  }
  const result = browserPageLocatorSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliExitError(
      `Invalid Browser locator: ${result.error.message}`,
      1,
    );
  }
  return result.data;
}

function parseNavigationEpoch(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliExitError("--epoch must be a non-negative integer", 1);
  }
  return parsed;
}

function parseTimeoutMs(value: string | undefined): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new CliExitError("--timeout must be a positive number of seconds", 1);
  }
  return Math.round(seconds * 1_000);
}

function printBrowserTabs(tabs: readonly BrowserTabDescriptor[]): void {
  if (tabs.length === 0) {
    console.log("No visible Browser tabs.");
    return;
  }
  console.log(
    renderBorderlessTable(
      {
        colWidths: [16, 16, 18, 24, 24, 10, 8, 32, 34],
        head: [
          "CLIENT",
          "WINDOW",
          "TAB",
          "THREAD",
          "PROJECT",
          "STATUS",
          "EPOCH",
          "TITLE",
          "URL",
        ],
        trimTrailingWhitespace: true,
      },
      tabs.map((tab) => [
        tab.clientId,
        tab.windowId,
        tab.tabId,
        tab.threadId ?? "",
        tab.projectId ?? "",
        tab.connected ? (tab.active ? "active" : "connected") : "inactive",
        String(tab.navigationEpoch),
        tab.title ?? "",
        tab.url,
      ]),
    ),
  );
}

function printBrowserOwners(
  owners: readonly BrowserTabOwnerDescriptor[],
): void {
  if (owners.length === 0) return;
  console.log(
    renderBorderlessTable(
      {
        colWidths: [16, 16, 22, 24, 24],
        head: ["CLIENT", "WINDOW", "OWNER", "THREAD", "PROJECT"],
        trimTrailingWhitespace: true,
      },
      owners.map((owner) => [
        owner.clientId,
        owner.windowId,
        owner.ownerId,
        owner.threadId ?? "",
        owner.projectId ?? "",
      ]),
    ),
  );
}
