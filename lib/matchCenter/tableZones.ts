// lib/matchCenter/tableZones.ts

export type TableZone =
  | "champions"
  | "champions_qual"
  | "europa"
  | "conference"
  | "relegation"
  | null;

type ZoneResolver = (position: number, totalRows: number) => TableZone;

type LeagueZoneConfig = {
  legend: Exclude<TableZone, null>[];
  resolve: ZoneResolver;
};

function lastThree(position: number, totalRows: number): boolean {
  return position >= Math.max(1, totalRows - 2);
}

function normalizeCompetitionId(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeSeason(value: string | null | undefined): string {
  return (value ?? "").trim();
}

const DEFAULT_CONFIG: LeagueZoneConfig = {
  legend: ["champions", "champions_qual", "europa", "conference", "relegation"],
  resolve(position, totalRows) {
    if (position >= 1 && position <= 2) return "champions";
    if (position === 3) return "champions_qual";
    if (position === 4) return "europa";
    if (position === 5) return "conference";
    if (lastThree(position, totalRows)) return "relegation";
    return null;
  },
};

const ZONE_CONFIGS: Record<string, Record<string, LeagueZoneConfig>> = {
  // LaLiga 2025/26: 5 miejsc do LM (EPS), potem LE i LK
  PD: {
    "2025": {
      legend: ["champions", "europa", "conference", "relegation"],
      resolve(position, totalRows) {
        if (position >= 1 && position <= 5) return "champions";
        if (position === 6) return "europa";
        if (position === 7) return "conference";
        if (lastThree(position, totalRows)) return "relegation";
        return null;
      },
    },
  },

  // Premier League 2025/26: 5 miejsc do LM (EPS), potem LE i LK
  PL: {
    "2025": {
      legend: ["champions", "europa", "conference", "relegation"],
      resolve(position, totalRows) {
        if (position >= 1 && position <= 5) return "champions";
        if (position === 6) return "europa";
        if (position === 7) return "conference";
        if (lastThree(position, totalRows)) return "relegation";
        return null;
      },
    },
  },

  // Serie A 2025/26: 4 LM, 1 LE, 1 LK
  SA: {
    "2025": {
      legend: ["champions", "europa", "conference", "relegation"],
      resolve(position, totalRows) {
        if (position >= 1 && position <= 4) return "champions";
        if (position === 5) return "europa";
        if (position === 6) return "conference";
        if (lastThree(position, totalRows)) return "relegation";
        return null;
      },
    },
  },

  // Bundesliga 2025/26: 4 LM, 1 LE, 1 LK
  BL1: {
    "2025": {
      legend: ["champions", "europa", "conference", "relegation"],
      resolve(position, totalRows) {
        if (position >= 1 && position <= 4) return "champions";
        if (position === 5) return "europa";
        if (position === 6) return "conference";
        if (position >= Math.max(1, totalRows - 1)) return "relegation";
        return null;
      },
    },
  },

  // Ligue 1 2025/26: 3 LM, 1 el. LM, 1 LE, 1 LK
  FL1: {
    "2025": {
      legend: ["champions", "champions_qual", "europa", "conference", "relegation"],
      resolve(position, totalRows) {
        if (position >= 1 && position <= 3) return "champions";
        if (position === 4) return "champions_qual";
        if (position === 5) return "europa";
        if (position === 6) return "conference";
        if (position >= Math.max(1, totalRows - 1)) return "relegation";
        return null;
      },
    },
  },
};

function getLeagueConfig(
  competitionId: string | null | undefined,
  season: string | null | undefined
): LeagueZoneConfig {
  const code = normalizeCompetitionId(competitionId);
  const seasonKey = normalizeSeason(season);

  return ZONE_CONFIGS[code]?.[seasonKey] ?? DEFAULT_CONFIG;
}

export function getTableZone(
  competitionId: string | null | undefined,
  season: string | null | undefined,
  position: number,
  totalRows: number
): TableZone {
  return getLeagueConfig(competitionId, season).resolve(position, totalRows);
}

export function getTableLegendZones(
  competitionId: string | null | undefined,
  season: string | null | undefined
): Exclude<TableZone, null>[] {
  return getLeagueConfig(competitionId, season).legend;
}

export function zoneLegendLabel(zone: TableZone): string {
  if (zone === "champions") return "Liga Mistrzów";
  if (zone === "champions_qual") return "El. Ligi Mistrzów";
  if (zone === "europa") return "Liga Europy";
  if (zone === "conference") return "Liga Konferencji";
  if (zone === "relegation") return "Strefa spadkowa";
  return "";
}

export function zoneBadgeClass(zone: TableZone): string {
  if (zone === "champions") {
    return "border-emerald-400/70 bg-emerald-500/12 text-emerald-200";
  }
  if (zone === "champions_qual") {
    return "border-green-300/70 bg-green-500/12 text-green-200";
  }
  if (zone === "europa") {
    return "border-sky-400/70 bg-sky-500/12 text-sky-200";
  }
  if (zone === "conference") {
    return "border-cyan-300/70 bg-cyan-500/12 text-cyan-200";
  }
  if (zone === "relegation") {
    return "border-red-400/70 bg-red-500/12 text-red-200";
  }

  return "border-neutral-700 bg-neutral-800/40 text-neutral-300";
}

export function zonePositionBubbleClass(zone: TableZone): string {
  if (zone === "champions") {
    return "border-emerald-300/70 bg-emerald-400 text-black";
  }
  if (zone === "champions_qual") {
    return "border-green-200/70 bg-green-300 text-black";
  }
  if (zone === "europa") {
    return "border-sky-300/70 bg-sky-400 text-black";
  }
  if (zone === "conference") {
    return "border-cyan-200/70 bg-cyan-300 text-black";
  }
  if (zone === "relegation") {
    return "border-red-300/70 bg-red-400 text-black";
  }

  return "border-neutral-700 bg-neutral-950 text-white";
}

export function zoneRowClass(zone: TableZone): string {
  if (zone === "champions") {
    return "bg-emerald-500/14 hover:bg-emerald-500/18 shadow-[inset_4px_0_0_0_rgba(74,222,128,1)]";
  }
  if (zone === "champions_qual") {
    return "bg-green-500/14 hover:bg-green-500/18 shadow-[inset_4px_0_0_0_rgba(134,239,172,1)]";
  }
  if (zone === "europa") {
    return "bg-sky-500/14 hover:bg-sky-500/18 shadow-[inset_4px_0_0_0_rgba(56,189,248,1)]";
  }
  if (zone === "conference") {
    return "bg-cyan-500/14 hover:bg-cyan-500/18 shadow-[inset_4px_0_0_0_rgba(103,232,249,1)]";
  }
  if (zone === "relegation") {
    return "bg-red-500/14 hover:bg-red-500/18 shadow-[inset_4px_0_0_0_rgba(248,113,113,1)]";
  }

  return "hover:bg-neutral-800/40";
}
