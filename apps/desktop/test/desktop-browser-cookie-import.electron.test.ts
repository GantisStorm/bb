import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const electronPath: string = require("electron");
import { build } from "esbuild";
import { expect, it } from "vitest";

it("imports an HttpOnly cookie into a real Electron session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-electron-cookie-test-"));
  const output = join(directory, "probe.cjs");
  try {
    await build({
      bundle: true,
      entryPoints: [
        join(__dirname, "desktop-browser-cookie-import.electron-probe.ts"),
      ],
      external: ["electron"],
      format: "cjs",
      outfile: output,
      platform: "node",
      target: "node24",
    });
    const result = JSON.parse(
      execFileSync(electronPath, [output], {
        cwd: __dirname,
        encoding: "utf8",
      }),
    );
    expect(result).toEqual({
      finalCookies: [
        { httpOnly: true, name: "session", value: "imported" },
      ],
      importedCount: 1,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
