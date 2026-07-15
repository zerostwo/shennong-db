"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { BioGraphEdge, BioGraphState, BioGraphSubgraph } from "@/lib/api/adapter";

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

const stateColors: Record<BioGraphState, string> = {
  observed: "#2563eb",
  computed: "#7c3aed",
  hypothesis: "#d97706",
  validated: "#16a34a",
  refuted: "#dc2626",
  unknown: "#64748b",
};

export function ProjectGraphCanvas({ graph, onSelectEdge, onFocusNode }: { graph: BioGraphSubgraph; onSelectEdge: (edge: BioGraphEdge) => void; onFocusNode: (nodeId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const edgeMap = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const chart = echarts.init(ref.current);
    chart.setOption({
      animationDuration: 280,
      tooltip: {
        formatter: (params: { dataType?: string; data?: { label?: string; predicate?: string; name?: string } }) => params.dataType === "edge"
          ? params.data?.predicate ?? "association"
          : params.data?.label ?? params.data?.name ?? "entity",
      },
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: false,
        force: { repulsion: 185, edgeLength: [75, 150], gravity: 0.08 },
        label: { show: true, position: "right", color: "#334155", fontSize: 10, formatter: "{b}" },
        edgeLabel: { show: true, color: "#64748b", fontSize: 9, formatter: (params: { data?: { predicate?: string } }) => params.data?.predicate ?? "" },
        lineStyle: { width: 1.4, opacity: 0.72, curveness: 0.06 },
        emphasis: { focus: "adjacency", lineStyle: { width: 2.4, opacity: 1 } },
        data: graph.nodes.map((node) => ({
          id: node.id,
          name: node.label,
          label: node.label,
          value: node.kind,
          symbolSize: node.id === graph.root ? 38 : 27,
          itemStyle: { color: stateColors[node.state], borderColor: "#fff", borderWidth: 2 },
        })),
        edges: graph.edges.map((edge) => ({
          id: edge.id,
          source: edge.subjectId,
          target: edge.objectId,
          predicate: edge.predicate,
          lineStyle: {
            color: edge.polarity === "negative" ? "#dc2626" : edge.polarity === "positive" ? "#16a34a" : edge.polarity === "mixed" ? "#d97706" : "#94a3b8",
            type: edge.state === "hypothesis" ? "dashed" : "solid",
          },
        })),
      }],
    });
    chart.on("click", (params) => {
      const data = params.data as { id?: string } | null | undefined;
      const id = data?.id;
      if (!id) return;
      if (params.dataType === "edge") {
        const edge = edgeMap.get(id);
        if (edge) onSelectEdge(edge);
      } else if (params.dataType === "node") onFocusNode(id);
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize, { passive: true });
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [graph, onFocusNode, onSelectEdge]);
  return <div className="project-graph-canvas" role="img" aria-label={`BioGraph rooted at ${graph.root} with ${graph.nodes.length} nodes and ${graph.edges.length} associations.`} ref={ref} />;
}
