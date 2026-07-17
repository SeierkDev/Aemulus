import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { TokenBanner } from "@/components/TokenBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aemulus: show it once, it does the rest",
  description:
    "Aemulus watches you do a task once, learns the intent, and runs it autonomously, flagging only the cases it isn't sure about.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:border focus:border-border focus:bg-bg focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <Providers>
          <TokenBanner />
          <main id="main-content" className="flex flex-1 flex-col">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
