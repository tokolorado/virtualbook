// app/api/admin/sync-runner/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOLDOWN_SECONDS = 65;

// PRE-MATCH ONLY: zamykamy zakłady 60s przed kickoff
const BETTING_CLOSE_BUFFER_MS = 60_000;

// statusy z football-data, które traktujemy jako jeszcze nie zakończone
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

async function closeBettingForStartedMatches(
  sb: ReturnType<typeof supabaseAdmin>
) {
  // Zamykamy obstawianie gdy: now >= kickoff - 60s  <=> kickoff <= now + 60s
  const cutoffIso = new Date(Date.now() + BETTING_CLOSE_BUFFER_MS).toISOString();

  const { data, error } = await sb
    .from("matches")
    .update({ betting_closed: true })
    .eq("betting_closed", false)
    .in("status", OPEN_STATUSES as unknown as string[])
    .lte("utc_date", cutoffIso)
    .select("id");

  if (error) {
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
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: guard.error },
      { status: guard.status }
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Missing CRON_SECRET in env" },
      { status: 500 }
    );
  }

  const host = req.headers.get("host");
  if (!host) {
    return NextResponse.json(
      { ok: false, error: "Missing host header" },
      { status: 400 }
    );
  }

  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") ? "http" : "https");

  const baseUrl = `${proto}://${host}`;

  const postInternal = async (path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(
        `${path} failed: ${data?.error ?? data?.message ?? res.statusText}`
      );
    }

    return data;
  };

  const callOddsSync = async (args: {
    date: string;
    phase: "FETCH_1" | "FETCH_2";
    body: RunnerBody;
  }) => {
    const payload = {
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

    return await postInternal("/api/odds/sync", payload);
  };

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
    return NextResponse.json(
      { ok: false, error: lockErr.message },
      { status: 500 }
    );
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

  let released = false;

  try {
    // A) zamknij obstawianie dla meczów, które właśnie weszły w okno startu
    const closeRes = await closeBettingForStartedMatches(sb);
    await sb.rpc("prune_future_matches");

    // 2) horyzont (opcjonalny)
    const maxAhead = Number.isFinite(Number(body.maxAheadDays))
      ? Math.max(1, Math.floor(Number(body.maxAheadDays)))
      : 30;

    const today = utcTodayYYYYMMDD();
    const lastAllowed = plusDaysISODate(today, maxAhead);

    if (cursorDate > lastAllowed) {
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
      released = true;

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

      stepOk = true;
      extra = res;
      matchesUpserted = Number(res?.matchesUpserted ?? 0) || 0;
      oddsUpserted = Number(res?.oddsUpserted ?? 0) || 0;
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

    // 5) update state
    const nextRunAt = plusSecondsIso(nowIso, COOLDOWN_SECONDS);

    if (stepOk) {
      if (phase === "FETCH_1") {
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
    released = true;

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
  } catch (e: any) {
    if (!released) {
      await sb.rpc("release_sync_lock", { p_now: nowIso });
    }

    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "sync_runner_failed",
      },
      { status: 500 }
    );
  }
}