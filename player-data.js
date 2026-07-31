import { canonicalLeague, canonicalTeam, normalizePosition, safeText } from "./normalization.js";

const pick = (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== "");
const number = value => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};
const boolean = value => [true, 1, "1", "true", "yes", "ja", "starter", "start"].includes(typeof value === "string" ? value.toLowerCase().trim() : value);
const statusMap = new Map([
  ["available", "available"], ["verfugbar", "available"], ["fit", "available"],
  ["injured", "injured"], ["verletzt", "injured"], ["infortunato", "injured"],
  ["suspended", "suspended"], ["gesperrt", "suspended"], ["squalificato", "suspended"],
  ["doubtful", "doubtful"], ["fraglich", "doubtful"], ["questionable", "doubtful"]
]);

function normalizeStatus(value) {
  const key = String(value || "available").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, "");
  return statusMap.get(key) || "available";
}

export function normalizePlayers(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const team = safeText(pick(row.team, row.Team, row.teamName, row.club));
    const league = canonicalLeague(pick(row.league, row.League, row.Div, row.competition));
    const name = safeText(pick(row.name, row.Player, row.player, row.playerName), "Unbekannt");
    return {
      id: safeText(pick(row.id, row.playerId, row.player_id), `player-${league}-${canonicalTeam(team)}-${canonicalTeam(name)}-${index}`),
      name,
      team,
      teamKey: canonicalTeam(team),
      league,
      position: normalizePosition(pick(row.position, row.Position, row.role)),
      minutes: number(pick(row.minutes, row.Minutes, row.appearancesMinutes)),
      starts: number(pick(row.starts, row.Starts, row.lineups)),
      goals: number(pick(row.goals, row.Goals)),
      assists: number(pick(row.assists, row.Assists)),
      xg: number(pick(row.xg, row.xG, row.expectedGoals)),
      xa: number(pick(row.xa, row.xA, row.expectedAssists)),
      shots: number(pick(row.shots, row.Shots)),
      shotsOnTarget: number(pick(row.shotsOnTarget, row.ShotsOnTarget, row.SOT)),
      keyPasses: number(pick(row.keyPasses, row.KeyPasses)),
      tacklesWon: number(pick(row.tacklesWon, row.TacklesWon, row.tackles)),
      interceptions: number(pick(row.interceptions, row.Interceptions)),
      saves: number(pick(row.saves, row.Saves)),
      goalsPrevented: number(pick(row.goalsPrevented, row.GoalsPrevented)),
      errorsToGoal: number(pick(row.errorsToGoal, row.ErrorsToGoal)),
      expectedStarter: boolean(pick(row.expectedStarter, row.ExpectedStarter, row.regularStarter)),
      status: normalizeStatus(pick(row.status, row.Status)),
      statusNote: safeText(pick(row.statusNote, row.StatusNote, row.reason))
    };
  }).filter(player => player.name && player.team && player.league);
}

export function normalizeLineups(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.lineups) ? data.lineups : [];
  return rows.map(item => {
    const teams = {};
    if (item.teams && typeof item.teams === "object") {
      Object.entries(item.teams).forEach(([teamName, value]) => {
        teams[canonicalTeam(teamName)] = {
          name: safeText(value?.name, teamName),
          formation: safeText(value?.formation),
          starters: Array.isArray(value?.starters) ? value.starters.map(String) : [],
          bench: Array.isArray(value?.bench) ? value.bench.map(String) : []
        };
      });
    }
    return {
      fixtureId: safeText(pick(item.fixtureId, item.fixture_id, item.id)),
      status: ["official", "expected"].includes(item.status) ? item.status : "expected",
      updatedAt: item.updatedAt ?? item.updated_at ?? null,
      teams,
      changes: Array.isArray(item.changes) ? item.changes : []
    };
  }).filter(item => item.fixtureId);
}
