import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // TEMP build-isolation: BUILD_DIST_DIR redirects the build output so a
  // locally-locked .next/standalone directory (stale Windows file handle)
  // never blocks `next build`. Unset in every normal/CI environment —
  // remove after the boundary fix is verified.
  distDir: process.env.BUILD_DIST_DIR || ".next",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ["firebase-admin", "xlsx"],
  // Performance optimizations
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      '@radix-ui/react-icons',
    ],
  },
};

export default nextConfig;
