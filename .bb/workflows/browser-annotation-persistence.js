export const meta = {
  name: "browser-annotation-persistence",
  description:
    "Plan and implement durable per-thread Browser screenshot and element annotation state.",
  phases: [
    {
      title: "Plan",
      detail:
        "Map the existing Browser annotation state and design the narrow persistence boundary.",
    },
    {
      title: "Implement",
      detail:
        "Apply the approved persistence plan and verify thread-switch behavior.",
    },
  ],
  outputSchema: {
    type: "object",
    properties: {
      plan: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" } },
          stateModel: { type: "string" },
          testPlan: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
        },
        required: ["files", "stateModel", "testPlan", "risks"],
        additionalProperties: false,
      },
      implementation: {
        type: "object",
        properties: {
          summary: { type: "string" },
          changedFiles: { type: "array", items: { type: "string" } },
          verification: { type: "array", items: { type: "string" } },
          remainingRisks: { type: "array", items: { type: "string" } },
        },
        required: ["summary", "changedFiles", "verification", "remainingRisks"],
        additionalProperties: false,
      },
    },
    required: ["plan", "implementation"],
    additionalProperties: false,
  },
};

phase("Plan");
const plan = await agent(
  `Plan the Browser annotation persistence fix in this repository. The observed bug: enter screenshot annotation or select-and-annotate-page-element on a thread, switch to another thread, return, and the annotation state is gone. Screenshot annotation mode and page-element annotation state must persist per thread. The one-shot grab-page-element/picker interaction itself must not persist. Inspect current BrowserTabContent, BrowserScreenshotAnnotation, Browser annotation state/store patterns, thread lifecycle, and existing tests before choosing state ownership. Preserve exact Browser target/navigation safety and avoid persisting sensitive or invalid page-derived state. Specify the minimal state model, files, tests that reproduce thread switching, and risks. Do not edit files, run formatters, or run project-wide tests. Return only the structured workflow result.`,
  {
    provider: "acp-omp",
    model: "openai-codex/gpt-5.6-sol",
    reasoningLevel: "medium",
    label: "Plan annotation persistence",
    schema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" } },
        stateModel: { type: "string" },
        testPlan: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
      },
      required: ["files", "stateModel", "testPlan", "risks"],
      additionalProperties: false,
    },
  },
);

phase("Implement");
const implementation = await agent(
  `Implement this approved Browser annotation persistence plan:\n\n${JSON.stringify(plan)}\n\nRequirements: persist screenshot annotation mode and its in-progress annotation state per thread across switching away and returning; persist page-element annotation notes/tray and any active review state that users expect to resume per thread; do not persist the one-shot page-element picker/grab interaction. Reuse the repository's established thread-scoped persistence pattern instead of adding a parallel store. Preserve navigation/target safety, data redaction, and cleanup rules. Add focused regression tests that switch threads and prove both persisted modes restore correctly. Run only affected Turbo tests/typechecks and a behavioral Browser UI check if available. Do not run project-wide validation, do not commit, and do not push. Return only the structured workflow result.`,
  {
    provider: "acp-omp",
    model: "opencode-go/deepseek-v4-flash",
    reasoningLevel: "high",
    label: "Implement annotation persistence",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        changedFiles: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        remainingRisks: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "changedFiles", "verification", "remainingRisks"],
      additionalProperties: false,
    },
  },
);

return { plan, implementation };
