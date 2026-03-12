//app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Topbar from "@/components/Topbar";
import ClientProviders from "@/components/ClientProviders";

export const metadata: Metadata = {
  title: "VirtualBook",
  description: "Wirtualne zakłady piłkarskie bez prawdziwych pieniędzy",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl" className="dark">
      <body className="min-h-screen bg-neutral-950 text-white antialiased">
        <Topbar />
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}