import type { Metadata } from "next";
import { Geist, Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Checkout typeface: a free, open-licence alternative to Revolut's Aeonik.
// Scoped to the checkout through .ck-root so the back office keeps Roboto.
const geist = Geist({
  variable: "--font-checkout",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "VCHRGD Checkout",
  description: "VCHRGD charger installation checkout.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${roboto.variable} ${geist.variable}`}>
      <body>{children}</body>
    </html>
  );
}
