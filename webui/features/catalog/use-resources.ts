"use client";
import { useQuery } from "@tanstack/react-query";
import { listResources, type ResourceRecord } from "@/lib/api/adapter";
export const resourceKeys={all:["resources"] as const,list:(query:string)=>[...resourceKeys.all,"list",query] as const};
export function useResources(query=""){return useQuery<ResourceRecord[]>({queryKey:resourceKeys.list(query),queryFn:async()=>(await listResources(query)).data,placeholderData:previous=>previous})}
