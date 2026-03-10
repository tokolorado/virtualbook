//app/(main)/bets/page.tsx
"use client";
import { formatOdd, formatVB } from "@/lib/format";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Bet = {
  id: string;
  user_id: string;
  stake: number;
  total_odds: number;
  potential_win: number;
  status: "pending" | "won" | "lost" | "void" | string;
  created_at: string;
};

type BetItem = {
  id: string;
  bet_id: string;
  user_id: string;
  match_id_bigint: number;
  league: string;
  home: string;
  away: string;
  market: string;
  pick: string;
  odds: number;
  kickoff_at: string | null;
  created_at: string;
};


function pickLabel(pick: string, home: string, away: string) {
  const p = String(pick || "").toUpperCase();

  if (p === "1") return home;
  if (p === "2") return away;
  if (p === "X") return "Remis";

  return pick;
}


export default function BetsPage() {
  const [loading, setLoading] = useState(true);
  const [bets, setBets] = useState<Bet[]>([]);
  const [itemsByBetId, setItemsByBetId] = useState<Record<string, BetItem[]>>(
    {}
  );
  const [openBetId, setOpenBetId] = useState<string | null>(null);

  const loadBets = async () => {
    setLoading(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;

    if (!userId) {
      setBets([]);
      setItemsByBetId({});
      setLoading(false);
      return;
    }

    // 🔹 Pobierz tylko swoje kupony
    const { data: betsData, error: betsErr } = await supabase
      .from("bets")
      .select("id,user_id,stake,total_odds,potential_win,status,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (betsErr) {
      console.error("BETS LOAD ERROR:", betsErr);
      setBets([]);
      setLoading(false);
      return;
    }

    const safeBets = (betsData ?? []) as Bet[];
    setBets(safeBets);

    const betIds = safeBets.map((b) => b.id);

    if (betIds.length === 0) {
      setItemsByBetId({});
      setLoading(false);
      return;
    }

    // 🔹 Pobierz bet_items (poprawiona kolumna!)
    const { data: itemsData, error: itemsErr } = await supabase
      .from("bet_items")
      .select(
        "id,bet_id,user_id,match_id_bigint,league,home,away,market,pick,odds,kickoff_at,created_at"
      )
      .in("bet_id", betIds)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      console.error("BET_ITEMS LOAD ERROR:", itemsErr);
      setItemsByBetId({});
      setLoading(false);
      return;
    }

    const grouped: Record<string, BetItem[]> = {};
    (itemsData ?? []).forEach((it: any) => {
      if (!grouped[it.bet_id]) grouped[it.bet_id] = [];
      grouped[it.bet_id].push(it as BetItem);
    });

    setItemsByBetId(grouped);
    setLoading(false);
  };

  useEffect(() => {
    loadBets();
  }, []);

  const badgeClass = (status: string) => {
    const s = (status || "").toLowerCase();
    if (s === "won") return "bg-green-500/20 text-green-400 border-green-500/30";
    if (s === "lost") return "bg-red-500/20 text-red-400 border-red-500/30";
    if (s === "void") return "bg-neutral-500/20 text-neutral-300 border-neutral-500/30";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  };

  const labelStatus = (status: string) => {
    const s = (status || "").toLowerCase();
    if (s === "won") return "WYGRANY";
    if (s === "lost") return "PRZEGRANY";
    if (s === "void") return "ZWROT";
    return "OCZEKUJE";
  };

  if (loading) {
    return <div className="text-neutral-400">Ładowanie kuponów...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Moje kupony</h1>
        <p className="text-neutral-400 mt-1 text-sm">
          Historia Twoich wirtualnych zakładów.
        </p>
      </div>

      {bets.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 text-neutral-300">
          Nie masz jeszcze żadnych kuponów.
        </div>
      ) : (
        <div className="space-y-3">
          {bets.map((b) => {
            const isOpen = openBetId === b.id;
            const items = itemsByBetId[b.id] ?? [];

            return (
              <div
                key={b.id}
                className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-neutral-400">
                      {new Date(b.created_at).toLocaleString()}
                    </div>
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-neutral-400">Stawka</div>
                        <div className="font-semibold">{formatVB(b.stake)} VB</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-400">Kurs</div>
                        <div className="font-semibold">{formatOdd(b.total_odds)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-400">Wygrana</div>
                        <div className="font-semibold">
                          {formatVB(b.potential_win)} VB
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-neutral-400">Zdarzenia</div>
                        <div className="font-semibold">{items.length}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={[
                        "text-xs font-semibold px-3 py-1 rounded-full border",
                        badgeClass(b.status),
                      ].join(" ")}
                    >
                      {labelStatus(b.status)}
                    </span>

                    <button
                      onClick={() => setOpenBetId(isOpen ? null : b.id)}
                      className="text-sm px-3 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition"
                    >
                      {isOpen ? "Ukryj" : "Szczegóły"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-4 space-y-2">
                    {items.length === 0 ? (
                      <div className="text-sm text-neutral-400">
                        Brak pozycji kuponu (to nie powinno się zdarzyć).
                      </div>
                    ) : (
                      items.map((it) => (
                        <div
                          key={it.id}
                          className="rounded-xl border border-neutral-800 bg-neutral-950 p-3"
                        >
                          <div className="text-xs text-neutral-400">
                            {it.league} • {it.market}
                          </div>
                          <div className="mt-1 text-sm font-semibold">
                            {it.home}{" "}
                            <span className="text-neutral-400 font-normal">
                              vs
                            </span>{" "}
                            {it.away}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-neutral-300">
                            <span>
                              Typ: <b className="text-white">{pickLabel(it.pick, it.home, it.away)}</b>
                            </span>
                            <span>
                              Kurs:{" "}
                              <b className="text-white">{formatOdd(it.odds)}</b>
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={loadBets}
        className="px-4 py-2 rounded-xl border border-neutral-800 bg-neutral-950 hover:bg-neutral-800 transition text-sm"
      >
        Odśwież
      </button>
    </div>
  );
}