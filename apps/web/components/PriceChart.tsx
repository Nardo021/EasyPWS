"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { PricePoint } from "../lib/api";

export function PriceChart({ points }: { points: PricePoint[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const chart = echarts.init(ref.current);
    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 40, right: 16, top: 24, bottom: 36 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: points.map((p) => p.observedAt.slice(0, 16).replace("T", " ")),
        axisLabel: { color: "#9bb5a8" },
        axisLine: { lineStyle: { color: "rgba(232,242,237,0.2)" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#9bb5a8", formatter: "${value}" },
        splitLine: { lineStyle: { color: "rgba(232,242,237,0.08)" } },
      },
      series: [
        {
          name: "Price",
          type: "line",
          smooth: true,
          showSymbol: points.length < 40,
          data: points.map((p) => p.price),
          lineStyle: { color: "#3ecf8e", width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(62,207,142,0.35)" },
              { offset: 1, color: "rgba(62,207,142,0.02)" },
            ]),
          },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [points]);

  return <div className="chart" ref={ref} />;
}
