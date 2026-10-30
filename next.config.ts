import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Lets a production build run alongside the dev preview without sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native / large server-only parsers are loaded from node_modules, not bundled.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "exceljs", "pdf-lib"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
