import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const competitionCode = (searchParams.get("competitionCode") || "").trim();

  if (!competitionCode) {
    return jsonError("Brak parametru competitionCode.");
  }

  const token =
    process.env.FOOTBALL_DATA_TOKEN ||
    process.env.FOOTBALL_DATA_API_KEY ||
    process.env.FOOTBALL_DATA_KEY;

  if (!token) {
    return jsonError(
      "Brak tokena do football-data.org. Ustaw FOOTBALL_DATA_TOKEN w .env",
      500
    );
  }

  try {
    const url = `https://api.football-data.org/v4/competitions/${encodeURIComponent(
      competitionCode
    )}/standings`;

    const r = await fetch(url, {
      headers: { "X-Auth-Token": token },
      cache: "no-store",
    });

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text?.slice(0, 500) || "Non-JSON response" };
    }

    if (!r.ok) {
      const msg =
        data?.message ||
        data?.error ||
        `football-data error (HTTP ${r.status})`;
      return jsonError(msg, r.status);
    }

    const standingsArr = Array.isArray(data?.standings) ? data.standings : [];
    const total =
      standingsArr.find((s: any) => s?.type === "TOTAL") || standingsArr[0];

    const table = Array.isArray(total?.table) ? total.table : [];

    const rows = table
      .map((row: any) => {
        const teamId = row?.team?.id;
        const teamName = row?.team?.name;
        const position = row?.position;

        if (typeof teamId !== "number" || typeof position !== "number") return null;

        const goalsFor = Number(row?.goalsFor ?? 0);
        const goalsAgainst = Number(row?.goalsAgainst ?? 0);

        // football-data zazwyczaj ma row.goalDifference, ale na wszelki wypadek liczymy też sami
        const goalDifference =
          typeof row?.goalDifference === "number"
            ? Number(row.goalDifference)
            : goalsFor - goalsAgainst;

        return {
          position,
          teamId,
          teamName: typeof teamName === "string" ? teamName : `Team ${teamId}`,

          playedGames: Number(row?.playedGames ?? 0),
          won: Number(row?.won ?? 0),
          draw: Number(row?.draw ?? 0),
          lost: Number(row?.lost ?? 0),

          points: Number(row?.points ?? 0),
          goalsFor,
          goalsAgainst,
          goalDifference,

          form: typeof row?.form === "string" ? row.form : null,
        };
      })
      .filter(Boolean);

    const competitionName =
      data?.competition?.name || data?.competition?.code || competitionCode;

    const season =
      data?.season?.startDate && data?.season?.endDate
        ? `${String(data.season.startDate).slice(0, 4)}/${String(
            data.season.endDate
          ).slice(0, 4)}`
        : null;

    return NextResponse.json({
      competitionCode,
      competitionName,
      season,
      rows,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Nie udało się pobrać standings.", 500);
  }
}