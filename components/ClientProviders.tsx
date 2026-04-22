//components/Clientproviders.tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BetSlipProvider } from "@/lib/BetSlipContext";
import BetSlip from "@/components/BetSlip";
import { supabase } from "@/lib/supabase";

function shouldHideSlip(pathname: string) {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/wallet")
  );
}

function shouldSkipWeeklyGrant(pathname: string) {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/auth")
  );
}

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";

  const hideSlip = shouldHideSlip(pathname);

  useEffect(() => {
    if (shouldSkipWeeklyGrant(pathname)) return;

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
      <div className="w-full min-w-0 px-4 py-6">
        {hideSlip ? (
          <div className="min-w-0">{children}</div>
        ) : (
          <>
            <div className="min-w-0 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
              <div className="min-w-0">{children}</div>

              <div className="hidden lg:block">
                <BetSlip variant="desktop" />
              </div>
            </div>

            <div className="lg:hidden">
              <BetSlip variant="mobile" />
            </div>
          </>
        )}
      </div>
    </BetSlipProvider>
  );
}