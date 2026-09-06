import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

const electronPath: string = require("electron");

it("hands a tab from revision-targeted scripts to CDP and back without concurrent control", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-browser-handoff-"));
  try {
    const output = join(directory, "fixture.cjs");
    await build({
      bundle: true,
      conditions: ["source"],
      entryPoints: [
        join(__dirname, "desktop-browser-handoff.electron-fixture.ts"),
      ],
      external: ["electron"],
      format: "cjs",
      outfile: output,
      platform: "node",
      target: "node24",
    });
    const stdout = execFileSync(electronPath, [output], {
      cwd: __dirname,
      encoding: "utf8",
      timeout: 45_000,
    });
    expect(JSON.parse(stdout)).toEqual({ nativeHandoff: "passed" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
