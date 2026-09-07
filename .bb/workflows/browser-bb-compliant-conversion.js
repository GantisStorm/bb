export const meta = {
  name: "browser-bb-compliant-conversion",
  description: "Convert Browser automation to BB-compliant generic APIs and plugin-owned annotations with Astra planning/review and DeepSeek implementation/repair.",
  phases: [
    { title: "Astra plan" },
    { title: "DeepSeek implement" },
    { title: "Astra review" },
    { title: "DeepSeek repair" },
    { title: "Astra final verification" },
  ],
};



const brief = `
USER AUTHORIZATION AND GOAL
The user approved fully converting this branch's Browser implementation to the BB-compliant architecture described below. They explicitly selected Astra high for planning, DeepSeek V4 Flash max for implementation, Astra for independent review, and DeepSeek for review fixes. These workflow model overrides are intentional; do not modify .omp/config.yml or duplicate its internal delegation policy. Work in the current origin environment checkout. This is implementation, not another audit-only task.

ARCHITECTURAL ACCEPTANCE
Sawyer's review of https://github.com/get-bb/bb/pull/2796 requested well-defined layers: generic usable Browser APIs, plugin API, plugin-owned annotation layer, screenshot/object tooling. Core must own exact client/window/thread/tab identity, background lifecycle, navigation epochs, frame identity/worlds, native input, navigation/event waits, bounded script/capture primitives, origin-scoped permissions, and generic toolbar/overlay lifecycle. An annotation plugin must own selection workflow, fix/change/question/approve semantics, feedback, review cards/tray, drawing editor, annotation state/history, sanitization/formatting, and copy/download/add-to-chat. It must consume public plugin SDK APIs like an ordinary third-party plugin, not import host app internals or use a privileged bypass. Remove the annotation-specific core BrowserControlAction annotate variant, moving its agent behavior to the annotation plugin; preserve user capabilities through the migrated UI, SDK, bb CLI and agent tool. Keep generic browser automation in the Browser plugin. Derive canonical shared action variants rather than duplicating drifting schemas.

CURRENT SOURCE LANDMARKS
apps/app/src/components/secondary-panel/BrowserTabContent.tsx runs picking, capture, review, state and annotation UI directly. BrowserScreenshotAnnotation.tsx and BrowserAnnotationState.ts hold drawing/state; apps/app/src/lib/browser-element-annotation.ts extracts/redacts/formats. apps/app/src/components/plugin/PluginBrowserActions.tsx provides toolbar slot, exact-tab script/capture, overlay root/lease; packages/plugin-sdk/src/app-contract.ts declares these experimental APIs. packages/domain/src/browser-control.ts has the generic action union including the annotation-specific variant. plugins/browser/src/contracts.ts duplicates actions. apps/server/src/ws/hub.ts brokers requests. apps/desktop/src/desktop-browser-view.ts, desktop-browser-page-runtime.ts, desktop-browser-main-ipc.ts and preload.ts implement native transport/runtime. Public surfaces include packages/sdk/src/areas/browser.ts, apps/cli/src/commands/browser.ts, packages/plugin-sdk, packages/plugin-api-map and built-in skills.

AUDIT REPAIRS: EACH ITEM REQUIRES AN EXPLICIT DISPOSITION AND EVIDENCE; DO NOT SILENTLY OMIT
F01 Transition waits: hub allowsTargetDisappearance excludes navigation/url/next-document waits, so epoch changes reject expected transitions. Actual source smoke: register epoch 3, start wait navigation commit sameDocument=false, publish epoch 4 -> BrowserControlTargetChangedError. Preserve legitimate transitions while still rejecting wrong target/lifecycle changes.
F02 State invalidation only rejects server waiters without cancelling remote work. Same smoke sends browser-control-request and no browser-control-cancel. Cover control and owner-open lifecycle invalidation.
F03 URL credential redaction: compactHtml strips query/hash but retains URL username/password; later regex heuristics miss credentials. Actual source picker+redactor+formatter on a synthetic anchor https://alice:summerfruit@example.test/account?code=demo-code#private returns sensitive=false, credential-bearing HTML and agent context. Structurally sanitize all relevant URL fields, not just pageUrl.
F04 Screenshot resize drift: drawing uses displayed CSS pixels, canvas resizes without scaling shapes. Actual mounted source component: center mark at image width 776 appears at normalized 0.81,0.81 after width becomes 476. Store image/normalized coordinates, preserve correct positioning and widths across resize, remount, undo/redo, text and export.
F05 Plugin frame snapshots: agent snapshot schema lacks canonical optional frame. Actual browserOperationSchema rejects action.frame as unrecognized. Child-frame discover -> snapshot -> ref action must work end to end.
F06 Permission overrides: allowedPermissions/deniedPermissions are per-tab sets, handlers ignore requesting origin and navigation does not reset. Scope grants/denials to origin including requesting frames; preserve secure defaults.
F07 Trusted input abort: preload checks signal only before IPC; cancellation during asynchronous resolution can still dispatch input. Implement end-to-end cancellation checked immediately before native dispatch.
F08 Frame worlds: runPageScript reuses one cached executionContextId or creates an isolated context regardless of request.world; execution-context events do not distinguish worlds. Honor explicit main vs isolated and document identity.
F09 Cookie import atomicity: importCookiesIntoSession clears persistent cookies before Electron validates/sets every cookie. Validate whole input and make replacement rollback-safe; do not wipe real user's sessions during verification. Use isolated temporary session fixtures.
F10 Certificate trust: fire-and-forget ipcMain.on registerTabCommand calls trustLocalhostCertificate which can throw on stale/non-loopback URLs. Return a recoverable error across the public contract without uncaught main-process exceptions.
F11 Network-idle: onBeforeRequest increments a counter on redirect phases, terminal completion/error decrements once. Track active request identity and navigation lifecycle correctly. Verify with real redirect fixture where available.
F12 Script timeout: Runtime.terminateExecution affects WebContents rather than one request, despite concurrent requests. Enforce cancellation/isolation semantics that cannot terminate unrelated requests/page execution. Do not just remove hard-timeout protection and leave unresponsive scripts running; resolve the actual safety contract.
F13 Owner-ID open: plugin-api.ts fills caller thread/project scope even with explicit cross-thread ownerId. Explicit owner binding should work without contradictory implicit scope; conflicting explicit fields still reject.
F14 Concurrent activation: waitForBrowserControlTab stores one registration waiter per tab; concurrent waiters overwrite. Settle independently and prevent older timeouts deleting newer waiters.
F15 CLI wait modifiers: incompatible secondary flags (--status with --text, --method outside request/response, --match outside URL/request/response) are silently ignored. Reject before executing.
F16 SDK wait result: BrowserArea.wait returns generic JSON control result instead of validating/exposing the declared wait-specific result. Parse at public boundaries and propagate typed values.
F17 Screenshot transport: full-page capture accepts 50M pixels but IPC result JSON caps at 8MiB. Reconcile encoded limits with real output via a bounded transport/encoding strategy without fake success.
F18 UI compliance: compact annotation controls measured 32x32 at 390px; layout fits but drawing resize fails. Use sanctioned typography/theme/coarse-pointer tokens; compact menus/pickers/popovers/dialogs must use shared persistent responsive drawers, defer heavy realization and retain after first open, never inert/aria-hide app root. Scope extraction work to an incumbent BB-consistent UI, not a redesign. Cover keyboard/error behavior and bounded DOM traversal (compactHtml currently clones/traverses entire subtree before limiting output). Surface meaningful capture/picker failures while treating expected cancellation appropriately.
F06-F17 native consequences were source-review findings, not live installed-Electron reproductions. Establish exact behavior before changing; an evidence-backed false-positive disposition is allowed, silently assuming the audit is infallible is not.

DELIVERY SLICES
Use these logical boundaries for a complete plan and reviewable delivery, not arbitrary file-count splitting: generic contracts; broker lifecycle/cancellation/transitions; native/background ownership; frame worlds/runtime isolation; trusted input; permissions/certificates; event waits/network accounting; screenshot transport; safe cookie import; SDK/CLI adapters; generic toolbar/overlay plugin API; annotation plugin clean cutover. Preserve current background/cross-thread control, persisted tabs, navigation safety, screenshot workflows, element metadata, annotation drafts/history and clipboard/add-to-chat behavior. No partial scaffold or reduced feature subset.

REPOSITORY AND SAFETY RULES
Read and follow AGENTS.md and the relevant installed bb-plugin-authoring, plugin-guide-maintenance and impeccable skills, docs/cli-guide-and-skill.md and docs/debugging-and-qa.md. Existing unrelated work is user-owned: preserve it. Capture starting revision and dirty paths once; do not reset/rebase/rewrite branches, delete unrelated work, alter ACP model configuration, commit/push, publish PRs, run bb-source-update, replace /Applications/bb.app, restart production BB/daemon, or import/clear real cookies. Dev runtimes and temporary isolated fixtures are allowed. No code comments except semantic tool directives and Plugin SDK declarations. No shims/deprecated aliases or accepted-but-ignored fields. Boundary-validate data, pass explicit typed values internally. Use LSP for symbol-aware refactors when available. Keep server product policy vs daemon host primitives; increment HOST_DAEMON_PROTOCOL_VERSION for any changed server-daemon wire contract per repo policy. New public plugin members require experimental_ naming, docs/api_to_audit.md entry, Plugin Guide cards/symbols/fixtures. Every user-facing capability must ship SDK+CLI and matching discoverable docs in the same change. Update existing docs/changelog where required; do not create extra documentation artifacts except the machine-readable workflow handoff files requested below.

VALIDATION AND COMPLETENESS
Planning skips formatters, linters, builds and tests. Implementation is one integration owner and must not fan concurrent writers across shared files. If using internal independent workers, each skips validation; integrate before running formatters/linters/suites once. Build/typecheck/test through Turbo with correct package filters, never raw package script shortcuts; pipe slow output to files and inspect. Keep high-quality regression tests for plausible boundary/lifecycle bugs; use real in-memory SQLite where DB is needed, not database mocks. Prove UI on the actual changed source/runtime (desktop and compact); native scenarios need an isolated source-built/dev Electron fixture, not a second unrelated browser pretending to verify BB native behavior. Include representative iOS Simulator Safari drawer check if available; record exact unavailable capability instead of claiming success. Passing compilation alone is insufficient. No stubs, source-text assertion tests, mock-echo proof, fake fallbacks, suppressed errors, or unimplemented TODOs. Remove temporary fixtures after they prove behavior. Report exact commands/results, audit dispositions, capability gaps, changed files, and coherent future PR boundaries. Do not claim release readiness while acceptance or validation remains incomplete.
`;

const implementationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "reportPath", "changedFiles", "verification", "blockers"],
  properties: {
    status: { type: "string", enum: ["complete", "blocked"] },
    summary: { type: "string" },
    reportPath: { type: "string" },
    changedFiles: { type: "array", items: { type: "string" } },
    verification: { type: "array", items: { type: "string" } },
    blockers: { type: "array", items: { type: "string" } },
  },
};
const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "summary", "findings", "unverified", "verification"],
  properties: {
    approved: { type: "boolean" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "priority", "path", "problem", "requiredFix", "acceptance"],
        properties: {
          id: { type: "string" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          path: { type: "string" },
          problem: { type: "string" },
          requiredFix: { type: "string" },
          acceptance: { type: "string" },
        },
      },
    },
    unverified: { type: "array", items: { type: "string" } },
    verification: { type: "array", items: { type: "string" } },
  },
};

phase("Astra plan");
const plan = await agent(brief + `
ROLE: Astra planning owner. Read-only investigation except writing the machine-readable execution plan to .bb/browser-compliance-plan.json. Investigate the current checkout, map every architectural acceptance and F01-F18 item to concrete symbols/files, define final API and plugin contracts up front, enumerate all callers/docs/test migrations, and choose dependency-ordered implementation slices. This is the user's explicitly requested planning stage. Do not delegate top-level interpretation. The plan must be detailed enough for DeepSeek to execute the entire conversion without guessing shared interfaces. Include acceptance matrix and exact scoped verification strategy, isolated-runtime setup, safe state-preservation approach and a risk treatment for script isolation/cancellation. Include starting revision/dirty paths so the reviewer can separate user work from this workflow. Do not edit production source or run validation. Return the plan path, concise architectural decisions, full slice list and any genuine external blockers.`, { label: "Astra High: complete conversion plan" });

phase("DeepSeek implement");
let implementation = await agent(brief + `
ROLE: DeepSeek implementation and integration owner. Execute the complete approved-scope plan below, read .bb/browser-compliance-plan.json, and implement every slice end to end. The plan is not a request for more planning. Resolve ordinary decisions from source and safe defaults, preserve unrelated work, and do not stop at a phase boundary. Own integration and final scoped validation; no other workflow writer runs concurrently. Use this selected DeepSeek Max model for implementation rather than handing the entire implementation to a different model. Follow validation rules in the brief; skip broad/project-wide suites and only run necessary affected packages after integration. Save the detailed machine-readable implementation evidence and F01-F18 disposition/acceptance matrix in .bb/browser-compliance-implementation.json. Return schema result only after completing the actual work, or name a genuinely unreachable external prerequisite with all reachable work finished.\nASTRA PLAN:\n${plan}`, { provider: "acp-omp", model: "command-code/deepseek/deepseek-v4-flash", reasoningLevel: "max", label: "DeepSeek V4 Flash Max: full implementation", schema: implementationSchema });

phase("Astra review");
let review = await agent(brief + `
ROLE: independent Astra reviewer, read-only. Do not fix files; DeepSeek owns fixes. Inspect the real current source/diff against the starting state in .bb/browser-compliance-plan.json, the entire plan and all F01-F18 dispositions; do not trust the implementation summary as proof. Check full clean cutover, no host-only annotation imports, no duplicated drifted action schema, no lost capabilities, SDK/CLI/Guide parity, protocol compatibility, security/lifecycle invariants and meaningful validation evidence. Run targeted reproductions or checks needed for uncertain findings, but skip formatters/linters and project-wide suites. Review tests for observable behavior, not implementation/mocks. Require completion of architecture and runtime acceptance, report source-review vs exercised conclusions accurately. Return every actionable finding with file/symbol, impact, exact required change and observable acceptance. approved=true only when findings and unverified are empty and implementation is actually complete; external inability to verify must remain explicit, not a pass.\nPLAN:\n${plan}\nIMPLEMENTATION:\n${JSON.stringify(implementation)}`, { label: "Astra High: independent correctness review", schema: reviewSchema });

const repairHistory = [];
for (let round = 1; round <= 2 && (!review.approved || review.findings.length > 0 || review.unverified.length > 0 || implementation.status !== "complete"); round += 1) {
  phase("DeepSeek repair");
  implementation = await agent(brief + `
ROLE: fresh DeepSeek review-repair owner, pass ${round}. Read the saved plan and implementation evidence. Resolve EVERY actionable Astra finding and missing verification below; preserve already-correct behavior and unrelated work. Do not rewrite architecture casually or narrow scope. If a finding is false positive, prove it with concrete source/runtime evidence for Astra, not assertion. Complete reachable missing work, run relevant focused regression/smoke verification after integration, and update .bb/browser-compliance-implementation.json. Skip unrelated project-wide validation. Return complete only for actual full acceptance; report a genuine external block accurately.\nPLAN:\n${plan}\nPREVIOUS IMPLEMENTATION:\n${JSON.stringify(implementation)}\nASTRA REVIEW:\n${JSON.stringify(review)}`, { provider: "acp-omp", model: "command-code/deepseek/deepseek-v4-flash", reasoningLevel: "max", label: "DeepSeek Max: review repair " + round, schema: implementationSchema });
  phase("Astra final verification");
  review = await agent(brief + `
ROLE: independent Astra final reviewer, repair pass ${round}. Read-only: inspect the actual repair and full acceptance matrix, verify prior findings were fixed without regressions, and independently exercise the uncertain changed paths. Do not edit files. Skip formatters/linters/project-wide suites. Check production source rather than trusting report files. approved=true only if findings/unverified are empty, implementation complete, and architecture plus stated verification acceptance is genuinely satisfied. Report external capability gaps explicitly.\nPLAN:\n${plan}\nPREVIOUS REVIEW:\n${JSON.stringify(review)}\nREPAIR:\n${JSON.stringify(implementation)}`, { label: "Astra High: verify repairs " + round, schema: reviewSchema });
  repairHistory.push({ round, implementation, review });
}
if (!review.approved || review.findings.length > 0 || review.unverified.length > 0 || implementation.status !== "complete") {
  log("Conversion is not approved. Outstanding work or external validation blockers remain: " + JSON.stringify(review));
  return { status: "needs-attention", plan, implementation, review, repairHistory };
}
return { status: "approved", plan, implementation, review, repairHistory };
