// app/(noslip)/layout.tsx

export default function NoSlipLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="w-full min-w-0 px-4 py-6 sm:px-5 lg:px-6 2xl:px-8">
      <div className="mx-auto w-full max-w-[1920px] min-w-0">
        {children}
      </div>
    </main>
  );
}