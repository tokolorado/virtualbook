// app/api/admin/bsd/leagues/sync/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  bsdFetchPaginated,
  bsdImageUrl,
  normalizeBsdText,
} from "@/lib/bsd/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BsdLeague = {
  id: number;
  name: string;
  country: string | null;
  is_women?: boolean;
  current_season?: {
    id?: number;
    name?: string;
    year?: number;
    start_date?: string;
    end_date?: string;
  } | null;
};

type TargetLeague = {
  appCode: string;
  aliases: string[];
  countries?: string[];
  sortOrder: number;
};

type ProviderLeagueUpsertRow = {
  provider: "bsd";
  app_code: string;

  provider_league_id: number;
  provider_season_id: number | null;

  name: string;
  normalized_name: string;
  country: string | null;
  is_women: boolean;

  current_season_name: string | null;
  current_season_year: number | null;
  current_season_start_date: string | null;
  current_season_end_date: string | null;

  enabled: boolean;
  sort_order: number;

  fallback_provider: string | null;
  fallback_code: null;

  logo_url: string | null;
  raw: BsdLeague;

  updated_at: string;
};

type IconLeagueUpsertRow = {
  provider: "bsd";
  provider_league_id: string;
  app_code: string;
  league_name: string;
  country: string | null;
  icon_url: string;
  source: "bsd";
  raw: BsdLeague;
  last_sync_at: string;
  updated_at: string;
};

type CronSecretResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      response: NextResponse;
    };

type UnknownErrorWithDetails = {
  message?: unknown;
  payload?: unknown;
  status?: unknown;
};

const TARGET_LEAGUES: TargetLeague[] = [
  {
    appCode: "CL",
    aliases: ["Champions League", "UEFA Champions League"],
    countries: ["Europe"],
    sortOrder: 10,
  },
  {
    appCode: "UEL",
    aliases: ["Europa League", "UEFA Europa League"],
    countries: ["Europe"],
    sortOrder: 20,
  },
  {
    appCode: "WC",
    aliases: ["World Cup", "World Cup 2026", "FIFA World Cup"],
    sortOrder: 30,
  },
  {
    appCode: "PL",
    aliases: ["Premier League"],
    countries: ["England"],
    sortOrder: 100,
  },
  {
    appCode: "CH",
    aliases: ["Championship", "EFL Championship"],
    countries: ["England"],
    sortOrder: 110,
  },
  {
    appCode: "BL1",
    aliases: ["Bundesliga"],
    countries: ["Germany"],
    sortOrder: 120,
  },
  {
    appCode: "DFB",
    aliases: ["DFB Pokal", "DFB-Pokal"],
    countries: ["Germany"],
    sortOrder: 125,
  },
  {
    appCode: "FL1",
    aliases: ["Ligue 1"],
    countries: ["France"],
    sortOrder: 130,
  },
  {
    appCode: "SA",
    aliases: ["Serie A"],
    countries: ["Italy"],
    sortOrder: 140,
  },
  {
    appCode: "CI",
    aliases: ["Coppa Italia"],
    countries: ["Italy"],
    sortOrder: 145,
  },
  {
    appCode: "PD",
    aliases: ["La Liga", "LaLiga"],
    countries: ["Spain"],
    sortOrder: 150,
  },
  {
    appCode: "CDR",
    aliases: ["Copa del Rey"],
    countries: ["Spain"],
    sortOrder: 155,
  },
  {
    appCode: "EK",
    aliases: ["Ekstraklasa"],
    countries: ["Poland"],
    sortOrder: 160,
  },
  {
    appCode: "PPL",
    aliases: ["Puchar Polski", "Polish Cup"],
    countries: ["Poland"],
    sortOrder: 165,
  },
  {
    appCode: "POR1",
    aliases: ["Liga Portugal", "Liga Portugal Betclic", "Primeira Liga"],
    countries: ["Portugal"],
    sortOrder: 170,
  },
  {
    appCode: "NED1",
    aliases: ["Eredivisie"],
    countries: ["Netherlands"],
    sortOrder: 180,
  },
  {
    appCode: "MLS",
    aliases: ["MLS", "Major League Soccer"],
    countries: ["United States", "USA"],
    sortOrder: 190,
  },
  {
    appCode: "TUR1",
    aliases: [
      "Trendyol Super Lig",
      "Trendyol Süper Lig",
      "Super Lig",
      "Süper Lig",
    ],
    countries: ["Turkey"],
    sortOrder: 200,
  },
  {
    appCode: "SPL",
    aliases: ["Saudi Pro League"],
    countries: ["Saudi Arabia"],
    sortOrder: 210,
  },
  {
    appCode: "FAC",
    aliases: ["FA Cup"],
    countries: ["England"],
    sortOrder: 220,
  },
];

function jsonError(
  message: string,
  status = 500,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function getErrorDetails(error: unknown): UnknownErrorWithDetails {
  if (error && typeof error === "object") {
    return error as UnknownErrorWithDetails;
  }

  return {};
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;

  const details = getErrorDetails(error);
  if (typeof details.message === "string" && details.message.trim()) {
    return details.message;
  }

  if (typeof error === "string" && error.trim()) return error;

  return fallback;
}

function requireCronSecret(req: Request): CronSecretResult {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return {
      ok: false,
      response: jsonError("Missing CRON_SECRET in env", 500),
    };
  }

  const provided = req.headers.get("x-cron-secret");

  if (provided !== expected) {
    return {
      ok: false,
      response: jsonError("Unauthorized", 401),
    };
  }

  return { ok: true };
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL in env");
  }

  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env");
  }

  return createClient(supabaseUrl, serviceKey);
}

function countryMatches(league: BsdLeague, target: TargetLeague) {
  if (!target.countries?.length) return true;

  const leagueCountry = normalizeBsdText(league.country);
  const countries = target.countries.map(normalizeBsdText);

  return countries.includes(leagueCountry);
}

function leagueNameMatches(league: BsdLeague, target: TargetLeague) {
  const leagueName = normalizeBsdText(league.name);
  const aliases = target.aliases.map(normalizeBsdText);

  return aliases.includes(leagueName);
}

function findTargetLeague(league: BsdLeague) {
  return TARGET_LEAGUES.find((target) => {
    if (!leagueNameMatches(league, target)) return false;
    if (!countryMatches(league, target)) return false;

    return true;
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = requireCronSecret(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  try {
    const supabase = getSupabaseAdmin();
    const fetchedAt = new Date().toISOString();

    const { results: leagues, pages } = await bsdFetchPaginated<BsdLeague>(
      "/leagues/",
      { page_size: 500 },
      { maxPages: 10 }
    );

    const matchedRows: ProviderLeagueUpsertRow[] = [];
    const matchedAppCodes = new Set<string>();

    const duplicateMatches: Array<{
      appCode: string;
      leagueId: number;
      name: string;
      country: string | null;
    }> = [];

    for (const league of leagues) {
      const id = Number(league.id);
      const name = String(league.name ?? "").trim();

      if (!Number.isFinite(id) || !name) continue;

      const target = findTargetLeague(league);
      if (!target) continue;

      if (matchedAppCodes.has(target.appCode)) {
        duplicateMatches.push({
          appCode: target.appCode,
          leagueId: id,
          name,
          country: league.country ?? null,
        });
        continue;
      }

      matchedAppCodes.add(target.appCode);

      const currentSeason = league.current_season ?? null;

      matchedRows.push({
        provider: "bsd",
        app_code: target.appCode,

        provider_league_id: id,
        provider_season_id:
          typeof currentSeason?.id === "number" ? currentSeason.id : null,

        name,
        normalized_name: normalizeBsdText(name),
        country: league.country ?? null,
        is_women: Boolean(league.is_women),

        current_season_name: currentSeason?.name
          ? String(currentSeason.name)
          : null,
        current_season_year:
          typeof currentSeason?.year === "number" ? currentSeason.year : null,
        current_season_start_date: currentSeason?.start_date ?? null,
        current_season_end_date: currentSeason?.end_date ?? null,

        enabled: true,
        sort_order: target.sortOrder,

        fallback_provider: null,
        fallback_code: null,

        logo_url: bsdImageUrl("league", id),
        raw: league,

        updated_at: fetchedAt,
      });
    }

    const unmatchedTargets = TARGET_LEAGUES.filter(
      (target) => !matchedAppCodes.has(target.appCode)
    ).map((target) => ({
      appCode: target.appCode,
      aliases: target.aliases,
      countries: target.countries ?? null,
    }));

    let upsertedIconLeaguesCount = 0;
    let iconLeaguesWarning: string | null = null;

    if (!dryRun && matchedRows.length > 0) {
      const { error } = await supabase.from("provider_leagues").upsert(
        matchedRows,
        {
          onConflict: "provider,app_code",
        }
      );

      if (error) {
        return jsonError("provider_leagues upsert failed", 500, {
          details: error.message,
        });
      }

      const iconLeagueRows: IconLeagueUpsertRow[] = matchedRows
        .filter((row) => row.logo_url && row.logo_url.trim().length > 0)
        .map((row) => ({
          provider: "bsd",
          provider_league_id: String(row.provider_league_id),
          app_code: row.app_code,
          league_name: row.name,
          country: row.country,
          icon_url: row.logo_url ?? "",
          source: "bsd",
          raw: row.raw,
          last_sync_at: fetchedAt,
          updated_at: fetchedAt,
        }));

      if (iconLeagueRows.length > 0) {
        const { error: iconLeaguesError } = await supabase
          .from("icons_leagues")
          .upsert(iconLeagueRows, {
            onConflict: "provider,provider_league_id",
          });

        if (iconLeaguesError) {
          iconLeaguesWarning = iconLeaguesError.message;
          console.warn("icons_leagues upsert failed", iconLeaguesError.message);
        } else {
          upsertedIconLeaguesCount = iconLeagueRows.length;
        }
      }

      const competitionRows = matchedRows.map((row) => ({
        id: row.app_code,
        name: row.name,
        type: "LEAGUE",
        area_name: row.country,
        emblem: row.logo_url,
        last_sync_at: fetchedAt,
      }));

      const { error: competitionsError } = await supabase
        .from("competitions")
        .upsert(competitionRows, {
          onConflict: "id",
        });

      if (competitionsError) {
        return jsonError("competitions upsert failed", 500, {
          details: competitionsError.message,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      provider: "bsd",
      dryRun,
      fetchedAt,
      fetchedLeaguesCount: leagues.length,
      matchedCount: matchedRows.length,
      upsertedCount: dryRun ? 0 : matchedRows.length,
      builtIconLeagueRowsCount: matchedRows.filter(
        (row) => row.logo_url && row.logo_url.trim().length > 0
      ).length,
      upsertedIconLeaguesCount: dryRun ? 0 : upsertedIconLeaguesCount,
      iconLeaguesWarning,
      matched: matchedRows.map((row) => ({
        appCode: row.app_code,
        bsdLeagueId: row.provider_league_id,
        bsdSeasonId: row.provider_season_id,
        name: row.name,
        country: row.country,
        sortOrder: row.sort_order,
      })),
      unmatchedTargets,
      duplicateMatches,
      pages,
    });
  } catch (error: unknown) {
    const details = getErrorDetails(error);

    return jsonError(getErrorMessage(error, "BSD leagues sync failed"), 500, {
      details: details.payload ?? null,
      status: details.status ?? null,
    });
  }
}
