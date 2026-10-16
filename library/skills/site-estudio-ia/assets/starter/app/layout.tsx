import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://neodaemon.com"),
  title: {
    default: "NeoDaemon — AI-first digital studio",
    template: "%s · NeoDaemon",
  },
  description:
    "We design, build, and automate digital products and systems for the modern internet. AI infrastructure, automation, SaaS, and mobile apps by Fábio Cabaceira.",
  keywords: [
    "NeoDaemon",
    "AI studio",
    "automation",
    "SaaS",
    "Fábio Cabaceira",
    "AI infrastructure",
    "OpenClaw",
  ],
  authors: [{ name: "Fábio Cabaceira" }],
  creator: "Fábio Cabaceira",
  openGraph: {
    type: "website",
    url: "https://neodaemon.com",
    title: "NeoDaemon — AI-first digital studio",
    description:
      "We design, build, and automate digital products and systems for the modern internet.",
    siteName: "NeoDaemon",
    // TODO: swap to a finalized 1200×630 og image at /og.png
    images: [{ url: "/logo.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NeoDaemon — AI-first digital studio",
    description:
      "We design, build, and automate digital products and systems for the modern internet.",
    images: ["/logo.png"],
  },
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans bg-bg text-text-primary antialiased">
        <Navbar />
        <main>{children}</main>
        <footer className="border-t border-subtle py-10 px-6">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-xs text-text-muted">
            <span>© {new Date().getFullYear()} NeoDaemon</span>
            <span>Built by Fábio Cabaceira · Leiria, PT</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
