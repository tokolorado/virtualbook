import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMissions, missionWindow } from "../lib/missions";

const NOW = new Date("2026-04-29T12:00:00.000Z");

test("missions evaluate daily and weekly progress without double counting claims", () => {
  const window = missionWindow(NOW);
  const missions = evaluateMissions({
    now: NOW,
    bets: [
      {
        id: "bet-1",
        status: "won",
        total_odds: 2.1,
        created_at: "2026-04-29T08:00:00.000Z",
      },
      {
        id: "bet-2",
        status: "pending",
        total_odds: 1.7,
        created_at: "2026-04-29T09:00:00.000Z",
      },
      {
        id: "bet-3",
        status: "lost",
        total_odds: 3.4,
        created_at: "2026-04-29T10:00:00.000Z",
      },
    ],
    items: [
      { bet_id: "bet-1", odds: 2.1 },
      { bet_id: "bet-3", odds: 3.4 },
    ],
    claims: [
      {
        mission_id: "daily_win_odds_2",
        period_key: window.dailyKey,
      },
    ],
  });

  const dailyPlace = missions.find((mission) => mission.id === "daily_place_3_bets");
  const dailyWin = missions.find((mission) => mission.id === "daily_win_odds_2");
  const underdog = missions.find((mission) => mission.id === "daily_underdog_pick");

  assert.equal(dailyPlace?.completed, true);
  assert.equal(dailyPlace?.claimable, true);
  assert.equal(dailyWin?.completed, true);
  assert.equal(dailyWin?.claimed, true);
  assert.equal(dailyWin?.claimable, false);
  assert.equal(underdog?.completed, true);
});
