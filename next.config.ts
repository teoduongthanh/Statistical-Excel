import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow the sandbox preview panel (served from *.space-z.ai) to load
  // /_next/* dev assets and the HMR websocket from the dev server.
  // Without this, Next.js 16 dev mode blocks cross-origin dev requests
  // and the page renders blank inside the preview iframe.
  allowedDevOrigins: [
    "*.space-z.ai",
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
  ],
};

export default nextConfig;
