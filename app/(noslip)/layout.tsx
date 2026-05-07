// app/(noslip)/layout.tsx

export default function NoSlipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="w-full min-w-0">{children}</main>;
}