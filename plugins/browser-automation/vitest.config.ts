import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";
export default defineWorkspaceTestConfig({
  test: {
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-plugin-browser-automation",
      include: ["**/*.test.ts"],
      exclude: ["dist/**", "node_modules/**"],
    }),
  },
});
