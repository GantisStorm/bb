import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILTIN_THEME_CSS } from "./builtin-theme-sources";

const repoRoot = resolve(__dirname, "../..");
const themeIds = ["catppuccin", "dracula", "gruvbox", "nord", "solarized"] as const;

function declarationProjection(css: string): Record<string, Record<string, string>> {
  const projection: Record<string, Record<string, string>> = {};
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, " ");
    const declarations: Record<string, string> = {};
    for (const declaration of block[2].matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      declarations[declaration[1]] = declaration[2].trim().replace(/\s+/g, " ");
    }
    projection[selector] = declarations;
  }
  return projection;
}

function readRealThemeSource(id: string): string {
  const path = resolve(repoRoot, `packages/domain/src/app-theme-css/${id}.ts`);
  const source = readFileSync(path, "utf8");
  const match = /export const \w+ThemeCss\s*=\s*`([\s\S]*?)`;/.exec(source);
  if (!match) throw new Error(`Could not read the CSS template from ${path}`);
  return match[1];
}

describe("built-in theme source snapshots", () => {
  it("keeps the default projection empty so bb's base palette remains authoritative", () => {
    expect(BUILTIN_THEME_CSS.default).toBe("");
  });

  for (const id of themeIds) {
    it(`matches ${id}'s real declarations without pinning comments or formatting`, () => {
      expect(declarationProjection(BUILTIN_THEME_CSS[id])).toEqual(declarationProjection(readRealThemeSource(id)));
    });
  }
});
