"use client";

import { BetSlipProvider } from "@/lib/BetSlipContext";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <BetSlipProvider>{children}</BetSlipProvider>;
}