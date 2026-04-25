// components/ClientProviders.tsx
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

    void runWeeklyGrant();
  }, [pathname]);

  return (
    <BetSlipProvider>
      {hideSlip ? (
        <div className="w-full min-w-0">{children}</div>
      ) : (
        <>
          <div className="mx-auto grid w-full max-w-[1920px] grid-cols-1 gap-5 px-4 py-6 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-6 2xl:px-8">
            <div className="min-w-0">{children}</div>

            <aside className="hidden min-w-0 lg:block">
              <div className="sticky top-[88px] h-[calc(100dvh-104px)] min-h-0">
                <BetSlip variant="desktop" />
              </div>
            </aside>
          </div>

          <div className="lg:hidden">
            <BetSlip variant="mobile" />
          </div>
        </>
      )}
    </BetSlipProvider>
  );
}