import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-browser-annotations",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  },
});
