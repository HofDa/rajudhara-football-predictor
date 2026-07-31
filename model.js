import { canonicalLeague, canonicalTeam } from "./normalization.js";

export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function poisson(goals, lambda) {
  let factorial = 1;
  for (let index = 2; index <= goals; index++) factorial *= index;
  return Math.exp(-lambda) * lambda ** goals / factorial;
}

export function scoreMatrix(lambdaHome, lambdaAway, maxGoals = 7) {
  const matrix = [];
  for (let home = 0; home <= maxGoals; home++) {
    for (let away = 0; away <= maxGoals; away++) {
      matrix.push({ home, away, h: home, a: away, p: poisson(home, lambdaHome) * poisson(away, lambdaAway) });
    }
  }
  return matrix;
}

export function marketProbabilities(lambdaHome, lambdaAway) {
  const total = lambdaHome + lambdaAway;
  const p0 = Math.exp(-total);
  const p1 = p0 * total;
  const p2 = p1 * total / 2;
  const p3 = p2 * total / 3;
  const over15 = 1 - p0 - p1;
  const over25 = 1 - p0 - p1 - p2;
  const over35 = 1 - p0 - p1 - p2 - p3;
  const bttsYes = (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));
  return {
    over15: clamp(over15, 0, 1),
    over25: clamp(over25, 0, 1),
    under25: clamp(1 - over25, 0, 1),
    over35: clamp(over35, 0, 1),
    bttsYes: clamp(bttsYes, 0, 1),
    bttsNo: clamp(1 - bttsYes, 0, 1)
  };
}

function teamKey(match, side) {
  return match[`${side}Key`] || canonicalTeam(match[side]);
}

export function leagueStats(matches, league) {
  const canonical = canonicalLeague(league);
  const rows = matches.filter(match => canonicalLeague(match.league) === canonical);
  const count = rows.length;
  const homeGoals = count ? rows.reduce((sum, match) => sum + Number(match.homeGoals || 0), 0) / count : 0;
  const awayGoals = count ? rows.reduce((sum, match) => sum + Number(match.awayGoals || 0), 0) / count : 0;
  return {
    matches: count,
    homeGoals,
    awayGoals,
    total: homeGoals + awayGoals,
    over25: count ? mean(rows.map(match => Number(match.homeGoals) + Number(match.awayGoals) >= 3 ? 1 : 0)) : 0,
    btts: count ? mean(rows.map(match => Number(match.homeGoals) > 0 && Number(match.awayGoals) > 0 ? 1 : 0)) : 0
  };
}

function teamSlices(matches, league, team) {
  const canonical = canonicalLeague(league);
  const key = canonicalTeam(team);
  const leagueRows = matches.filter(match => canonicalLeague(match.league) === canonical);
  return {
    home: leagueRows.filter(match => teamKey(match, "home") === key),
    away: leagueRows.filter(match => teamKey(match, "away") === key),
    all: leagueRows.filter(match => teamKey(match, "home") === key || teamKey(match, "away") === key)
  };
}

export function predictFixture(fixture, matches, cutoff = null) {
  const league = canonicalLeague(fixture.league);
  const cutoffTime = cutoff ? new Date(cutoff).getTime() : null;
  const usable = matches.filter(match => {
    if (canonicalLeague(match.league) !== league) return false;
    if (!cutoffTime) return true;
    const matchTime = new Date(match.date).getTime();
    return Number.isFinite(matchTime) && matchTime < cutoffTime;
  });

  const leagueAverage = leagueStats(usable, league);
  const home = teamSlices(usable, league, fixture.home);
  const away = teamSlices(usable, league, fixture.away);
  const priorWeight = 6;
  const shrink = (value, count, baseline) => (value * count + baseline * priorWeight) / (count + priorWeight);
  const leagueHome = leagueAverage.homeGoals || 1.45;
  const leagueAway = leagueAverage.awayGoals || 1.15;

  const homeScored = home.home.length ? mean(home.home.map(match => Number(match.homeGoals))) : leagueHome;
  const homeConceded = home.home.length ? mean(home.home.map(match => Number(match.awayGoals))) : leagueAway;
  const awayScored = away.away.length ? mean(away.away.map(match => Number(match.awayGoals))) : leagueAway;
  const awayConceded = away.away.length ? mean(away.away.map(match => Number(match.homeGoals))) : leagueHome;

  const homeAttack = shrink(homeScored / leagueHome, home.home.length, 1);
  const homeDefense = shrink(homeConceded / leagueAway, home.home.length, 1);
  const awayAttack = shrink(awayScored / leagueAway, away.away.length, 1);
  const awayDefense = shrink(awayConceded / leagueHome, away.away.length, 1);

  const lambdaHome = clamp(leagueHome * homeAttack * awayDefense, 0.2, 3.7);
  const lambdaAway = clamp(leagueAway * awayAttack * homeDefense, 0.15, 3.3);
  const samples = Math.min(home.all.length, away.all.length);
  const latest = usable.length ? Math.max(...usable.map(match => new Date(match.date).getTime()).filter(Number.isFinite)) : 0;
  const reference = cutoffTime || new Date(fixture.date || Date.now()).getTime() || Date.now();
  const ageDays = latest ? Math.max(0, (reference - latest) / 86400000) : 999;
  const quality = clamp(Math.round(20 + Math.min(50, samples * 2.4) + Math.min(20, leagueAverage.matches / 8) - Math.min(30, ageDays / 25)), 5, 95);

  return {
    lambdaHome,
    lambdaAway,
    markets: marketProbabilities(lambdaHome, lambdaAway),
    quality,
    samples,
    league: leagueAverage,
    matrix: scoreMatrix(lambdaHome, lambdaAway, 6),
    diagnostics: {
      league,
      homeMatches: home.all.length,
      awayMatches: away.all.length,
      homeKey: canonicalTeam(fixture.home),
      awayKey: canonicalTeam(fixture.away),
      fallback: !home.all.length || !away.all.length
    }
  };
}

export const fairOdds = probability => probability > 0 ? 1 / probability : null;
export const edge = (probability, odds) => odds > 1 ? (probability * odds - 1) * 100 : null;

export function profileTeams(matches, league) {
  const canonical = canonicalLeague(league);
  const rows = matches.filter(match => canonicalLeague(match.league) === canonical);
  const displayNames = new Map();
  rows.forEach(match => {
    displayNames.set(teamKey(match, "home"), match.home);
    displayNames.set(teamKey(match, "away"), match.away);
  });
  return [...displayNames.entries()].map(([key, display]) => {
    const home = rows.filter(match => teamKey(match, "home") === key);
    const away = rows.filter(match => teamKey(match, "away") === key);
    const all = rows.filter(match => teamKey(match, "home") === key || teamKey(match, "away") === key);
    return {
      team: display,
      teamKey: key,
      matches: all.length,
      homeGF: home.length ? mean(home.map(match => Number(match.homeGoals))) : 0,
      homeGA: home.length ? mean(home.map(match => Number(match.awayGoals))) : 0,
      awayGF: away.length ? mean(away.map(match => Number(match.awayGoals))) : 0,
      awayGA: away.length ? mean(away.map(match => Number(match.homeGoals))) : 0,
      over25: all.length ? mean(all.map(match => Number(match.homeGoals) + Number(match.awayGoals) >= 3 ? 1 : 0)) : 0,
      btts: all.length ? mean(all.map(match => Number(match.homeGoals) > 0 && Number(match.awayGoals) > 0 ? 1 : 0)) : 0
    };
  }).sort((a, b) => (b.homeGF + b.awayGF) - (a.homeGF + a.awayGF));
}
