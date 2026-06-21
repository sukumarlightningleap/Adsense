import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships platform-specific native binaries (libvips). When Next
  // bundles it for the serverless runtime the .node binary path breaks
  // on the lambda. Marking it external tells Next to load it as a plain
  // Node require at runtime, letting Vercel's environment resolve the
  // right linux-x64 binary itself.
  serverExternalPackages: ["sharp"],
  experimental: {
    // Bump the default server-action body limit so asset uploads up to
    // 10MB succeed. Default is 1MB which trips even a single full-res
    // JPEG. We still validate per-file size in the upload action.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
