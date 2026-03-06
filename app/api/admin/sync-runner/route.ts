// app/api/admin/sync-runner/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOLDOWN_SECONDS = 65;

// ✅ PRE-MATCH ONLY: zamykamy zakłady 60s przed kickoff
const BETTING_CLOSE_BUFFER_MS = 60_000;

// statusy z football-data, które traktujemy jako “jeszcze nie zakończone”
const OPEN_STATUSES = ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"] as const;

type RunnerBody = {
  // start cursor jeśli chcesz wymusić (YYYY-MM-DD)
  startDate?: string;

  // opcjonalnie ogranicz liczbę dni wprzód (np. +30)
  maxAheadDays?: number;

  // parametry do /api/odds/sync
  leagues?: string[];
  throttleMs?: number;
  maxRetries?: number;

  // model params
  maxGoals?: number;
  homeAdv?: number;
  drawBoost?: number;
  margin?: number;
};

function isYYYYMMDD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function plusSecondsIso(nowIso: string, seconds: number) {
  return new Date(new Date(nowIso).getTime() + seconds * 1000).toISOString();
}

function plusDaysISODate(dateYYYYMMDD: string, days: number) {
  const [y, m, d] = dateYYYYMMDD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function utcTodayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

async function callOddsSync(args: {
  date: string;
  phase: "FETCH_1" | "FETCH_2";
  body: RunnerBody;
}) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const url = new URL(`${base}/api/odds/sync`);

  const payload: any = {
    date: args.date,
    leagues: args.body.leagues,
    throttleMs: args.body.throttleMs ?? 1200,
    maxRetries: args.body.maxRetries ?? 6,

    maxGoals: args.body.maxGoals ?? 7,
    homeAdv: args.body.homeAdv ?? 1.1,
    drawBoost: args.body.drawBoost ?? 1.05,
    margin: args.body.margin ?? 1.06,

    phase: args.phase,
  };

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function closeBettingForStartedMatches(
  sb: ReturnType<typeof supabaseAdmin>
) {
  // Zamykamy obstawianie gdy: now >= kickoff - 60s  <=> kickoff <= now + 60s
  const cutoffIso = new Date(Date.now() + BETTING_CLOSE_BUFFER_MS).toISOString();

  // ⚠️ Poprawka TS:
  // W Twoich typach supabase .select(...) ma tylko 0-1 argument,
  // więc nie używamy { count, head }. Zamiast tego bierzemy minimalne "id"
  // i liczymy długość tablicy.
  const { data, error } = await sb
    .from("matches")
    .update({ betting_closed: true })
    .eq("betting_closed", false)
    .in("status", OPEN_STATUSES as unknown as string[])
    .lte("utc_date", cutoffIso)
    .select("id"); // <- 1 argument, TS przestaje marudzić

  if (error) {
    // nie zabijamy runnera przez to — po prostu logniemy później
    return { ok: false, cutoffIso, closed: 0, error: error.message };
  }

  const closed = Array.isArray(data) ? data.length : 0;

  return {
    ok: true,
    cutoffIso,
    closed,
    error: null as string | null,
  };
}

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  let body: RunnerBody = {};
  try {
    const t = await req.text();
    body = t ? (JSON.parse(t) as RunnerBody) : {};
  } catch {
    body = {};
  }

  // 0) opcjonalny reset kursora (tylko jeśli podasz startDate)
  if (body.startDate && !isYYYYMMDD(body.startDate)) {
    return NextResponse.json(
      { ok: false, error: "startDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (body.startDate) {
    await sb.from("sync_state").upsert({
      id: 1,
      cursor_date: body.startDate,
      phase: "FETCH_1",
      next_run_at: nowIso,
      is_running: false,
      updated_at: nowIso,
    });
  }

  // 1) lock (atomowy)
  const { data: locked, error: lockErr } = await sb.rpc("acquire_sync_lock", {
    p_now: nowIso,
  });

  if (lockErr) {
    return NextResponse.json({ ok: false, error: lockErr.message }, { status: 500 });
  }

  // jeśli null => cooldown albo ktoś inny biega
  if (!locked) {
    const { data: st } = await sb
      .from("sync_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      status: "cooldown_or_locked",
      state: st ?? null,
      now: nowIso,
    });
  }

  const cursorDate: string = String(locked.cursor_date);
  const phase: "FETCH_1" | "FETCH_2" =
    String(locked.phase) === "FETCH_2" ? "FETCH_2" : "FETCH_1";

  // ✅ A) zamknij obstawianie dla meczów, które właśnie “weszły w okno startu”
  const closeRes = await closeBettingForStartedMatches(sb);
  await sb.rpc("prune_future_matches");

  // 2) horyzont (opcjonalny)
  const maxAhead = Number.isFinite(Number(body.maxAheadDays))
    ? Math.max(1, Math.floor(Number(body.maxAheadDays)))
    : 30;

  const today = utcTodayYYYYMMDD();
  const lastAllowed = plusDaysISODate(today, maxAhead);

  if (cursorDate > lastAllowed) {
    // za daleko => wróć na dziś i poczekaj cooldown
    await sb
      .from("sync_state")
      .update({
        cursor_date: today,
        phase: "FETCH_1",
        next_run_at: plusSecondsIso(nowIso, COOLDOWN_SECONDS),
        updated_at: nowIso,
        is_running: false,
      })
      .eq("id", 1);

    await sb.rpc("release_sync_lock", { p_now: nowIso });

    return NextResponse.json({
      ok: true,
      status: "reset_cursor_too_far",
      today,
      maxAheadDays: maxAhead,
      bettingClosedUpdated: closeRes.closed,
      bettingCloseCutoffIso: closeRes.cutoffIso,
      bettingCloseError: closeRes.ok ? null : closeRes.error,
    });
  }

  // 3) wykonaj jeden krok
  let stepOk = false;
  let matchesUpserted = 0;
  let oddsUpserted = 0;
  let message: string | null = null;
  let extra: any = null;

  try {
    const res = await callOddsSync({ date: cursorDate, phase, body });

    stepOk = !!res.ok;
    extra = res.data;

    if (res.ok) {
      matchesUpserted = Number(res.data?.matchesUpserted ?? 0) || 0;
      oddsUpserted = Number(res.data?.oddsUpserted ?? 0) || 0;
    } else {
      message = res.data?.error ?? `odds/sync failed (HTTP ${res.status})`;
    }
  } catch (e: any) {
    stepOk = false;
    message = e?.message ?? "runner_call_error";
  }

  // 4) zapisz log
  await sb.from("sync_logs").insert({
    ran_at: nowIso,
    cursor_date: cursorDate,
    phase,
    ok: stepOk,
    matches_upserted: matchesUpserted,
    odds_upserted: oddsUpserted,
    leagues: body.leagues ?? null,
    message,
    extra: {
      ...(extra ?? {}),
      bettingClosedUpdated: closeRes.closed,
      bettingCloseCutoffIso: closeRes.cutoffIso,
      bettingCloseError: closeRes.ok ? null : closeRes.error,
    },
  });

  // 5) update state + unlock
  const nextRunAt = plusSecondsIso(nowIso, COOLDOWN_SECONDS);

  if (stepOk) {
    if (phase === "FETCH_1") {
      // przejdź do FETCH_2 dla tego samego dnia
      await sb
        .from("sync_state")
        .update({
          phase: "FETCH_2",
          next_run_at: nextRunAt,
          updated_at: nowIso,
          is_running: false,
        })
        .eq("id", 1);
    } else {
      // FETCH_2 zakończony => następny dzień
      await sb
        .from("sync_state")
        .update({
          cursor_date: plusDaysISODate(cursorDate, 1),
          phase: "FETCH_1",
          next_run_at: nextRunAt,
          updated_at: nowIso,
          is_running: false,
        })
        .eq("id", 1);
    }
  } else {
    // przy błędzie: spróbuj ponownie ten sam krok po cooldown
    await sb
      .from("sync_state")
      .update({
        phase,
        next_run_at: nextRunAt,
        updated_at: nowIso,
        is_running: false,
      })
      .eq("id", 1);
  }

  await sb.rpc("release_sync_lock", { p_now: nowIso });

  return NextResponse.json({
    ok: stepOk,
    ran: { date: cursorDate, phase },
    matchesUpserted,
    oddsUpserted,
    nextRunAt,
    message,
    bettingClosedUpdated: closeRes.closed,
    bettingCloseCutoffIso: closeRes.cutoffIso,
    bettingCloseError: closeRes.ok ? null : closeRes.error,
  });
}