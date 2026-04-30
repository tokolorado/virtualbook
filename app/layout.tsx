// app/layout.tsx
import type { Metadata } from "next";
import { Roboto_Flex } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Topbar from "@/components/Topbar";
import ClientProviders from "@/components/ClientProviders";

const appFont = Roboto_Flex({
  subsets: ["latin"],
  variable: "--font-app",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VirtualBook",
  description: "Wirtualne zakłady piłkarskie bez prawdziwych pieniędzy",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl" className={appFont.variable}>
      <body className="min-h-screen bg-neutral-950 text-white antialiased">
        <Topbar />
        <ClientProviders>{children}</ClientProviders>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}