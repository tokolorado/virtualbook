import test from "node:test";
import assert from "node:assert/strict";
import { formatBetSelectionLabels } from "../lib/odds/labels";

test("formats home team over/under market in Polish", () => {
  const labels = formatBetSelectionLabels({
    market: "home_ou_1_5",
    pick: "under",
    home: "Cagliari Calcio",
    away: "Atalanta BC",
  });

  assert.deepEqual(labels, {
    marketLabel: "Gole gospodarzy",
    selectionLabel: "Poniżej 1,5",
    label: "Gole gospodarzy: Poniżej 1,5",
  });
});

test("formats classic 1X2 picks with team names", () => {
  const labels = formatBetSelectionLabels({
    market: "1x2",
    pick: "2",
    home: "AC Milan",
    away: "Juventus FC",
  });

  assert.deepEqual(labels, {
    marketLabel: "1X2",
    selectionLabel: "Juventus FC",
    label: "1X2: Juventus FC",
  });
});

test("formats double chance picks", () => {
  const labels = formatBetSelectionLabels({
    market: "dc",
    pick: "1X",
    home: "Fiorentina",
    away: "Sassuolo",
  });

  assert.deepEqual(labels, {
    marketLabel: "Podwójna szansa",
    selectionLabel: "Fiorentina lub remis",
    label: "Podwójna szansa: Fiorentina lub remis",
  });
});
