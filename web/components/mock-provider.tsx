"use client";

import { useEffect } from "react";

export function MockProvider({ children }: { children: React.ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_MSW_ENABLED === "1";

  useEffect(() => {
    if (!enabled) return;
    void import("@/mocks/browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass" }))
      .finally(() => {
        (window as Window & { __shennongMswReady?: boolean }).__shennongMswReady = true;
        window.dispatchEvent(new Event("shennong:msw-ready"));
      });
  }, [enabled]);

  return children;
}
