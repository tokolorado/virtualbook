// app/(noslip)/layout.tsx

export default function NoSlipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <main>{children}</main>
    </div>
  );
}