import test from "node:test";
import assert from "node:assert/strict";
import { priceAccumulatorSlip } from "../lib/bets/slipPricing";

test("standard accumulator multiplies odds from different matches", () => {
  const result = priceAccumulatorSlip([
    { matchId: "100", odd: 1.5, home: "Team A", away: "Team B" },
    { matchId: "200", odd: 2, home: "Team C", away: "Team D" },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.totalOdds, 3);
});

test("standard accumulator rejects multiple selections from one match", () => {
  const result = priceAccumulatorSlip([
    { matchId: "552092", odd: 1.71, home: "PSG", away: "Bayern" },
    { matchId: "552092", odd: 1.31, home: "PSG", away: "Bayern" },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, "same_match_correlation");
  assert.equal(result.conflicts[0]?.matchId, "552092");
});

test("standard accumulator rejects missing or inactive odds", () => {
  const result = priceAccumulatorSlip([
    { matchId: "100", odd: 1.5, home: "Team A", away: "Team B" },
    { matchId: "200", odd: null, home: "Team C", away: "Team D" },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, "missing_odds");
  assert.equal(result.message, "Jeszcze nie ma kursów dla tego meczu.");
});
