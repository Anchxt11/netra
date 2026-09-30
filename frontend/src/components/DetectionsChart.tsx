// DETECTIONS / MIN: last 30 minutes, rule detections (violet) under AI detections (cyan).
// Lazy-loaded, so the chart library never delays the first paint of the dashboard.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactEChartsCore from "echarts-for-react/esm/core";
import type { PipelineHealth } from "../data/types";
import { chartTheme, echarts } from "../lib/echartsTheme";
import { themeColors } from "../lib/cssColors";
import { formatHM } from "../lib/time";
import styles from "./DetectionsChart.module.css";

interface Props {
  perMin: PipelineHealth["detectionsPerMin"];
  /** Start of the minute the selected incident began, if it is inside the window. */
  attackStart: number | null;
}

export default function DetectionsChart({ perMin, attackStart }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ReturnType<typeof chartTheme> | null>(null);
  const [rust, setRust] = useState("");

  useLayoutEffect(() => {
    if (!boxRef.current) return;
    setTheme(chartTheme(boxRef.current));
    setRust(themeColors(boxRef.current).rust);
  }, []);

  const option = useMemo(() => {
    const labels = perMin.map((m) => formatHM(m.t));
    const markIndex = attackStart !== null ? perMin.findIndex((m) => Date.parse(m.t) === attackStart) : -1;
    const markAt = markIndex >= 0 ? labels[markIndex] : undefined;
    // Late in the window, the label sits left of the line so it never runs off the chart.
    const labelAlign = markIndex > perMin.length / 2 ? "right" : "left";
    return {
      animationDuration: 300,
      grid: { left: 22, right: 6, top: 16, bottom: 18 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } } },
      xAxis: { type: "category", data: labels, axisLabel: { interval: 9, fontSize: 9.5 } },
      yAxis: { type: "value", minInterval: 1, splitNumber: 3, axisLabel: { fontSize: 9.5 } },
      series: [
        {
          name: "Rules",
          type: "bar",
          stack: "d",
          barWidth: "62%",
          data: perMin.map((m) => m.rule),
          markLine: {
            silent: true,
            symbol: "none",
            data: markAt ? [{ xAxis: markAt }] : [],
            lineStyle: { color: rust, type: "dashed", width: 1 },
            label: { formatter: "ATTACK STARTS", color: rust, position: "end", align: labelAlign, fontSize: 9.5 },
          },
        },
        { name: "AI engine", type: "bar", stack: "d", barWidth: "62%", data: perMin.map((m) => m.ai) },
      ],
    };
  }, [perMin, attackStart, rust]);

  const rules = perMin.reduce((s, m) => s + m.rule, 0);
  const ai = perMin.reduce((s, m) => s + m.ai, 0);

  return (
    <div
      ref={boxRef}
      className={styles.chart}
      role="img"
      aria-label={`Detections per minute over the last 30 minutes: ${rules} by rules, ${ai} by the AI engine.${attackStart !== null ? " The selected attack started inside this window." : ""}`}
    >
      {theme && <ReactEChartsCore echarts={echarts} theme={theme} option={option} style={{ height: "100%", width: "100%" }} />}
    </div>
  );
}
