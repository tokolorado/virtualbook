"use client";

import { usePathname } from "next/navigation";
import BetSlip from "@/components/BetSlip";

type BetSlipDockProps = {
  variant?: "sidebar" | "drawer" | "inline" | string;
  className?: string;
};

function shouldHideBetSlip(pathname: string | null) {
  if (!pathname) return false;

  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/wallet") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/auth")
  );
}

export default function BetSlipDock({
  variant,
  className,
}: BetSlipDockProps) {
  const pathname = usePathname();

  if (shouldHideBetSlip(pathname)) {
    return null;
  }

  return (
    <div className={className}>
      <BetSlip variant={variant} />
    </div>
  );
}