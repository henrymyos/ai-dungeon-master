import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // Baseline hardening: no MIME sniffing, no framing by other sites (nothing embeds this app).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
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
      {
        protocol: "https",
        hostname: "vlhfljrfqltguaefmzpx.supabase.co",
        pathname: "/storage/v1/object/public/portraits/**",
      },
    ],
  },
};

export default nextConfig;
