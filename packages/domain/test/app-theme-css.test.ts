import { describe, expect, it } from "vitest";
import {
  BUILTIN_THEME_IDS,
  defaultAppTheme,
  resolveAppThemeCss,
  resolveBuiltInThemeCss,
  type BuiltInThemeId,
} from "../src/index.js";
import { catppuccinThemeCss } from "../src/app-theme-css/catppuccin.js";
import { draculaThemeCss } from "../src/app-theme-css/dracula.js";
import { gruvboxThemeCss } from "../src/app-theme-css/gruvbox.js";
import { nordThemeCss } from "../src/app-theme-css/nord.js";
import { solarizedThemeCss } from "../src/app-theme-css/solarized.js";

const expectedBuiltInCss: Readonly<Record<BuiltInThemeId, string>> = {
  default: "",
  nord: nordThemeCss,
  dracula: draculaThemeCss,
  solarized: solarizedThemeCss,
  gruvbox: gruvboxThemeCss,
  catppuccin: catppuccinThemeCss,
};

describe("built-in app theme CSS", () => {
  it.each(BUILTIN_THEME_IDS)(
    "resolves %s identically for both entrypoints",
    (themeId) => {
      const expected = expectedBuiltInCss[themeId];

      expect(resolveBuiltInThemeCss(themeId)).toBe(expected);
      expect(resolveAppThemeCss({ ...defaultAppTheme, themeId })).toBe(
        expected,
      );
    },
  );
});
