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
        <>{children}</>
      ) : (
        <>
          <main className="w-full min-w-0 px-4 py-6 sm:px-5 lg:px-6 2xl:px-8">
            <div className="w-full min-w-0 lg:pr-[392px] xl:pr-[412px]">
              {children}
            </div>
          </main>

          <aside className="fixed bottom-6 right-4 top-[100px] z-40 hidden w-[360px] xl:w-[380px] lg:block">
            <div className="h-full min-h-0">
              <BetSlip variant="desktop" />
            </div>
          </aside>

          <div className="lg:hidden">
            <BetSlip variant="mobile" />
          </div>
        </>
      )}
    </BetSlipProvider>
  );
}