"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getPublicConfig, type JsonRecord } from "@/lib/api/adapter";
export default function SupportPage(){const[config,setConfig]=useState<JsonRecord|null>(null);const[error,setError]=useState("");useEffect(()=>{void getPublicConfig().then(setConfig).catch((reason)=>setError(reason instanceof Error?reason.message:"Configuration request failed"));},[]);return <main className="shell" style={{padding:40}}><h1>Support</h1>{error&&<p role="alert">{error}</p>}{config&&<><p className="muted">Support for {String(config.instance_name)}.</p>{config.support_email?<a className="button" href={`mailto:${String(config.support_email)}`}>Email {String(config.support_email)}</a>:<p>No support email is configured by the administrator.</p>}<p>Service {String(config.service_version)} · API {String(config.api_version)}</p></>}<Link className="button" href="/resources">Back to Resources</Link></main>}
