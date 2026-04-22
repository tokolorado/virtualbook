// app/(noslip)/layout.tsx

export default function NoSlipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full min-w-0 px-4 py-6">
      <main className="min-w-0">{children}</main>
    </div>
  );
}