import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.pollinations.ai" },
      // Together AI's signed delivery URLs for fresh generations.
      { protocol: "https", hostname: "api.together.xyz" },
      { protocol: "https", hostname: "api.together.ai" },
      // Supabase Storage permanent URLs for cached/persisted scenes.
      {
        protocol: "https",
        hostname: "vlhfljrfqltguaefmzpx.supabase.co",
        pathname: "/storage/v1/object/public/scenes/**",
      },
    ],
  },
};

export default nextConfig;
