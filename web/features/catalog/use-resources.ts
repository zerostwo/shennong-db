"use client";
import { useQuery } from "@tanstack/react-query";
import { listResources, type ResourceRecord } from "@/lib/api/adapter";
import { resources as mockResources } from "@/lib/mock-data";
export const resourceKeys={all:["resources"] as const,list:(query:string)=>[...resourceKeys.all,"list",query] as const};
const fallback:ResourceRecord[]=mockResources.filter(row=>row[3]==="Public").map(([name,id,kind,visibility,backend,dataClass])=>({id,name,kind,visibility,backend,dataClass,updated:"2026-07-12",usage:id==="toil"?"1.12M":"—",description:`Trusted ${name} biomedical data resource.`,owner:"data-stewards",organism:"Homo sapiens",checksum:`sha256:${id.padEnd(64,"0")}`,source:`s3://shennong/${id}`,provenance:"provider manifest · verified",size:"2.8 GB"}));
export function useResources(query=""){return useQuery({queryKey:resourceKeys.list(query),queryFn:async()=>{try{return (await listResources(query)).data}catch{return fallback}},placeholderData:previous=>previous})}
