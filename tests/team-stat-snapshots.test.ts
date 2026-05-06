import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_COMPETITIONS_ID,
  buildTeamStatSnapshotsFromPricingFeatures,
  type MatchPricingFeatureInputRow,
} from "../lib/teamStats/snapshots";

function featureRow(
  matchId: number,
  homeXg: number,
  awayXg: number
): MatchPricingFeatureInputRow {
  return {
    match_id: matchId,
    source_event_id: String(10_000 + matchId),
    competition_id: "CL",
    competition_name: "Champions League",
    utc_date: `2026-05-${String(matchId).padStart(2, "0")}T19:00:00.000Z`,
    status: "SCHEDULED",
    home_team: "Home FC",
    away_team: "Away FC",
    home_team_id: 1,
    away_team_id: 2,
    home_score: null,
    away_score: null,
    expected_home_goals: homeXg,
    expected_away_goals: awayXg,
    probability_over_15: 0.72,
    probability_over_25: 0.54,
    probability_over_35: 0.28,
    probability_btts_yes: 0.49,
    travel_distance_km: 850,
    raw_features: {},
  };
}

test("builds team stat snapshots from BSD match pricing features", () => {
  const rows = Array.from({ length: 6 }, (_, index) =>
    featureRow(index + 1, 1.7 + index * 0.05, 1.1 + index * 0.03)
  );

  const result = buildTeamStatSnapshotsFromPricingFeatures(rows, {
    snapshotDate: "2026-05-06",
    generatedAt: "2026-05-06T12:00:00.000Z",
  });

  assert.equal(result.summary.sourceRows, 6);
  assert.equal(result.summary.appearances, 12);
  assert.equal(result.summary.teams, 2);
  assert.equal(result.summary.allCompetitionSnapshots, 2);

  const homeAll = result.rows.find(
    (row) =>
      row.team_id === 1 && row.competition_id === ALL_COMPETITIONS_ID
  );
  const awayAll = result.rows.find(
    (row) =>
      row.team_id === 2 && row.competition_id === ALL_COMPETITIONS_ID
  );

  assert.ok(homeAll);
  assert.ok(awayAll);
  assert.equal(homeAll.matches_count, 6);
  assert.equal(awayAll.matches_count, 6);
  assert.equal(homeAll.snapshot_date, "2026-05-06");
  assert.equal(homeAll.goals_for_per_game, null);
  assert.ok((homeAll.xg_for_per_game ?? 0) > (awayAll.xg_for_per_game ?? 0));
  assert.ok((homeAll.attack_strength ?? 0) > 1);
  assert.ok((awayAll.defense_strength ?? 0) > 1);
  assert.equal(homeAll.btts_rate, 0.49);
  assert.equal(homeAll.over25_rate, 0.54);
  assert.equal(homeAll.raw_source.modelVersion, "team-stats-from-bsd-features-v1");
});

test("skips rows without stable team ids", () => {
  const result = buildTeamStatSnapshotsFromPricingFeatures(
    [
      {
        ...featureRow(1, 1.2, 1.1),
        home_team_id: null,
      },
    ],
    {
      snapshotDate: "2026-05-06",
      generatedAt: "2026-05-06T12:00:00.000Z",
    }
  );

  assert.equal(result.summary.appearances, 1);
  assert.equal(result.summary.skippedMissingTeamId, 1);
  assert.equal(result.rows.length, 2);
});
