import { clamp, scoreMatrix } from "./model.js";

// Which score lines win a market. Used to price several markets on the same
// fixture jointly instead of multiplying their probabilities.
export const marketPredicates = {
  over15: (home, away) => home + away >= 2,
  over25: (home, away) => home + away >= 3,
  under25: (home, away) => home + away <= 2,
  over35: (home, away) => home + away >= 4,
  bttsYes: (home, away) => home > 0 && away > 0,
  bttsNo: (home, away) => home === 0 || away === 0
};

// 18 keeps the truncation error against the closed-form market probabilities
// below 1e-7 even at the highest lambdas the model clamps to.
const MAX_GOALS = 18;

export function jointProbability(lambdaHome, lambdaAway, marketList = []) {
  const predicates = marketList.map(market => marketPredicates[market]).filter(Boolean);
  if (!predicates.length) return 0;
  const matrix = scoreMatrix(lambdaHome, lambdaAway, MAX_GOALS);
  let mass = 0;
  let hit = 0;
  for (const cell of matrix) {
    mass += cell.p;
    if (predicates.every(predicate => predicate(cell.h, cell.a))) hit += cell.p;
  }
  return mass > 0 ? clamp(hit / mass, 0, 1) : 0;
}

export const comboOdds = legs => legs.reduce((product, leg) => product * Number(leg.odds || 0), 1);

// legs: [{ fixture, prediction, market, odds, probability }]
export function comboAnalysis(legs = []) {
  if (!legs.length) return { legs: [], count: 0, fixtures: 0, probability: 0, independentProbability: 0, combinedOdds: null, fairOdds: null, edge: null, correlated: false, impossible: false, missingOdds: true };

  const groups = new Map();
  for (const leg of legs) {
    const key = String(leg.fixture.id);
    if (!groups.has(key)) groups.set(key, { fixture: leg.fixture, prediction: leg.prediction, markets: [] });
    groups.get(key).markets.push(leg.market);
  }

  let probability = 1;
  for (const group of groups.values()) {
    probability *= jointProbability(group.prediction.lambdaHome, group.prediction.lambdaAway, group.markets);
  }

  const independentProbability = legs.reduce((product, leg) => product * Number(leg.probability || 0), 1);
  const missingOdds = legs.some(leg => !(Number(leg.odds) > 1));
  const combinedOdds = missingOdds ? null : comboOdds(legs);

  return {
    legs,
    count: legs.length,
    fixtures: groups.size,
    probability,
    independentProbability,
    combinedOdds,
    fairOdds: probability > 0 ? 1 / probability : null,
    edge: combinedOdds ? (probability * combinedOdds - 1) * 100 : null,
    correlated: groups.size < legs.length,
    impossible: probability <= 0,
    missingOdds
  };
}
