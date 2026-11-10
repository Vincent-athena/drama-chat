import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production runs `node server.js` from .next/standalone (see Dockerfile). `next dev` is unaffected.
  output: "standalone",
  // Pin the tracing root to this project so a lockfile in a parent folder cannot move server.js.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  serverExternalPackages: ["better-sqlite3"],
};
export default nextConfig;
