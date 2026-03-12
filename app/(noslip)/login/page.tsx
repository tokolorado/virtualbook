import { Suspense } from "react";
import LoginPageClient from "./LoginPageClient";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto mt-10 max-w-5xl px-4 pb-10">
          <div className="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-400">
            Ładowanie...
          </div>
        </div>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}