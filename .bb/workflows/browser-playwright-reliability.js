export const meta = {
  name: "browser-playwright-reliability",
  description: "Plan and implement the remaining high-reliability visible Browser automation capabilities.",
  phases: [
    { title: "Plan", detail: "Inspect the current Browser stack and produce an implementation-ready design." },
    { title: "Implement", detail: "Implement, test, document, commit, and push the approved reliability work." }
  ]
};

phase("Plan");
const plan = await agent(`Inspect the current bb repository and produce an implementation-ready plan for the remaining traditional browser-automation reliability gaps. Scope exactly these four product capabilities: (1) cross-origin iframe targeting, (2) Playwright-style actionability checks and automatic waiting, (3) trusted native input for ordinary click, type, and keyboard actions, and (4) URL, navigation, load-state, popup, request, response, and download waits where compatible with bb's visible authenticated Browser security model.

Preserve bb's invariants: exact client/window/tab/navigation revisions, bounded JSON and screenshots, no arbitrary debugging-port access, no silent retargeting, downloads remain blocked unless product policy explicitly changes, server owns policy, desktop owns host-local primitives, and public CLI/SDK/agent-tool/docs parity is mandatory. Inspect existing contracts, renderer control client, desktop IPC/runtime, server hub/routes, SDK, CLI, Browser plugin, skills, tests, and protocol-version rules. Identify exact files/symbols, wire changes, schemas, migrations/cutovers, edge cases, security constraints, and observable tests. Do not edit files. Do not run project-wide tests. Return a concise plan that an execution agent can implement without rediscovery.`, {
  provider: "acp-omp",
  model: "openai-codex/gpt-5.6-sol",
  reasoningLevel: "medium",
  label: "Plan Browser reliability",
  schema: {
    type: "object",
    properties: {
      design: { type: "string", minLength: 1 },
      files: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      steps: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      acceptance: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      risks: { type: "array", items: { type: "string", minLength: 1 } }
    },
    required: ["design", "files", "steps", "acceptance", "risks"],
    additionalProperties: false
  }
});

phase("Implement");
const result = await agent(`Implement the complete Browser reliability plan below in the current bb workspace. This is an execution task, not another planning pass.

PLAN:\n${JSON.stringify(plan)}

Deliver every scoped capability end to end across domain/server/renderer/desktop/SDK/CLI/Browser plugin/documentation. Reconcile the plan against current source before editing, reuse existing patterns, and preserve exact-target and security invariants. Cross-origin frame support must use a safe host-owned mechanism rather than weakening web security. Actionability must have bounded polling, cancellation, precise failures, and no hidden retargeting. Click/type/key must use trusted native input while retaining explicit DOM-only script escape hatches. Waits must be typed, bounded, cancellation-aware, and expose only safe metadata; blocked downloads may be observed but not silently enabled. Maintain clean cutovers with no compatibility shims or placeholder code. Add only high-value observable tests. Increment HOST_DAEMON_PROTOCOL_VERSION only if the server-host-daemon wire changes; desktop IPC alone does not require it. Update CLI guide, bb-cli skill, bb-browser skill, plugin-authoring docs, Plugin Guide card/inventory, and any API audit surface required by repository policy.

Run focused regressions, all affected Turbo typechecks, Browser plugin build, and production builds covering changed packages. Do not install or launch the updater; live packaged-app testing remains the next step. Review the final diff, amend the existing feature commit, force-push with lease to the current branch, and leave the working tree clean.`, {
  provider: "acp-omp",
  model: "openai-codex/gpt-5.6-luna",
  reasoningLevel: "xhigh",
  label: "Implement Browser reliability",
  schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["completed", "blocked"] },
      summary: { type: "string", minLength: 1 },
      verification: { type: "array", items: { type: "string", minLength: 1 } },
      commit: { type: "string" },
      remainingRisks: { type: "array", items: { type: "string", minLength: 1 } }
    },
    required: ["status", "summary", "verification", "commit", "remainingRisks"],
    additionalProperties: false
  }
});

return result;
