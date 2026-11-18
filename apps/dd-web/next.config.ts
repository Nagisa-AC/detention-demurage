import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["dd-core"],
  // dd-core imports its TypeScript sources with .js specifiers. Turbopack does
  // not rewrite those, so dev and build run with --webpack, which honors this.
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
  },
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/pdf-worker": [
      "./node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
      "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    ],
  },
  poweredByHeader: false,
};

export default nextConfig;
