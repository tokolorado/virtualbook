import test from "node:test";
import assert from "node:assert/strict";
import { priceBetBuilderSlip } from "../lib/bets/betBuilderPricing";

const ODDS_ROWS = [
  { market_id: "1x2", selection: "1", fair_prob: 0.38, book_odds: 2.35 },
  { market_id: "1x2", selection: "X", fair_prob: 0.28, book_odds: 3.15 },
  { market_id: "1x2", selection: "2", fair_prob: 0.34, book_odds: 2.65 },
  { market_id: "btts", selection: "yes", fair_prob: 0.56, book_odds: 1.71 },
  { market_id: "ou_2_5", selection: "over", fair_prob: 0.52, book_odds: 1.85 },
  { market_id: "home_ou_0_5", selection: "over", fair_prob: 0.78, book_odds: 1.31 },
  { market_id: "away_ou_0_5", selection: "over", fair_prob: 0.76, book_odds: 1.23 },
];

test("bet builder prices same-match correlated selections below naive product", () => {
  const result = priceBetBuilderSlip({
    stake: 100,
    oddsRows: ODDS_ROWS,
    items: [
      {
        matchId: "552092",
        market: "btts",
        pick: "yes",
        odd: 1.71,
      },
      {
        matchId: "552092",
        market: "home_ou_0_5",
        pick: "over",
        odd: 1.31,
      },
      {
        matchId: "552092",
        market: "away_ou_0_5",
        pick: "over",
        odd: 1.23,
      },
    ],
  });

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.mode, "bet_builder");
    assert.ok(result.totalOdds > 1);
    assert.ok(result.totalOdds < result.productOdds);
    assert.ok(result.correlationFactor < 1);
    assert.equal(result.potentialWin, Number((100 * result.totalOdds).toFixed(2)));
  }
});

test("bet builder rejects multiple matches", () => {
  const result = priceBetBuilderSlip({
    oddsRows: ODDS_ROWS,
    items: [
      { matchId: "100", market: "btts", pick: "yes", odd: 1.71 },
      { matchId: "200", market: "ou_2_5", pick: "over", odd: 1.85 },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "multi_match");
});
