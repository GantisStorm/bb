import type { AppTheme, BuiltInThemeId } from "./app-theme.js";
import { isBuiltInThemeId } from "./app-theme.js";
import { catppuccinThemeCss } from "./app-theme-css/catppuccin.js";
import { draculaThemeCss } from "./app-theme-css/dracula.js";
import { gruvboxThemeCss } from "./app-theme-css/gruvbox.js";
import { nordThemeCss } from "./app-theme-css/nord.js";
import { solarizedThemeCss } from "./app-theme-css/solarized.js";

/**
 * CSS overrides per built-in palette. "default" is empty so the base theme.css
 * tokens show through. Custom palettes are supplied at runtime from their
 * theme.css file.
 */
const builtInThemeCss: Readonly<Record<BuiltInThemeId, string>> = {
  default: "",
  nord: nordThemeCss,
  dracula: draculaThemeCss,
  solarized: solarizedThemeCss,
  gruvbox: gruvboxThemeCss,
  catppuccin: catppuccinThemeCss,
};

/** Resolve the bundled CSS for a built-in palette. */
export function resolveBuiltInThemeCss(themeId: BuiltInThemeId): string {
  return builtInThemeCss[themeId];
}

/** Resolve the CSS that should be applied for an authoritative app theme. */
export function resolveAppThemeCss(appearance: AppTheme): string {
  if (isBuiltInThemeId(appearance.themeId)) {
    return resolveBuiltInThemeCss(appearance.themeId);
  }
  return appearance.customCss ?? "";
}
