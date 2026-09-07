export interface BrowserElementPickerTheme {
  fillColor: string;
  outlineColor: string;
}

export function readBrowserElementPickerTheme(): BrowserElementPickerTheme {
  const styles = getComputedStyle(document.documentElement);
  const outlineColor =
    styles.getPropertyValue("--ring").trim() ||
    styles.getPropertyValue("--foreground").trim() ||
    styles.getPropertyValue("--ink").trim() ||
    styles.color;
  return {
    fillColor: `color-mix(in oklab, ${outlineColor} 14%, transparent)`,
    outlineColor,
  };
}
