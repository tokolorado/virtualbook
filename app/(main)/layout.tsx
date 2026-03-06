// app/(main)/layout.tsx
import SurprisePopup from "@/components/SurprisePopup";



export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <main>{children}</main>
      </div>
      <>
        <SurprisePopup />
        {children}
        </>
    </>
  );
}