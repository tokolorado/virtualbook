//app/(main)/bets/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatBetSelectionLabels } from "@/lib/odds/labels";
import { supabase } from "@/lib/supabase";

type BetRow = {
  id: string;
  user_id: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: string; // pending | won | lost | void
  settled: boolean;
  settled_at: string | null;
  payout: number | null;
  created_at: string;
  bet_type: string | null;
  pricing_meta: Record<string, unknown> | null;
  public_share_enabled: boolean | null;
  public_share_token: string | null;
  public_share_created_at: string | null;
};

type BetItemRow = {
  id: string;
  bet_id: string;
  user_id: string;
  match_id_bigint: number | null;
  league: string;
  home: string;
  away: string;
  market: string;
  pick: string;
  odds: number;
  kickoff_at: string | null;
  result: string | null; // won | lost | void (albo Twoje wartości)
  settled: boolean | null;
  settled_at: string | null;
  created_at: string;
};

type BetTimelineStep = {
  id: string;
  at: string | null;
  title: string;
  description: string;
  tone: "neutral" | "green" | "red" | "yellow" | "blue";
};

const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);

function badgeClass(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "won") return "bg-green-900/30 border-green-800 text-green-200";
  if (s === "lost") return "bg-red-900/30 border-red-800 text-red-200";
  if (s === "void") return "bg-yellow-900/30 border-yellow-800 text-yellow-200";
  if (s === "pending") return "bg-neutral-900/30 border-neutral-700 text-neutral-200";
  return "bg-neutral-900/30 border-neutral-700 text-neutral-200";
}

function statusLabel(status: string) {
  const s = String(status || "").toLowerCase();
  if (s === "won") return "WYGRANY";
  if (s === "lost") return "PRZEGRANY";
  if (s === "void") return "ZWROT (VOID)";
  if (s === "pending") return "W GRZE";
  return String(status || "").toUpperCase();
}

function itemResultLabel(r: string | null) {
  const s = String(r || "").toLowerCase();
  if (!r) return "—";
  if (s === "won") return "trafiony";
  if (s === "lost") return "nietrafiony";
  if (s === "void") return "void";
  return r;
}

function timelineToneClass(tone: BetTimelineStep["tone"]) {
  if (tone === "green") return "border-green-500/30 bg-green-500/10";
  if (tone === "red") return "border-red-500/30 bg-red-500/10";
  if (tone === "yellow") return "border-yellow-500/30 bg-yellow-500/10";
  if (tone === "blue") return "border-sky-500/30 bg-sky-500/10";
  return "border-neutral-800 bg-neutral-950/60";
}

function timelineDotClass(tone: BetTimelineStep["tone"]) {
  if (tone === "green") return "bg-green-400";
  if (tone === "red") return "bg-red-400";
  if (tone === "yellow") return "bg-yellow-400";
  if (tone === "blue") return "bg-sky-400";
  return "bg-neutral-500";
}

function formatTimelineDate(value: string | null) {
  if (!value) return "Czas nieznany";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Czas nieznany";
  return date.toLocaleString("pl-PL");
}

function buildBetTimeline(bet: BetRow, items: BetItemRow[]): BetTimelineStep[] {
  const steps: BetTimelineStep[] = [
    {
      id: "bet-created",
      at: bet.created_at,
      title: "Kupon postawiony",
      description: `Stawka ${fmt2(bet.stake)} VB, kurs łączny ${fmt2(bet.total_odds)}.`,
      tone: "blue",
    },
  ];

  for (const item of items) {
    const labels = formatBetSelectionLabels({
      market: item.market,
      pick: item.pick,
      home: item.home,
      away: item.away,
    });

    if (item.kickoff_at) {
      steps.push({
        id: `${item.id}-kickoff`,
        at: item.kickoff_at,
        title: "Start meczu",
        description: `${item.home} vs ${item.away} · ${labels}.`,
        tone: "neutral",
      });
    }

    if (item.settled_at || item.result) {
      const result = String(item.result ?? "").toLowerCase();
      steps.push({
        id: `${item.id}-settled`,
        at: item.settled_at ?? bet.settled_at ?? item.created_at,
        title: "Pozycja rozliczona",
        description: `${labels} · wynik: ${itemResultLabel(item.result)}.`,
        tone:
          result === "won"
            ? "green"
            : result === "lost"
              ? "red"
              : result === "void"
                ? "yellow"
                : "neutral",
      });
    }
  }

  if (bet.settled_at || bet.settled) {
    const status = String(bet.status).toLowerCase();
    steps.push({
      id: "bet-settled",
      at: bet.settled_at ?? null,
      title: "Kupon rozliczony",
      description: `Status: ${statusLabel(bet.status)} · wypłata ${
        bet.payout != null ? `${fmt2(bet.payout)} VB` : "nieustalona"
      }.`,
      tone:
        status === "won"
          ? "green"
          : status === "lost"
            ? "red"
            : status === "void"
              ? "yellow"
              : "neutral",
    });
  }

  return steps.sort((a, b) => {
    const aTime = Date.parse(a.at ?? "");
    const bTime = Date.parse(b.at ?? "");
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  });
}

export default function BetDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const betId = params?.id;

  const [loading, setLoading] = useState(true);
  const [bet, setBet] = useState<BetRow | null>(null);
  const [items, setItems] = useState<BetItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const summary = useMemo(() => {
    const total = items.length;
    const settledOk = items.filter((x) => x.settled === true && x.result != null).length;
    const open = total - settledOk;

    const hasLost = items.some((x) => String(x.result || "").toLowerCase() === "lost");
    const nonVoidCount = items.filter((x) => String(x.result || "").toLowerCase() !== "void").length;

    return { total, settledOk, open, hasLost, nonVoidCount };
  }, [items]);

  const timeline = useMemo(() => {
    if (!bet) return [];
    return buildBetTimeline(bet, items);
  }, [bet, items]);

  const load = async () => {
    if (!betId) return;

    setLoading(true);
    setError(null);

    try {
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const uid = sessionData.session?.user?.id;
      if (!uid) {
        setError("Musisz być zalogowany, żeby zobaczyć kupon.");
        setBet(null);
        setItems([]);
        setLoading(false);
        return;
      }

      // 1) bet
      const { data: betRow, error: betErr } = await supabase
        .from("bets")
        .select(
          [
            "id",
            "user_id",
            "stake",
            "total_odds",
            "potential_win",
            "status",
            "settled",
            "settled_at",
            "payout",
            "created_at",
            "bet_type",
            "pricing_meta",
            "public_share_enabled",
            "public_share_token",
            "public_share_created_at",
          ].join(",")
        )
        .eq("id", betId)
        .maybeSingle<BetRow>();

      if (betErr) throw betErr;
      if (!betRow) {
        setError("Nie znaleziono kuponu (albo nie masz dostępu).");
        setBet(null);
        setItems([]);
        setLoading(false);
        return;
      }

      // Jeśli RLS jest poprawny, ten check jest “miły dodatek”.
      // Admin może oglądać cudze — user nie powinien, więc RLS i tak to zablokuje.
      // Tu nie robimy żadnej logiki adminowej: to jest widok user-only.
      if (betRow.user_id !== uid) {
        setError("Nie masz dostępu do tego kuponu.");
        setBet(null);
        setItems([]);
        setLoading(false);
        return;
      }

      setBet(betRow);
      setShareError(null);
      setShareCopied(false);
      setShareUrl(
        betRow.public_share_enabled && betRow.public_share_token
          ? `${window.location.origin}/shared/bets/${betRow.public_share_token}`
          : null
      );

      // 2) bet items
      const { data: itemRows, error: itemsErr } = await supabase
        .from("bet_items")
        .select(
          "id,bet_id,user_id,match_id_bigint,league,home,away,market,pick,odds,kickoff_at,result,settled,settled_at,created_at"
        )
        .eq("bet_id", betId)
        .order("created_at", { ascending: true });

      if (itemsErr) throw itemsErr;

      setItems((itemRows ?? []) as BetItemRow[]);
    } catch (e: unknown) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "Nie udało się pobrać kuponu."
      );
      setBet(null);
      setItems([]);
      setShareUrl(null);
    } finally {
      setLoading(false);
    }
  };

  const createShareLink = async () => {
    if (!bet?.id) return;

    setShareLoading(true);
    setShareError(null);
    setShareCopied(false);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Nie jestes zalogowany.");

      const response = await fetch(`/api/bets/${bet.id}/share`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; shareUrl?: string; token?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.shareUrl) {
        throw new Error(payload?.error ?? "Nie udalo sie utworzyc linku.");
      }

      setShareUrl(payload.shareUrl);
      setBet((current) =>
        current
          ? {
              ...current,
              public_share_enabled: true,
              public_share_token: payload.token ?? current.public_share_token,
              public_share_created_at:
                current.public_share_created_at ?? new Date().toISOString(),
            }
          : current
      );
    } catch (err: unknown) {
      setShareError(
        err instanceof Error ? err.message : "Nie udalo sie utworzyc linku."
      );
    } finally {
      setShareLoading(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareError("Nie udalo sie skopiowac linku.");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betId]);

  if (loading) {
    return <div className="max-w-5xl mx-auto text-neutral-400">Ładowanie…</div>;
  }

  if (error || !bet) {
    return (
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-neutral-300">
          {error ?? "Nie udało się załadować kuponu."}
        </div>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
        >
          Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Kupon</h1>
          <div className="text-sm text-neutral-400 mt-1 break-all">ID: {bet.id}</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={shareUrl ? copyShareLink : createShareLink}
            disabled={shareLoading}
            className="px-4 py-2 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 transition text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shareLoading
              ? "Tworzenie..."
              : shareUrl
                ? shareCopied
                  ? "Skopiowano"
                  : "Kopiuj link"
                : "Udostepnij"}
          </button>
          <button
            onClick={load}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Odśwież
          </button>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
          >
            Wróć
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full border text-xs font-semibold ${badgeClass(
                bet.status
              )}`}
            >
              {statusLabel(bet.status)}
            </span>
            <span className="text-xs text-neutral-500">
              Utworzono:{" "}
              <span className="text-neutral-300">{new Date(bet.created_at).toLocaleString()}</span>
            </span>
          </div>

          <div className="text-xs text-neutral-400">
            Settled: <b className="text-white">{bet.settled ? "TAK" : "NIE"}</b>
            {bet.settled_at ? (
              <span className="text-neutral-500">
                {" "}
                · {new Date(bet.settled_at).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Stawka</div>
            <div className="text-lg font-semibold">{fmt2(bet.stake)} VB</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Kurs łączny</div>
            <div className="text-lg font-semibold">{fmt2(bet.total_odds)}</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Potencjalna wygrana</div>
            <div className="text-lg font-semibold">{fmt2(bet.potential_win)} VB</div>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-xs text-neutral-400">Wypłata</div>
            <div className="text-lg font-semibold">
              {bet.payout != null ? `${fmt2(bet.payout)} VB` : "—"}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
          <span>
            Pozycje: <b className="text-white">{summary.total}</b>
          </span>
          <span>
            Rozliczone: <b className="text-white">{summary.settledOk}</b>
          </span>
          <span>
            Otwarte: <b className="text-white">{summary.open}</b>
          </span>
        </div>

        {shareUrl || shareError ? (
          <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              Link publiczny
            </div>
            {shareUrl ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  readOnly
                  value={shareUrl}
                  className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
                />
                <button
                  type="button"
                  onClick={copyShareLink}
                  className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-900"
                >
                  {shareCopied ? "Skopiowano" : "Kopiuj"}
                </button>
              </div>
            ) : null}
            {shareError ? (
              <div className="mt-2 text-sm text-red-200">{shareError}</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Timeline kuponu</div>
            <div className="mt-1 text-xs text-neutral-500">
              Chronologia postawienia, startu meczów i rozliczeń.
            </div>
          </div>
          <div className="text-xs text-neutral-500">kroki: {timeline.length}</div>
        </div>

        <div className="mt-4 space-y-3">
          {timeline.map((step) => (
            <div
              key={step.id}
              className={`relative rounded-2xl border p-4 pl-11 ${timelineToneClass(step.tone)}`}
            >
              <span
                className={`absolute left-4 top-5 h-3 w-3 rounded-full ${timelineDotClass(step.tone)}`}
              />
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="font-semibold text-white">{step.title}</div>
                  <div className="mt-1 text-sm leading-6 text-neutral-300">
                    {step.description}
                  </div>
                </div>
                <div className="shrink-0 text-xs text-neutral-500">
                  {formatTimelineDate(step.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div className="font-semibold">Pozycje kuponu</div>
          <div className="text-xs text-neutral-500">razem: {items.length}</div>
        </div>

        {items.length === 0 ? (
          <div className="p-4 text-neutral-400 text-sm">Brak pozycji (to nie powinno się zdarzyć).</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-400">
                <tr className="border-b border-neutral-800">
                  <th className="text-left font-medium px-4 py-3">Mecz</th>
                  <th className="text-left font-medium px-4 py-3">Rynek</th>
                  <th className="text-left font-medium px-4 py-3">Typ</th>
                  <th className="text-right font-medium px-4 py-3">Kurs</th>
                  <th className="text-left font-medium px-4 py-3">Wynik</th>
                  <th className="text-left font-medium px-4 py-3">Kickoff</th>
                </tr>
              </thead>

              <tbody>
                {items.map((it) => {
                  const labels = formatBetSelectionLabels({
                    market: it.market,
                    pick: it.pick,
                    home: it.home,
                    away: it.away,
                  });

                  return (
                    <tr key={it.id} className="border-b border-neutral-800/70 hover:bg-neutral-950/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-200">
                        {it.home} — {it.away}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {it.league}
                        {it.match_id_bigint ? (
                          <span className="text-neutral-600"> · match {it.match_id_bigint}</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-neutral-200">
                      {labels.marketLabel}
                    </td>
                    <td className="px-4 py-3 text-neutral-200">
                      {labels.selectionLabel}
                    </td>

                    <td className="px-4 py-3 text-right font-semibold text-neutral-200">
                      {fmt2(it.odds)}
                    </td>

                    <td className="px-4 py-3">
                      <div className="text-neutral-200">{itemResultLabel(it.result)}</div>
                      <div className="text-xs text-neutral-500">
                        settled:{" "}
                        <span className="text-neutral-300">
                          {it.settled === true ? "TAK" : "NIE"}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-neutral-300 whitespace-nowrap">
                      {it.kickoff_at ? new Date(it.kickoff_at).toLocaleString() : "—"}
                    </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ✅ brak guzika "rozlicz ponownie" celowo */}
      <div className="text-xs text-neutral-500">
        Ten widok jest tylko do podglądu. Rozliczanie odbywa się automatycznie albo przez panel admina.
      </div>
    </div>
  );
}
