import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "px402 · private agentic payments, x402-shaped",
  description: SITE.description,
  metadataBase: new URL(SITE.url),
  openGraph: {
    title: "px402 · private agentic payments, x402-shaped",
    description: SITE.description,
    url: SITE.url,
    siteName: "px402",
    images: [
      {
        url: "/diagrams/px402-static.png",
        width: 1920,
        height: 1080,
        alt: "px402 protocol diagram. Agent, API server, MagicBlock TEE.",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "px402 · private agentic payments",
    description: SITE.description,
    creator: SITE.twitterHandle,
    images: ["/diagrams/px402-static.png"],
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
