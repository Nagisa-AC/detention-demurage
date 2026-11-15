import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["dd-core"],
  poweredByHeader: false,
};

export default nextConfig;
