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
      <main className="w-full min-w-0 px-3 py-4 md:px-4 md:py-6 xl:px-6">
        {hideSlip ? (
          <div className="mx-auto w-full max-w-[1680px] min-w-0">
            {children}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[1680px] min-w-0 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-6">
            <div className="min-w-0">{children}</div>

            <aside className="hidden xl:block">
              <div className="vb-sticky-rail">
                <div className="h-full overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/40">
                  <BetSlip variant="desktop" />
                </div>
              </div>
            </aside>

            <div className="xl:hidden">
              <BetSlip variant="mobile" />
            </div>
          </div>
        )}
      </main>
    </BetSlipProvider>
  );
}