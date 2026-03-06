// app/api/ratings/update/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotRow = {
  team_id: number;
  competition_id: string;
  season: string | null;
  snapshot_date: string;
  played_games: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

type RawRatingRow = {
  team_id: number;
  competition_id: string;
  season: string | null;
  rating_date: string;
  attack_rating: number;
  defense_rating: number;
  form_rating: number;
  raw_rating: number;
  matches_count: number;
};

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export async function POST() {
  try {
    const sb = supabaseAdmin();

    // Bierzemy najnowszy snapshot per (competition_id, season, team_id)
    const { data, error } = await sb
      .from("standings_snapshots")
      .select(
        "team_id, competition_id, season, snapshot_date, played_games, goals_for, goals_against, goal_difference, points"
      )
      .order("snapshot_date", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `standings_snapshots read failed: ${error.message}` },
        { status: 500 }
      );
    }

    const allRows = (data ?? []) as SnapshotRow[];
    if (!allRows.length) {
      return NextResponse.json({ ok: true, teamsRated: 0, reason: "no_snapshots" });
    }

    // dedupe: bierzemy tylko najnowszy wpis per team/competition/season
    const latestMap = new Map<string, SnapshotRow>();
    for (const row of allRows) {
      const key = `${row.competition_id}__${row.season ?? "null"}__${row.team_id}`;
      if (!latestMap.has(key)) {
        latestMap.set(key, row);
      }
    }

    const latestRows = Array.from(latestMap.values());

    const rawRatings: RawRatingRow[] = [];

    for (const row of latestRows) {
      const games = Number(row.played_games ?? 0);
      if (!Number.isFinite(games) || games <= 0) continue;

      const gf = Number(row.goals_for ?? 0) / games;
      const ga = Number(row.goals_against ?? 0) / games;
      const gd = Number(row.goal_difference ?? 0) / games;
      const ppg = Number(row.points ?? 0) / games;

      // Składowe pomocnicze do debugowania / późniejszego modelu
      const attackRating = gf * 10;
      const defenseRating = -ga * 10;
      const formRating = ppg * 10;

      // Surowy rating przed normalizacją
      const rawRating =
        attackRating * 0.45 +
        defenseRating * 0.20 +
        formRating * 0.35 +
        gd * 5;

      rawRatings.push({
        team_id: row.team_id,
        competition_id: row.competition_id,
        season: row.season,
        rating_date: row.snapshot_date,
        attack_rating: round6(attackRating),
        defense_rating: round6(defenseRating),
        form_rating: round6(formRating),
        raw_rating: round6(rawRating),
        matches_count: games,
      });
    }

    if (!rawRatings.length) {
      return NextResponse.json({
        ok: true,
        teamsRated: 0,
        reason: "no_valid_rows_after_processing",
      });
    }

    // Normalizacja do skali 0-100 zamiast twardego clampowania
    const maxRating = Math.max(...rawRatings.map((r) => r.raw_rating));
    const minRating = Math.min(...rawRatings.map((r) => r.raw_rating));

    const span = maxRating - minRating;

    const rows = rawRatings.map((r) => {
      let overallRating: number;

      if (!Number.isFinite(span) || span <= 0) {
        overallRating = 50;
      } else {
        overallRating = ((r.raw_rating - minRating) / span) * 100;
      }

      return {
        team_id: r.team_id,
        competition_id: r.competition_id,
        season: r.season,
        rating_date: r.rating_date,
        attack_rating: r.attack_rating,
        defense_rating: r.defense_rating,
        form_rating: r.form_rating,
        overall_rating: round6(overallRating),
        matches_count: r.matches_count,
        source: "standings_model_v2",
      };
    });

    const { error: upsertError } = await sb.from("team_ratings").upsert(rows, {
      onConflict: "team_id,competition_id,season,rating_date",
    });

    if (upsertError) {
      return NextResponse.json(
        { error: `team_ratings upsert failed: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      teamsRated: rows.length,
      normalization: {
        minRawRating: round6(minRating),
        maxRawRating: round6(maxRating),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "ratings update failed" },
      { status: 500 }
    );
  }
}