// components/ClientProviders.tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BetSlipProvider } from "@/lib/BetSlipContext";
import BetSlip from "@/components/BetSlip";
import { supabase } from "@/lib/supabase";

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // ✅ Tu kontrolujesz gdzie ukryć kupon
  const hideSlip =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/wallet");

  useEffect(() => {
    // (opcjonalnie) nie odpalaj weekly-grant na publicznych stronach
    if (pathname.startsWith("/login") || pathname.startsWith("/register")) return;

    const runWeeklyGrant = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) return;
      if (!data?.user) return;

      await supabase.rpc("vb_weekly_grant_if_due", {
        p_user_id: data.user.id,
      });
    };

    runWeeklyGrant();
  }, [pathname]);

  return (
    <BetSlipProvider>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {hideSlip ? (
          // ✅ Layout bez kuponu (admin/account/wallet)
          <div>{children}</div>
        ) : (
          // ✅ Standard layout z kuponem
          <>
            {/* Desktop: content + sticky slip */}
            <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-6">
              <div>{children}</div>
              <div className="hidden lg:block">
                <BetSlip variant="desktop" />
              </div>
            </div>

            {/* Mobile: drawer */}
            <div className="lg:hidden">
              <BetSlip variant="mobile" />
            </div>
          </>
        )}
      </main>
    </BetSlipProvider>
  );
}