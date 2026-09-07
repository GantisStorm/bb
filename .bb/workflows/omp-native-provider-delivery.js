export const meta = {
  name: "omp-native-provider-delivery",
  description: "Plan and implement a BB provider plugin backed by OMP native RPC.",
  phases: [
    { title: "Plan", detail: "Map the public BB provider bridge and OMP RPC contracts." },
    { title: "Implement", detail: "Ship the OMP-native provider plugin and focused verification." },
  ],
};

phase("Plan");
const plan = await agent(
  "You are the design owner. Do not edit files. Inspect this BB repository and its current public Plugin SDK contracts, especially examples/plugins/echo-provider and existing provider plugins. Produce an execution-ready plan to add a production-quality OMP-native provider plugin that runs the installed OMP executable as omp --mode rpc, never ACP. Use only public @get-bb/plugin-sdk/provider-bridge APIs in the installable plugin; do not import private @bb packages. The plugin must launch and health-check OMP, negotiate native RPC v2 framing, translate required thread and turn lifecycle plus streaming text/tool/error events into canonical BB deltas, forward lifecycle operations as supportable, and retain OMP-native state needed for dynamic commands/models/thinking/todos/subagents through declared provider extension kinds or a deliberately scoped UI boundary. Identify exact existing files/patterns to reuse, exact new/changed files, contracts/invariants, protocol-event mapping, tests and behavioral checks. Account for plugin packaging, host lifecycle, OMP executable discovery, concurrent JSONL correlation, teardown, malformed frames, and version compatibility. Do not propose a fake scaffold, ACP fallback, or private-monorepo dependency. Your final response is the complete plan for an implementation worker.",
  {
    provider: "acp-omp",
    model: "openai-codex/gpt-5.6-sol",
    reasoningLevel: "high",
    phase: "Plan",
    label: "Plan native OMP provider",
  },
);

phase("Implement");
await agent(
  "You are the implementation owner. Implement the complete native OMP provider-plugin plan below in the current workspace. Inspect the repository yourself before editing; use its existing conventions and public Plugin SDK declarations as the source of truth. Deliver real end-to-end behavior, not a scaffold. Build an installable plugin that integrates OMP through omp --mode rpc, not ACP and not direct private @bb imports. Include focused high-value tests and run the relevant build/test and a real protocol smoke check where practical. Do not run broad unrelated suites or format unrelated files. No code comments except semantic tool directives. If the plan conflicts with current source/contracts, follow the current source and make the smallest correct adjustment.\n\nPlanner output:\n\n" + plan,
  {
    provider: "acp-omp",
    model: "opencode-go/deepseek-v4-flash",
    reasoningLevel: "high",
    phase: "Implement",
    label: "Implement native OMP provider",
  },
);

return { delivered: true };
