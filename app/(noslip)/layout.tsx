// app/(noslip)/layout.tsx

export default function NoSlipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="h-[calc(100dvh-96px)] min-h-0 w-full min-w-0 overflow-hidden px-4 sm:px-5 lg:px-6 2xl:px-8">
      <div className="mx-auto h-full min-h-0 w-full max-w-[1920px] min-w-0">
        {children}
      </div>
    </main>
  );
}