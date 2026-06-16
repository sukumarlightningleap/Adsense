import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
