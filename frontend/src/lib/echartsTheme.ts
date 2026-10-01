// Our ECharts look. Every chart passes chartTheme(el) as its `theme`, so no chart ever
// ships ECharts' default colours, fonts or tooltips. Colours are read from the CSS
// tokens at runtime, so the console theme (src/styles/console.css) drives charts too.
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { themeColors } from "./cssColors";

echarts.use([BarChart, LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);
export { echarts };

/** Colours by role, read from the element's CSS tokens. */
export const chartColors = themeColors;

/** "#C9C3BE" + 0.3 -> "rgba(201, 195, 190, 0.3)" (charts draw on canvas, so no CSS colour-mix). */
function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (x) => x + x) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function chartTheme(el?: Element) {
  const c = chartColors(el);
  const axisLine = withAlpha(c.scope, 0.3);
  const grid = withAlpha(c.scope, 0.08);
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
      borderColor: withAlpha(c.scope, 0.2),
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
