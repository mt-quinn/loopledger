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
    <html lang="en" className={`${fraunces.variable} ${hanken.variable}`} suppressHydrationWarning>
      <head>
        {/* Stamp the stored theme before first paint so dark-mode users never see a light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('whichstitch-theme-v1');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}"
          }}
        />
      </head>
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
