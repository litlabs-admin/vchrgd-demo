import type { NextConfig } from "next";
import path from "node:path";

const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.square.site https://*.square.site",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com https://widget.trustpilot.com",
  "connect-src 'self' https://connect.squareup.com https://connect.squareupsandbox.com https://checkout.square.site https://*.square.site https://api.jumptech.co.uk https://eve.jumptech.co.uk https://merchant-api.staging.tymit.com https://merchant-api.tymit.com https://chat.googleapis.com",
  "frame-src 'self' https://checkout.square.site https://*.square.site https://widget.trustpilot.com",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
    : []),
] satisfies Array<{ key: string; value: string }>;

const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
] satisfies Array<{ key: string; value: string }>;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/backoffice/work-orders/[workflowId]": [
      "./public/content/vchrgd-logo-light.png",
      "./public/content/work-order-font.ttf",
    ],
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      // Serve the static home-charging landing page for the clean URL so
      // links like /home-charging#payment resolve instead of 404ing.
      { source: "/home-charging", destination: "/home-charging/index.html" },
      { source: "/home-charging/", destination: "/home-charging/index.html" },
      // Rebuilt VCHRGD homepage, built on the same design system as the
      // home-charging page. Clean URL -> static file.
      { source: "/home-page", destination: "/home-page/index.html" },
      { source: "/home-page/", destination: "/home-page/index.html" },
      // Seven Pro product page, built on the same design system as the
      // home-charging page. Clean URL -> static file.
      { source: "/SevenPro", destination: "/SevenPro/index.html" },
      { source: "/SevenPro/", destination: "/SevenPro/index.html" },
      // TwentyTwo Pro product page, same design system. Clean URL -> static file.
      { source: "/twenty-two-pro", destination: "/twenty-two-pro/index.html" },
      { source: "/twenty-two-pro/", destination: "/twenty-two-pro/index.html" },
      // Partners & News page, same design system. Clean URL -> static file.
      { source: "/partners-news", destination: "/partners-news/index.html" },
      { source: "/partners-news/", destination: "/partners-news/index.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/backoffice/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/survey-review/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/card/return",
        headers: noStoreHeaders,
      },
      {
        source: "/frasers-plus/return",
        headers: noStoreHeaders,
      },
      {
        source: "/card/square",
        headers: noStoreHeaders,
      },
      {
        source: "/api/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/api/admin/:path*",
        headers: noStoreHeaders,
      },
      {
        source: "/api/backoffice/:path*",
        headers: noStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
