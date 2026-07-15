import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    const developmentScript = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'${developmentScript}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:` },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  async rewrites() {
    const internal = process.env.SHENNONG_API_INTERNAL_URL;
    return internal ? [
      { source: "/.well-known/:path*", destination: `${internal}/.well-known/:path*` },
      { source: "/health", destination: `${internal}/health` },
      { source: "/healthz", destination: `${internal}/healthz` },
      { source: "/metrics", destination: `${internal}/metrics` },
      { source: "/version", destination: `${internal}/version` }
    ] : [];
  },
  poweredByHeader: false,
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: { optimizePackageImports: ["lucide-react"] }
};

export default nextConfig;
