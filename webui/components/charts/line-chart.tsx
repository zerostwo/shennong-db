"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart,GridComponent,TooltipComponent,CanvasRenderer]);

export function AppLineChart({label,values=[58,64,61,73,69,82,78,91]}:{label:string;values?:number[]}){const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!ref.current)return;const chart=echarts.init(ref.current);chart.setOption({animationDuration:350,grid:{top:12,right:8,bottom:24,left:34},tooltip:{trigger:"axis"},xAxis:{type:"category",boundaryGap:false,data:values.map((_,i)=>`${i*3}:00`),axisLine:{lineStyle:{color:"#cbd5e1"}},axisLabel:{color:"#64748b",fontSize:10}},yAxis:{type:"value",splitLine:{lineStyle:{color:"#e2e8f0",type:"dashed"}},axisLabel:{color:"#64748b",fontSize:10}},series:[{type:"line",data:values,smooth:true,symbol:"none",lineStyle:{width:3,color:"#2563eb"},areaStyle:{color:"rgba(37,99,235,.10)"}}]});const resize=()=>chart.resize();addEventListener("resize",resize);return()=>{removeEventListener("resize",resize);chart.dispose()}},[values]);
  return <div className="echart-wrap" role="img" aria-label={`${label}. Values: ${values.join(", ")}.`}><div ref={ref}/></div>}
