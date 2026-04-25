// app/(main)/groups/page.tsx
import type { ReactNode } from "react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function SurfaceCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-neutral-800 bg-neutral-950/70 shadow-[0_18px_80px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </section>
  );
}

function SmallPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "yellow" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
        tone === "neutral" &&
          "border-neutral-800 bg-neutral-950 text-neutral-300",
        tone === "green" && "border-green-500/30 bg-green-500/10 text-green-300",
        tone === "yellow" &&
          "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
        tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-300"
      )}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "green" | "yellow" | "blue";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "neutral" && "border-neutral-800 bg-neutral-950/80",
        tone === "green" && "border-green-500/20 bg-green-500/10",
        tone === "yellow" && "border-yellow-500/20 bg-yellow-500/10",
        tone === "blue" && "border-sky-500/20 bg-sky-500/10"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>

      <div className="mt-2 text-2xl font-semibold leading-tight text-white">
        {value}
      </div>

      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}

function FeatureCard({
  title,
  description,
  badge,
  disabled = false,
}: {
  title: string;
  description: string;
  badge: string;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-950/70 p-5 transition hover:border-neutral-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-white">{title}</div>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            {description}
          </p>
        </div>

        <SmallPill tone={disabled ? "yellow" : "blue"}>{badge}</SmallPill>
      </div>

      <button
        type="button"
        disabled={disabled}
        className={cn(
          "mt-5 w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition",
          disabled
            ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-600"
            : "border-white bg-white text-black hover:bg-neutral-200"
        )}
      >
        {disabled ? "Wkrótce dostępne" : "Otwórz"}
      </button>
    </div>
  );
}

export default function GroupsPage() {
  return (
    <div className="w-full min-w-0 space-y-5 overflow-x-hidden">
      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-neutral-800 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_34%),linear-gradient(135deg,rgba(23,23,23,0.96),rgba(5,5,5,0.99))] p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neutral-500">
                VirtualBook Football
              </div>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Grupy i rywalizacja
              </h1>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-400">
                Prywatne ligi dla znajomych, ranking grupowy i wspólna
                rywalizacja na wirtualne kupony. Ten moduł przygotowujemy jako
                kolejny element społecznościowy aplikacji.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <SmallPill tone="blue">Tryb: grupy prywatne</SmallPill>
                <SmallPill tone="yellow">Status: w przygotowaniu</SmallPill>
                <SmallPill>Bez prawdziwych pieniędzy</SmallPill>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[520px]">
              <StatCard
                label="Moje grupy"
                value="0"
                hint="Po wdrożeniu zobaczysz tu swoje ligi"
                tone="blue"
              />

              <StatCard
                label="Aktywne rywalizacje"
                value="0"
                hint="Tygodniowe i sezonowe rankingi"
              />

              <StatCard
                label="Zaproszenia"
                value="Kod"
                hint="Dołączanie po kodzie grupy"
                tone="yellow"
              />

              <StatCard
                label="Model"
                value="Social"
                hint="Rankingi znajomych i mini-ligi"
                tone="green"
              />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-sm leading-6 text-yellow-200">
            Moduł grup jest jeszcze ekranem przygotowawczym. Aktualnie pokazuje
            docelowy układ produkcyjny, ale tworzenie i dołączanie do grup
            trzeba jeszcze podpiąć pod bazę oraz API.
          </div>
        </div>
      </SurfaceCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <FeatureCard
              title="Utwórz grupę"
              description="Załóż prywatną ligę, nazwij ją i zaproś znajomych do wspólnego rankingu."
              badge="Create"
              disabled
            />

            <FeatureCard
              title="Dołącz kodem"
              description="Wpisz kod zaproszenia od znajomego i dołącz do istniejącej grupy."
              badge="Join"
              disabled
            />

            <FeatureCard
              title="Ranking grupowy"
              description="Porównuj profit, saldo, winrate i aktywne kupony tylko w ramach swojej grupy."
              badge="Ranking"
              disabled
            />
          </div>

          <SurfaceCard className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xl font-semibold text-white">
                  Docelowy zakres modułu
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-neutral-400">
                  Grupy powinny działać jak prywatne ligi bukmacherskie:
                  użytkownik tworzy grupę, dostaje kod zaproszenia, inni
                  dołączają, a ranking liczony jest tylko dla członków tej
                  grupy.
                </p>
              </div>

              <SmallPill tone="blue">Plan produkcyjny</SmallPill>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="text-sm font-semibold text-white">
                  1. Tabela groups
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  Nazwa, owner, invite code, visibility i timestamps.
                </p>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="text-sm font-semibold text-white">
                  2. Członkowie
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  Powiązanie userów z grupami, role i data dołączenia.
                </p>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="text-sm font-semibold text-white">
                  3. Ranking
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  Widok rankingowy filtrowany po członkach grupy.
                </p>
              </div>

              <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
                <div className="text-sm font-semibold text-white">
                  4. Bezpieczeństwo
                </div>
                <p className="mt-2 text-xs leading-5 text-neutral-400">
                  RLS: tylko członkowie widzą grupę i jej ranking.
                </p>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-[88px] space-y-4">
            <SurfaceCard className="p-5">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                Groups
              </div>

              <div className="mt-2 text-2xl font-semibold text-white">
                Snapshot
              </div>

              <p className="mt-2 text-sm leading-6 text-neutral-400">
                Skrót przyszłego modułu grupowego i funkcji społecznościowych.
              </p>

              <div className="mt-5 grid gap-3">
                <StatCard
                  label="Widoczność"
                  value="Private"
                  hint="Grupy po kodzie zaproszenia"
                />

                <StatCard
                  label="Ranking"
                  value="Group"
                  hint="Osobna tabela wyników dla znajomych"
                  tone="blue"
                />

                <StatCard
                  label="Status"
                  value="Next"
                  hint="Kolejny moduł do implementacji"
                  tone="yellow"
                />
              </div>
            </SurfaceCard>
          </div>
        </aside>
      </div>
    </div>
  );
}