import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "AI Dungeon Master";
const DESCRIPTION =
  "A text adventure where Claude is the dungeon master. Type what you do; the world responds.";

export const metadata: Metadata = {
  title: { default: TITLE, template: "%s · AI Dungeon Master" },
  description: DESCRIPTION,
  applicationName: TITLE,
  authors: [{ name: "Henry Myos" }],
  keywords: [
    "AI",
    "Anthropic",
    "Claude",
    "Dungeons & Dragons",
    "Text Adventure",
    "Tool Use",
    "Agent",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: TITLE,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0907",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
