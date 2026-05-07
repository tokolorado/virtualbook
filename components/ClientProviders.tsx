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
    pathname.startsWith("/shared") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/account") ||
    pathname.startsWith("/wallet")
  );
}

function shouldSkipWeeklyGrant(pathname: string) {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/shared")
  );
}

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "";
  const hideSlip = shouldHideSlip(pathname);
  const isEventsPage = pathname.startsWith("/events");

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
          <main
            className={
              isEventsPage
                ? "w-full min-w-0 py-6 px-0"
                : "w-full min-w-0 px-4 py-6 sm:px-5 lg:px-6 2xl:px-8"
            }
          >
            <div
              className={
                isEventsPage
                  ? "w-full min-w-0 lg:pr-[380px] xl:pr-[400px]"
                  : "w-full min-w-0 lg:pr-[376px] xl:pr-[396px]"
              }
            >
              {children}
            </div>
          </main>

          <aside
            className={
              isEventsPage
                ? "fixed bottom-0 right-0 top-[100px] z-40 hidden w-[360px] xl:w-[380px] lg:block"
                : "fixed bottom-6 right-6 top-[100px] z-40 hidden w-[360px] xl:w-[380px] 2xl:right-8 lg:block"
            }
          >
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