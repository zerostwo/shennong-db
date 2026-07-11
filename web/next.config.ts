import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const internal = process.env.SHENNONG_API_INTERNAL_URL;
    return internal ? [
      { source: "/.well-known/:path*", destination: `${internal}/.well-known/:path*` },
      { source: "/health", destination: `${internal}/health` },
      { source: "/healthz", destination: `${internal}/healthz` }
    ] : [];
  },
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["lucide-react"] }
};

export default nextConfig;
