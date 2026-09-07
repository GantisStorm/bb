import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-browser",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  },
});
