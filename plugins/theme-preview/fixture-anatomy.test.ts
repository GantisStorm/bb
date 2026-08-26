import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FIXTURE_ANCHORS } from "./fixture-anatomy";

// Built-in plugins live at <repoRoot>/plugins/<name>, so the app source the
// fixture mirrors is two levels up. This test only runs in the source
// checkout (vitest), never in a packaged build.
const repoRoot = resolve(__dirname, "../..");

describe("Theme Preview fixture anatomy", () => {
  for (const anchor of FIXTURE_ANCHORS) {
    it(`still matches ${anchor.file}`, () => {
      const source = readFileSync(resolve(repoRoot, anchor.file), "utf8");
      for (const needle of anchor.mustContain) {
        expect(source, `${anchor.because}\nExpected ${anchor.file} to contain: ${needle}`).toContain(needle);
      }
    });
  }
});
