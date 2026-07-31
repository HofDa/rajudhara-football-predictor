import { clamp, marketProbabilities, scoreMatrix } from "./model.js";
import { canonicalLeague, canonicalTeam } from "./normalization.js";

const per90 = (value, minutes) => Number(value || 0) / Math.max(1, Number(minutes || 0) / 90);

export function playerImpact(player) {
  const minutes = Number(player.minutes || 0);
  const position = player.position || "CM";
  const goals90 = per90(player.goals, minutes);
  const assists90 = per90(player.assists, minutes);
  const xg90 = per90(player.xg, minutes);
  const xa90 = per90(player.xa, minutes);
  const shotsOnTarget90 = per90(player.shotsOnTarget, minutes);
  const keyPasses90 = per90(player.keyPasses, minutes);
  const tackles90 = per90(player.tacklesWon, minutes);
  const interceptions90 = per90(player.interceptions, minutes);
  const saves90 = per90(player.saves, minutes);
  const prevented90 = per90(player.goalsPrevented, minutes);
  const errors90 = per90(player.errorsToGoal, minutes);
  const attackMultiplier = { GK: .05, CB: .18, FB: .35, DM: .42, CM: .65, AM: .95, W: 1, ST: 1.08 }[position] || .6;
  const defensiveMultiplier = { GK: 1, CB: 1, FB: .8, DM: .88, CM: .48, AM: .22, W: .18, ST: .12 }[position] || .4;
  const attack = clamp(attackMultiplier * (goals90 * .11 + assists90 * .07 + xg90 * .09 + xa90 * .07 + shotsOnTarget90 * .012 + keyPasses90 * .009), 0, .30);
  const defense = position === "GK"
    ? clamp(prevented90 * .20 + saves90 * .006 - errors90 * .22, -.22, .24)
    : clamp(defensiveMultiplier * (tackles90 * .011 + interceptions90 * .014) - errors90 * .18, -.16, .18);
  const reliability = clamp(minutes / 1350, .2, 1);
  return { attack: attack * reliability, defense: defense * reliability, reliability, per90: { goals90, assists90, xg90, xa90, shotsOnTarget90, keyPasses90 } };
}

function fixtureLineup(fixture, lineups) {
  return lineups.find(item => String(item.fixtureId) === String(fixture.id)) || null;
}

function lineupTeam(fixtureLineup, teamName) {
  if (!fixtureLineup?.teams) return null;
  return fixtureLineup.teams[canonicalTeam(teamName)] || Object.values(fixtureLineup.teams).find(team => canonicalTeam(team.name) === canonicalTeam(teamName)) || null;
}

function teamLineupSummary(team, league, fixtureLineup, players) {
  const teamKey = canonicalTeam(team);
  const canonical = canonicalLeague(league);
  const squad = players.filter(player => canonicalLeague(player.league) === canonical && (player.teamKey || canonicalTeam(player.team)) === teamKey);
  const expected = squad.filter(player => player.expectedStarter);
  const lineup = lineupTeam(fixtureLineup, team);
  const starterIds = new Set((lineup?.starters || []).map(String));
  const starters = starterIds.size
    ? squad.filter(player => starterIds.has(String(player.id)))
    : expected.filter(player => ["available", "doubtful"].includes(player.status));
  const expectedAttack = expected.reduce((sum, player) => sum + playerImpact(player).attack, 0);
  const expectedDefense = expected.reduce((sum, player) => sum + playerImpact(player).defense, 0);
  const currentAttack = starters.reduce((sum, player) => sum + playerImpact(player).attack, 0);
  const currentDefense = starters.reduce((sum, player) => sum + playerImpact(player).defense, 0);
  const expectedIds = new Set(expected.map(player => String(player.id)));
  const starterIdSet = new Set(starters.map(player => String(player.id)));
  const missing = expected.filter(player => !starterIdSet.has(String(player.id)));
  const unexpected = starters.filter(player => !expectedIds.has(String(player.id)));
  return {
    formation: lineup?.formation || "",
    source: starterIds.size ? "lineup" : "availability",
    starters,
    expected,
    missing,
    unexpected,
    squadCount: squad.length,
    attackDelta: clamp(currentAttack - expectedAttack, -.38, .28),
    defenseDelta: clamp(currentDefense - expectedDefense, -.34, .24),
    expectedAttack,
    expectedDefense,
    currentAttack,
    currentDefense
  };
}

export function adjustPredictionWithPlayers(base, fixture, players = [], lineups = []) {
  const lineup = fixtureLineup(fixture, lineups);
  const leaguePlayers = players.filter(player => canonicalLeague(player.league) === canonicalLeague(fixture.league));
  if (!leaguePlayers.length) {
    return { ...base, baseLambdaHome: base.lambdaHome, baseLambdaAway: base.lambdaAway, playerAdjustmentAvailable: false, lineupStatus: "no-player-data", homeLineup: null, awayLineup: null, insights: [], adjustments: { homeAttack: 0, homeDefense: 0, awayAttack: 0, awayDefense: 0 } };
  }
  const home = teamLineupSummary(fixture.home, fixture.league, lineup, leaguePlayers);
  const away = teamLineupSummary(fixture.away, fixture.league, lineup, leaguePlayers);
  const available = home.squadCount > 0 && away.squadCount > 0 && home.expected.length > 0 && away.expected.length > 0;
  if (!available) {
    return { ...base, baseLambdaHome: base.lambdaHome, baseLambdaAway: base.lambdaAway, playerAdjustmentAvailable: false, lineupStatus: "teams-unmatched", homeLineup: home, awayLineup: away, insights: [], adjustments: { homeAttack: 0, homeDefense: 0, awayAttack: 0, awayDefense: 0 } };
  }
  const lambdaHome = clamp(base.lambdaHome + home.attackDelta - away.defenseDelta, .15, 4.2);
  const lambdaAway = clamp(base.lambdaAway + away.attackDelta - home.defenseDelta, .10, 3.8);
  const qualityBonus = lineup?.status === "official" ? 7 : lineup?.status === "expected" ? 3 : 0;
  const insights = [];
  for (const [team, summary] of [[fixture.home, home], [fixture.away, away]]) {
    for (const player of summary.missing) {
      insights.push({ team, type: "missing", notStarting: player.status === "available", player, impact: playerImpact(player) });
    }
    for (const player of summary.unexpected) insights.push({ team, type: "replacement", player, impact: playerImpact(player) });
  }
  return {
    ...base,
    baseLambdaHome: base.lambdaHome,
    baseLambdaAway: base.lambdaAway,
    lambdaHome,
    lambdaAway,
    markets: marketProbabilities(lambdaHome, lambdaAway),
    matrix: scoreMatrix(lambdaHome, lambdaAway, 6),
    quality: clamp(base.quality + qualityBonus, 5, 99),
    playerAdjustmentAvailable: true,
    lineupStatus: lineup?.status || "estimated",
    lineupUpdatedAt: lineup?.updatedAt || null,
    homeLineup: home,
    awayLineup: away,
    adjustments: { homeAttack: home.attackDelta, homeDefense: home.defenseDelta, awayAttack: away.attackDelta, awayDefense: away.defenseDelta, homeLambda: lambdaHome - base.lambdaHome, awayLambda: lambdaAway - base.lambdaAway },
    insights
  };
}

export function playerRanking(players, league = "all", team = "all") {
  const canonical = league === "all" ? "all" : canonicalLeague(league);
  const teamKey = team === "all" ? "all" : canonicalTeam(team);
  return players
    .filter(player => canonical === "all" || canonicalLeague(player.league) === canonical)
    .filter(player => teamKey === "all" || (player.teamKey || canonicalTeam(player.team)) === teamKey)
    .map(player => ({ ...player, impact: playerImpact(player) }))
    .sort((a, b) => (b.impact.attack + b.impact.defense) - (a.impact.attack + a.impact.defense));
}
