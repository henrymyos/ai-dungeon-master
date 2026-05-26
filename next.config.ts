import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Pollinations.ai serves the scene illustrations.
      { protocol: "https", hostname: "image.pollinations.ai" },
    ],
  },
};

export default nextConfig;
