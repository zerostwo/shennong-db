import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const internal = process.env.SHENNONG_API_INTERNAL_URL;
    return internal ? [{ source: "/api/v1/:path*", destination: `${internal}/api/v1/:path*` }, { source: "/healthz", destination: `${internal}/healthz` }] : [];
  },
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["lucide-react"] }
};

export default nextConfig;
