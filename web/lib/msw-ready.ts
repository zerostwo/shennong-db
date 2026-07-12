export async function waitForMockWorker() {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_MSW_ENABLED !== "1") return;
  if ((window as Window & { __shennongMswReady?: boolean }).__shennongMswReady) return;
  await Promise.race([
    new Promise<void>((resolve) => window.addEventListener("shennong:msw-ready", () => resolve(), { once: true })),
    new Promise<void>((resolve) => window.setTimeout(resolve, 2_000)),
  ]);
}
