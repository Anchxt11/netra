// Our ECharts look. Every chart passes chartTheme(el) as its `theme`, so no chart ever
// ships ECharts' default colours, fonts or tooltips. Colours are read from the CSS
// tokens at runtime, so the console theme (src/styles/console.css) drives charts too.
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);
export { echarts };

const read = (styles: CSSStyleDeclaration, name: string) => styles.getPropertyValue(name).trim();

/** Colours by role, read from the element's CSS tokens. */
export function chartColors(el: Element = document.documentElement) {
  const s = getComputedStyle(el);
  return {
    rule: read(s, "--rule"),
    ai: read(s, "--ai"),
    ok: read(s, "--ok"),
    rust: read(s, "--rust"),
    fail: read(s, "--fail"),
    text: read(s, "--text"),
    textHi: read(s, "--text-hi"),
    muted: read(s, "--muted"),
    heat: [read(s, "--heat-1"), read(s, "--heat-2"), read(s, "--heat-3"), read(s, "--heat-4")],
  };
}

export function chartTheme(el?: Element) {
  const c = chartColors(el);
  const axisLine = "rgba(255, 120, 90, 0.3)";
  const grid = "rgba(255, 120, 90, 0.08)";
  const mono = '"IBM Plex Mono", ui-monospace, monospace';
  const axis = {
    axisLine: { show: true, lineStyle: { color: axisLine } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontFamily: mono, fontSize: 10 },
    splitLine: { show: false, lineStyle: { color: grid } },
    nameTextStyle: { color: c.muted, fontFamily: mono, fontSize: 10 },
  };

  return {
    // Role order, not a palette: rules, AI, health, the thing that matters.
    color: [c.rule, c.ai, c.ok, c.rust],
    backgroundColor: "transparent",
    textStyle: { fontFamily: mono, color: c.muted, fontSize: 10 },
    categoryAxis: axis,
    valueAxis: { ...axis, axisLine: { show: false }, splitLine: { show: true, lineStyle: { color: grid } } },
    tooltip: {
      backgroundColor: "rgba(20, 14, 12, 0.88)",
      borderColor: "rgba(255, 170, 140, 0.18)",
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: c.text, fontFamily: mono, fontSize: 11 },
      extraCssText: "border-radius: 10px; backdrop-filter: blur(12px); box-shadow: none;",
    },
    bar: { itemStyle: { borderRadius: 1 } },
    line: { symbol: "none", lineStyle: { width: 1.5 } },
    markLine: { symbol: "none", lineStyle: { type: "dashed", width: 1 }, label: { fontFamily: mono, fontSize: 9.5 } },
  };
}
