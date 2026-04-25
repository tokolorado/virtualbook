// app/(main)/layout.tsx
import SurprisePopup from "@/components/SurprisePopup";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="w-full min-w-0">{children}</main>
      <SurprisePopup />
    </>
  );
}