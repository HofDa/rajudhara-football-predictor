/**
 * Normalized backend contract for Rajudhara Football Predictor.
 * Provider API keys must remain on the server.
 */
export async function fetchFixtures(baseUrl, leagues) {
  const response = await fetch(`${baseUrl}/api/fixtures?leagues=${encodeURIComponent(leagues.join(","))}`);
  if (!response.ok) throw new Error("Fixture adapter failed");
  return response.json();
}
export async function fetchHistory(baseUrl, league, season) {
  const response = await fetch(`${baseUrl}/api/history?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`);
  if (!response.ok) throw new Error("History adapter failed");
  return response.json();
}
export async function fetchPlayers(baseUrl, league, season) {
  const response = await fetch(`${baseUrl}/api/players?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}`);
  if (!response.ok) throw new Error("Player adapter failed");
  return response.json();
}
export async function fetchLineup(baseUrl, fixtureId) {
  const response = await fetch(`${baseUrl}/api/fixtures/${encodeURIComponent(fixtureId)}/lineups`);
  if (!response.ok) throw new Error("Lineup adapter failed");
  return response.json();
}
export async function fetchFixturePlayerStatistics(baseUrl, fixtureId) {
  const response = await fetch(`${baseUrl}/api/fixtures/${encodeURIComponent(fixtureId)}/player-statistics`);
  if (!response.ok) throw new Error("Player-statistics adapter failed");
  return response.json();
}
