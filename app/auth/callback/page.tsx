import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 text-center shadow-2xl">
            <div className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300">
              VirtualBook
            </div>

            <h1 className="mt-4 text-2xl font-semibold text-white">
              Przetwarzanie autoryzacji
            </h1>

            <p className="mt-3 text-sm text-neutral-300">
              Potwierdzamy logowanie...
            </p>

            <div className="mt-5 text-xs text-neutral-500">
              Za chwilę zostaniesz automatycznie przekierowany.
            </div>
          </div>
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}