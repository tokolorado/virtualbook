import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInternalFallbackOdds,
  buildInternalFallbackOddsFromFeatures,
  INTERNAL_FALLBACK_PRICING_METHOD,
} from "../lib/odds/internalFallback";

function assertAuditableFallbackRows(
  rows: Array<{
    marketId: string;
    selection: string;
    fairProbability: number;
    bookOdds: number;
  }>
) {
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every(
      (row) =>
        Number.isFinite(row.fairProbability) &&
        row.fairProbability > 0 &&
        row.fairProbability < 1 &&
        Number.isFinite(row.bookOdds) &&
        row.bookOdds >= 1.01 &&
        row.bookOdds <= 100
    )
  );

  for (const marketId of ["1x2", "ou_1_5", "ou_2_5", "ou_3_5", "btts"]) {
    const marketRows = rows.filter((row) => row.marketId === marketId);
    assert.ok(marketRows.length > 0, `missing ${marketId}`);
    const probabilitySum = marketRows.reduce(
      (sum, row) => sum + row.fairProbability,
      0
    );
    assert.ok(
      Math.abs(probabilitySum - 1) <= 0.015,
      `${marketId} probability sum ${probabilitySum}`
    );
  }
}

test("internal fallback odds require meaningful team history", () => {
  const result = buildInternalFallbackOdds({
    home: {
      teamId: 1,
      teamName: "Home",
      matchesCount: 2,
      goalsForPerGame: 1.4,
      goalsAgainstPerGame: 1.1,
    },
    away: {
      teamId: 2,
      teamName: "Away",
      matchesCount: 8,
      goalsForPerGame: 1.2,
      goalsAgainstPerGame: 1.3,
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "insufficient_team_stats");
  }
});

test("internal fallback odds produce core markets with explicit fallback method", () => {
  const result = buildInternalFallbackOdds({
    home: {
      teamId: 1,
      teamName: "Home",
      matchesCount: 12,
      goalsForPerGame: 1.8,
      goalsAgainstPerGame: 0.9,
      xgForPerGame: 1.7,
      xgAgainstPerGame: 1.0,
    },
    away: {
      teamId: 2,
      teamName: "Away",
      matchesCount: 12,
      goalsForPerGame: 1.1,
      goalsAgainstPerGame: 1.5,
      xgForPerGame: 1.2,
      xgAgainstPerGame: 1.4,
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.rows.some((row) => row.marketId === "1x2"));
    assert.ok(result.rows.some((row) => row.marketId === "ou_2_5"));
    assert.ok(result.rows.some((row) => row.marketId === "btts"));
    assertAuditableFallbackRows(result.rows);
    assert.equal(INTERNAL_FALLBACK_PRICING_METHOD, "internal_model_fallback");
  }
});

test("internal fallback odds can price from BSD event features", () => {
  const result = buildInternalFallbackOddsFromFeatures({
    homeTeamName: "Bayern",
    awayTeamName: "PSG",
    homeXg: 2.49,
    awayXg: 0.79,
    homeWinProb: 0.578,
    drawProb: 0.1905,
    awayWinProb: 0.2315,
    over25Prob: 0.793,
    bttsProb: 0.749,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.modelVersion, "internal-fallback-features-v1");
    assert.ok(result.confidence >= 0.9);
    assert.ok(result.rows.some((row) => row.marketId === "1x2"));
    assert.ok(result.rows.some((row) => row.marketId === "ou_2_5"));
    assert.ok(result.rows.some((row) => row.marketId === "btts"));
    assertAuditableFallbackRows(result.rows);
  }
});

test("internal fallback odds blends team snapshot market trends", () => {
  const lowTrend = buildInternalFallbackOdds({
    home: {
      teamId: 1,
      teamName: "Home",
      matchesCount: 12,
      homeMatchesCount: 6,
      awayMatchesCount: 6,
      goalsForPerGame: null,
      goalsAgainstPerGame: null,
      xgForPerGame: 1.4,
      xgAgainstPerGame: 1.2,
      attackStrength: 1,
      defenseStrength: 1,
      bttsRate: 0.22,
      over25Rate: 0.24,
      cleanSheetRate: 0.45,
      failedToScoreRate: 0.34,
    },
    away: {
      teamId: 2,
      teamName: "Away",
      matchesCount: 12,
      homeMatchesCount: 6,
      awayMatchesCount: 6,
      goalsForPerGame: null,
      goalsAgainstPerGame: null,
      xgForPerGame: 1.4,
      xgAgainstPerGame: 1.2,
      attackStrength: 1,
      defenseStrength: 1,
      bttsRate: 0.24,
      over25Rate: 0.26,
      cleanSheetRate: 0.42,
      failedToScoreRate: 0.32,
    },
  });

  const highTrend = buildInternalFallbackOdds({
    home: {
      teamId: 1,
      teamName: "Home",
      matchesCount: 12,
      homeMatchesCount: 6,
      awayMatchesCount: 6,
      goalsForPerGame: null,
      goalsAgainstPerGame: null,
      xgForPerGame: 1.4,
      xgAgainstPerGame: 1.2,
      attackStrength: 1,
      defenseStrength: 1,
      bttsRate: 0.74,
      over25Rate: 0.76,
      cleanSheetRate: 0.12,
      failedToScoreRate: 0.14,
    },
    away: {
      teamId: 2,
      teamName: "Away",
      matchesCount: 12,
      homeMatchesCount: 6,
      awayMatchesCount: 6,
      goalsForPerGame: null,
      goalsAgainstPerGame: null,
      xgForPerGame: 1.4,
      xgAgainstPerGame: 1.2,
      attackStrength: 1,
      defenseStrength: 1,
      bttsRate: 0.72,
      over25Rate: 0.78,
      cleanSheetRate: 0.1,
      failedToScoreRate: 0.12,
    },
  });

  assert.equal(lowTrend.ok, true);
  assert.equal(highTrend.ok, true);

  if (lowTrend.ok && highTrend.ok) {
    const lowOver25 = lowTrend.rows.find(
      (row) => row.marketId === "ou_2_5" && row.selection === "over"
    );
    const highOver25 = highTrend.rows.find(
      (row) => row.marketId === "ou_2_5" && row.selection === "over"
    );
    const lowBtts = lowTrend.rows.find(
      (row) => row.marketId === "btts" && row.selection === "over"
    );
    const highBtts = highTrend.rows.find(
      (row) => row.marketId === "btts" && row.selection === "over"
    );

    assert.ok(lowOver25);
    assert.ok(highOver25);
    assert.ok(lowBtts);
    assert.ok(highBtts);
    assert.ok(highOver25.fairProbability > lowOver25.fairProbability);
    assert.ok(highBtts.fairProbability > lowBtts.fairProbability);
  }
});
