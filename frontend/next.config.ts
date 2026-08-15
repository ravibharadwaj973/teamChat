import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev-tools badge in the page corner
  devIndicators: false,
  // Produces .next/standalone — a self-contained server + pruned
  // node_modules — so the Docker image doesn't need the full node_modules.
  output: "standalone",
  // Repo root has its own package.json (shared mongoose install for
  // backend/socket), which makes Next infer IT as the workspace root and
  // nest standalone output under .next/standalone/frontend/. Pin the root
  // to this folder so the output stays flat at .next/standalone/server.js.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
