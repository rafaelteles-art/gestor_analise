import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com", // fotos de perfil do Google OAuth
      },
    ],
  },
};

export default nextConfig;
