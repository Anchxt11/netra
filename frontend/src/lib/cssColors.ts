// Canvas-drawn things (charts, the entity graph) cannot use CSS variables directly,
// so they read the current theme's colours from the page at runtime.

const read = (styles: CSSStyleDeclaration, name: string) => styles.getPropertyValue(name).trim();

/** Colours by role, read from the element's CSS tokens (so the console theme applies). */
export function themeColors(el: Element = document.documentElement) {
  const s = getComputedStyle(el);
  return {
    bg: read(s, "--bg"),
    rule: read(s, "--rule"),
    ai: read(s, "--ai"),
    ok: read(s, "--ok"),
    rust: read(s, "--rust"),
    fail: read(s, "--fail"),
    text: read(s, "--text"),
    textHi: read(s, "--text-hi"),
    muted: read(s, "--muted"),
    onRust: read(s, "--on-rust"),
    heat: [read(s, "--heat-1"), read(s, "--heat-2"), read(s, "--heat-3"), read(s, "--heat-4")],
  };
}
