import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInternalFallbackOdds,
  buildInternalFallbackOddsFromFeatures,
  INTERNAL_FALLBACK_PRICING_METHOD,
} from "../lib/odds/internalFallback";

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
    assert.ok(result.rows.every((row) => row.bookOdds > 1));
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
    assert.ok(result.rows.every((row) => row.bookOdds > 1));
  }
});
