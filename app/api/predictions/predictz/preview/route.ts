import { NextResponse } from "next/server";
import { addDaysLocal, todayLocalYYYYMMDD } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREDICTZ_BASE = "https://www.predictz.com";
const HORIZON_DAYS = 14;

type PredictzPick = "Home" | "Draw" | "Away";

type PredictzPrediction = {
  source: "predictz";
  sourceUrl: string;
  sourceDate: string;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  pick: PredictzPick;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedScore: string;
  correctScoreOdds: number | null;
  rawPrediction: string;
  matchTitle: string | null;
  stableKey: string;
};

function jsonError(message: string, status = 500, extra?: Record<string, any>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

function isValidDateYmd(value: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function compactDate(dateYmd: string) {
  return dateYmd.replaceAll("-", "");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPredictzCorrectScoreUrl(dateYmd: string) {
  const today = todayLocalYYYYMMDD();
  const tomorrow = addDaysLocal(today, 1);

  if (dateYmd === today) {
    return `${PREDICTZ_BASE}/predictions/today/correct-score/`;
  }

  if (dateYmd === tomorrow) {
    return `${PREDICTZ_BASE}/predictions/tomorrow/correct-score/`;
  }

  return `${PREDICTZ_BASE}/predictions/${compactDate(dateYmd)}/correct-score/`;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : _;
    });
}

function htmlToLines(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li|ul|ol|h[1-6]|section|article|table|thead|tbody|a)>/gi, "\n")
    .replace(/<(p|div|tr|td|th|li|ul|ol|h[1-6]|section|article|table|thead|tbody|a)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(text)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isPredictionLine(line: string) {
  return /^(Home|Draw|Away)\s+\d+\s*-\s*\d+$/i.test(line);
}

function parsePredictionLine(line: string) {
  const m = line.match(/^(Home|Draw|Away)\s+(\d+)\s*-\s*(\d+)$/i);
  if (!m) return null;

  return {
    pick: normalizePick(m[1]),
    homeScore: Number(m[2]),
    awayScore: Number(m[3]),
  };
}

function normalizePick(value: string): PredictzPick {
  const v = value.toLowerCase();

  if (v === "home") return "Home";
  if (v === "away") return "Away";

  return "Draw";
}

function isNumericLine(line: string) {
  return /^\d+(\.\d+)?$/.test(line);
}

function isNoiseLine(line: string) {
  const s = line.trim();

  if (!s) return true;
  if (/^\d+$/.test(s)) return true;
  if (/^[WDL]$/i.test(s)) return true;
  if (/^[12X]$/i.test(s)) return true;
  if (/^\d+(\.\d+)?$/.test(s)) return true;

  if (/^MATCH PREVIEW$/i.test(s)) return true;
  if (/^Correct Score Odds$/i.test(s)) return true;
  if (/Correct Score Odds$/i.test(s)) return true;
  if (/^Image:/i.test(s)) return true;
  if (/^Home$/i.test(s)) return true;
  if (/^Away$/i.test(s)) return true;
  if (/^Draw$/i.test(s)) return true;
  if (/^Predictions$/i.test(s)) return true;
  if (/^Home\s+\d+\s*-\s*\d+$/i.test(s)) return true;
  if (/^Draw\s+\d+\s*-\s*\d+$/i.test(s)) return true;
  if (/^Away\s+\d+\s*-\s*\d+$/i.test(s)) return true;

  if (/Analysis$/i.test(s)) return true;
  if (/Tips$/i.test(s)) return true;
  if (/Tips & Odds$/i.test(s)) return true;
  if (/^Football Correct Score Tips/i.test(s)) return true;
  if (/^Here are all of our/i.test(s)) return true;
  if (/^View our football/i.test(s)) return true;
  if (/^Key to last/i.test(s)) return true;
  if (/^Goals Scored/i.test(s)) return true;
  if (/^Select A League/i.test(s)) return true;
  if (/^Odds are correct/i.test(s)) return true;
  if (/^Do You Have/i.test(s)) return true;

  if (s.length > 80) return true;

  return false;
}

function findPreviousTeam(lines: string[], predictionIndex: number) {
  for (let i = predictionIndex - 1; i >= Math.max(0, predictionIndex - 20); i -= 1) {
    const line = lines[i];

    if (!line) continue;
    if (isNoiseLine(line)) continue;

    return line;
  }

  return null;
}

function findNextTeam(lines: string[], predictionIndex: number) {
  for (let i = predictionIndex + 1; i < Math.min(lines.length, predictionIndex + 20); i += 1) {
    const line = lines[i];

    if (!line) continue;
    if (isNoiseLine(line)) continue;

    return line;
  }

  return null;
}

function findMatchTitle(lines: string[], startIndex: number, homeTeam: string, awayTeam: string) {
  const expected = `${homeTeam} v ${awayTeam}`.toLowerCase();

  for (let i = startIndex; i < Math.min(lines.length, startIndex + 80); i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (line.toLowerCase() === expected) {
      return line;
    }
  }

  for (let i = startIndex; i < Math.min(lines.length, startIndex + 80); i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (/\s+v\s+/i.test(line) && line.length <= 100) {
      return line;
    }
  }

  return null;
}

function findCorrectScoreOdds(
  lines: string[],
  startIndex: number,
  predictedHomeScore: number,
  predictedAwayScore: number
) {
  const marker = `${predictedHomeScore}-${predictedAwayScore} Correct Score Odds`.toLowerCase();

  for (let i = startIndex; i < Math.min(lines.length, startIndex + 100); i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (line.toLowerCase() !== marker) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
      const maybeOdds = lines[j];

      if (isNumericLine(maybeOdds)) {
        const n = Number(maybeOdds);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
    }
  }

  return null;
}

function isLeagueHeader(line: string) {
  if (line.length > 100) return false;
  if (!/Correct Score Tips$/i.test(line)) return false;
  if (/^Football Correct Score Tips/i.test(line)) return false;
  if (/^View our/i.test(line)) return false;
  if (/Tips & Odds$/i.test(line)) return false;

  return true;
}

function normalizeLeagueHeader(line: string) {
  return line.replace(/\s+Correct Score Tips$/i, "").trim();
}

function extractPredictzPredictions(args: {
  html: string;
  sourceUrl: string;
  sourceDate: string;
}) {
  const lines = htmlToLines(args.html);
  const predictions: PredictzPrediction[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];

  let currentLeague: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isLeagueHeader(line)) {
      currentLeague = normalizeLeagueHeader(line);
      continue;
    }

    if (!isPredictionLine(line)) continue;

    const parsed = parsePredictionLine(line);
    if (!parsed) continue;

    const homeTeam = findPreviousTeam(lines, i);
    const awayTeam = findNextTeam(lines, i);

    if (!homeTeam || !awayTeam) {
      warnings.push(`Skipped prediction at line ${i}: missing team names`);
      continue;
    }

    const matchTitle = findMatchTitle(lines, i + 1, homeTeam, awayTeam);
    const correctScoreOdds = findCorrectScoreOdds(
      lines,
      i + 1,
      parsed.homeScore,
      parsed.awayScore
    );

    const predictedScore = `${parsed.homeScore}-${parsed.awayScore}`;
    const stableKey = [
      "predictz",
      args.sourceDate,
      slugify(currentLeague ?? "unknown-league"),
      slugify(homeTeam),
      slugify(awayTeam),
      predictedScore,
    ].join(":");

    if (seen.has(stableKey)) continue;
    seen.add(stableKey);

    predictions.push({
      source: "predictz",
      sourceUrl: args.sourceUrl,
      sourceDate: args.sourceDate,
      league: currentLeague,
      homeTeam,
      awayTeam,
      pick: parsed.pick,
      predictedHomeScore: parsed.homeScore,
      predictedAwayScore: parsed.awayScore,
      predictedScore,
      correctScoreOdds,
      rawPrediction: line,
      matchTitle,
      stableKey,
    });
  }

  return {
    predictions,
    meta: {
      linesCount: lines.length,
      warnings,
    },
  };
}

async function fetchPredictzHtml(url: string) {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; VirtualBook/1.0; +https://virtualbook-sable.vercel.app)",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
    },
  });

  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    text,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const debug = searchParams.get("debug") === "1";

  if (!isValidDateYmd(date)) {
    return jsonError("Invalid date. Use YYYY-MM-DD", 400);
  }

  const safeDate = date as string;
  const today = todayLocalYYYYMMDD();
  const horizonTo = addDaysLocal(today, HORIZON_DAYS);

  if (safeDate < today) {
    return NextResponse.json({
      date: safeDate,
      source: "predictz",
      supported: false,
      reason: "PredictZ preview supports today and future dates only.",
      results: [],
    });
  }

  if (safeDate > horizonTo) {
    return NextResponse.json({
      date: safeDate,
      source: "predictz",
      supported: false,
      horizonDays: HORIZON_DAYS,
      horizonTo,
      reason: "Date is beyond prediction preview horizon.",
      results: [],
    });
  }

  const sourceUrl = buildPredictzCorrectScoreUrl(safeDate);
  const fetchedAt = new Date().toISOString();

  const upstream = await fetchPredictzHtml(sourceUrl);

  if (!upstream.ok) {
    return jsonError("PredictZ fetch failed", 502, {
      date: safeDate,
      sourceUrl,
      upstreamStatus: upstream.status,
      bodyPreview: debug ? upstream.text.slice(0, 1000) : undefined,
    });
  }

  const parsed = extractPredictzPredictions({
    html: upstream.text,
    sourceUrl,
    sourceDate: safeDate,
  });

  return NextResponse.json({
    date: safeDate,
    source: "predictz",
    sourceUrl,
    fetchedAt,
    count: parsed.predictions.length,
    results: parsed.predictions,
    meta: {
      ...parsed.meta,
      htmlLength: upstream.text.length,
    },
    debug: debug
      ? {
          bodyPreview: upstream.text.slice(0, 1000),
        }
      : undefined,
  });
}