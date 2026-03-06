"use client";

import BetSlip from "@/components/BetSlip";

type BetSlipDockProps = {
  variant?: "sidebar" | "drawer" | "inline" | string;
  className?: string;
};

export default function BetSlipDock({ variant, className }: BetSlipDockProps) {
  // variant zostawiamy, żeby TS nie krzyczał i żebyś mógł w przyszłości różnicować layout
  // na razie go nie używamy
  return (
    <div className={className}>
      <BetSlip variant={variant} />
    </div>
  );
}