import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-src"
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ui-src"
});

export const metadata: Metadata = {
  title: "WhichStitch",
  description: "A modern knit counter for rows, repeats, and projects."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e7ece5" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1512" }
  ]
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${hanken.variable}`}>
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
