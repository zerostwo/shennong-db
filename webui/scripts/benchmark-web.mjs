#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";
import { dirname } from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function summary(values) {
  return {
    median: Number(percentile(values, 0.5).toFixed(2)),
    p95: Number(percentile(values, 0.95).toFixed(2)),
    min: Number(Math.min(...values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2)),
  };
}

const baseUrl = argument("--base-url", "http://127.0.0.1:18080").replace(/\/$/, "");
const runs = Number(argument("--runs", "5"));
const output = argument("--output", "../docs/benchmarks/webui-current.json");
const routes = argument("--routes", "/,/resources,/docs,/support,/auth/sign-in").split(",");
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const route of routes) {
    const samples = [];
    for (let run = 0; run < runs; run += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send("Network.setCacheDisabled", { cacheDisabled: true });
      const failures = [];
      const httpErrors = [];
      const consoleErrors = [];
      page.on("requestfailed", request => failures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`));
      page.on("response", response => {
        if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      });
      page.on("console", message => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.addInitScript(() => {
        window.__shennongVitals = { cls: 0, lcp: 0 };
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__shennongVitals.cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver(list => {
          const entries = list.getEntries();
          window.__shennongVitals.lcp = entries.at(-1)?.startTime ?? 0;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(250);
      const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const paint = Object.fromEntries(performance.getEntriesByType("paint").map(entry => [entry.name, entry.startTime]));
        const resources = performance.getEntriesByType("resource");
        return {
          ttfb: navigation.responseStart,
          domContentLoaded: navigation.domContentLoadedEventEnd,
          load: navigation.loadEventEnd,
          fcp: paint["first-contentful-paint"] ?? 0,
          lcp: window.__shennongVitals.lcp,
          cls: window.__shennongVitals.cls,
          transferBytes: navigation.transferSize + resources.reduce((total, entry) => total + (entry.transferSize || 0), 0),
          resourceCount: resources.length,
        };
      });
      samples.push({
        run: run + 1,
        status: response?.status() ?? 0,
        ...metrics,
        requestFailures: failures,
        httpErrors,
        consoleErrors,
      });
      await context.close();
    }
    results.push({
      route,
      runs,
      successRate: samples.filter(sample => sample.status >= 200 && sample.status < 400).length / runs,
      metrics: {
        ttfb_ms: summary(samples.map(sample => sample.ttfb)),
        fcp_ms: summary(samples.map(sample => sample.fcp)),
        lcp_ms: summary(samples.map(sample => sample.lcp)),
        cls: summary(samples.map(sample => sample.cls)),
        dom_content_loaded_ms: summary(samples.map(sample => sample.domContentLoaded)),
        load_ms: summary(samples.map(sample => sample.load)),
        transfer_bytes: summary(samples.map(sample => sample.transferBytes)),
        resource_count: summary(samples.map(sample => sample.resourceCount)),
      },
      requestFailures: [...new Set(samples.flatMap(sample => sample.requestFailures))],
      httpErrors: [...new Set(samples.flatMap(sample => sample.httpErrors))],
      consoleErrors: [...new Set(samples.flatMap(sample => sample.consoleErrors))],
      samples,
    });
  }
} finally {
  await browser.close();
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl,
  host: { hostname: hostname(), platform: platform(), release: release(), node: process.version },
  methodology: {
    browser: "Playwright Chromium",
    cache: "disabled; new browser context for each run",
    waitUntil: "networkidle plus 250 ms",
    note: "Lab measurements; INP requires field interaction data and is not estimated here.",
  },
  results,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
