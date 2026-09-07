export const meta = {
  name: "browser-frame-target-repair",
  description: "Repair Browser frame-target invalidation and verify the desktop contract.",
  phases: [
    { title: "Inspect" },
    { title: "Repair" },
    { title: "Verify" },
  ],
};


phase("Inspect");
const inspection = await agent(
  `Inspect the Browser frame-target invalidation race without editing files. Scope: apps/desktop/src/desktop-browser-view.ts and apps/desktop/test/desktop-browser-view-manager.test.ts. A Page.getFrameTree result can create a current child-frame record before a queued Page.frameNavigated notification for the same loader arrives; the existing unconditional invalidation then makes the public frame target stale. Identify the smallest safe source and test changes. Preserve invalidation for changed or absent loader IDs and Page.frameDetached. Do not run validation. Return precise implementation guidance.`,
  {
    provider: "acp-omp",
    model: "opencode-go/deepseek-v4-flash",
    reasoningLevel: "low",
  },
);

phase("Repair");
const repair = await agent(
  `Implement the Browser frame-target repair using the inspection below. Edit only the source and focused native desktop test needed for this defect. Add coverage that listFrames discovers a cross-origin child, a same-loader Page.frameNavigated arrives after discovery, and trusted child-frame click input still dispatches. Add the changed-loader counterpart proving the prior target rejects. Do not weaken stale-target safety, change public contracts, or bump the host daemon protocol. Do not run formatters, linters, builds, typechecks, or tests; the next worker owns validation. Inspection:\n\n${inspection}`,
  {
    provider: "acp-omp",
    model: "opencode-go/deepseek-v4-flash",
    reasoningLevel: "low",
  },
);

phase("Verify");
const verification = await agent(
  `Review the implementation below against the frame-target requirements, fix any defects you find, then run only the focused desktop Browser manager test and @bb/desktop typecheck through Turbo. Also inspect the changed files for clean contract coverage. Do not run project-wide validation. Report exact commands and results, remaining risks, and whether a rebuilt desktop runtime is still needed for the live Browser fixture. Repair report:\n\n${repair}`,
  {
    provider: "acp-omp",
    model: "opencode-go/deepseek-v4-flash",
    reasoningLevel: "low",
  },
);

return { inspection, repair, verification };
