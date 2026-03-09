// app/(main)/layout.tsx
import SurprisePopup from "@/components/SurprisePopup";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="w-full min-w-0 px-4 py-6">
        <main className="min-w-0">{children}</main>
      </div>

      <SurprisePopup />
    </>
  );
}