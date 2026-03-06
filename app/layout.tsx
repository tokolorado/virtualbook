import type { Metadata } from "next";
import "./globals.css";
import Topbar from "@/components/Topbar";
import ClientProviders from "@/components/ClientProviders";

export const metadata: Metadata = {
  title: "VirtualBook",
  description: "Wirtualne zakłady piłkarskie bez prawdziwych pieniędzy",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="bg-neutral-950 text-white">
        <Topbar />
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}