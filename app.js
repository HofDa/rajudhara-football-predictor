import { predictFixture, fairOdds, edge, leagueStats, profileTeams } from "./model.js";
import { adjustPredictionWithPlayers, playerRanking, playerImpact } from "./player-model.js";
import { parseCSV, normalizeHistory, normalizeFixtures, importReport, toCSV } from "./csv.js";
import { normalizePlayers, normalizeLineups } from "./player-data.js";
import { canonicalLeague, canonicalTeam } from "./normalization.js";
import { store, bytes, storageVersion } from "./storage.js";
import { sentiment } from "./sentiment.js";
import { comboAnalysis } from "./combo.js";
import { LANGUAGES, t, language, setLanguage, onLanguageChange, applyTranslations, num, signedNum, pct, money, marketLabel } from "./i18n.js";

let leagues = [];
let history = [];
let fixtures = [];
let players = [];
let lineups = [];
let analyses = [];
let slip = [];
let deferredInstall = null;
let toastTimer = null;
let pendingComboLegs = 1;

const $ = id => document.getElementById(id);
const markets = ["over15", "over25", "under25", "over35", "bttsYes", "bttsNo"];
const statusLabel = status => t(`status.${status}`) === `status.${status}` ? status : t(`status.${status}`);
const supportedLeagueCodes = () => leagues.map(item => item.code);
const leagueName = league => (language() === "en" ? league.nameEn : null) || league.name;
const leagueLabel = (code, fallback = "") => {
  const league = leagues.find(item => item.code === code);
  return league ? leagueName(league) : fallback || code;
};
const localizedLeagues = () => leagues.map(item => ({ code: item.code, name: leagueName(item) }));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showToast(message, type = "info", timeout = 4200) {
  const toast = $("toast");
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toastTimer = setTimeout(() => toast.classList.add("hidden"), timeout);
}

async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(t("toast.fileLoadFailed", { path }));
  return response.json();
}

async function fetchText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(t("toast.fileLoadFailed", { path }));
  return response.text();
}

const storageError = result => result.code === "quota" ? t("toast.storageFull") : result.error;

function persist(kind, value) {
  const setter = {
    history: store.setHistory,
    fixtures: store.setFixtures,
    players: store.setPlayers,
    lineups: store.setLineups,
    bets: store.setBets
  }[kind];
  const result = setter?.(value);
  if (result && !result.ok) throw new Error(storageError(result));
}

function navigate(name, updateHash = true) {
  const view = $(`${name}View`);
  if (!view) return;
  document.querySelectorAll(".view").forEach(item => item.classList.remove("active"));
  document.querySelectorAll("[data-nav]").forEach(button => button.classList.toggle("active", button.dataset.nav === name));
  view.classList.add("active");
  if (updateHash && location.hash !== `#${name}`) window.history.replaceState(null, "", `#${name}`);
  if (name === "profiles") renderProfiles();
  if (name === "players") renderPlayers();
  if (name === "bets") renderBets();
}

function download(name, text, type = "text/plain") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

function setOptions(element, items, allLabel = null) {
  if (!element) return;
  const current = element.value;
  element.innerHTML = (allLabel ? `<option value="all">${escapeHtml(allLabel)}</option>` : "") + items.map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.name)}</option>`).join("");
  if (current && [...element.options].some(option => option.value === current)) element.value = current;
}

function saveSource(part, value) {
  const source = store.source();
  source[part] = value;
  const result = store.setSource(source);
  if (result && !result.ok) throw new Error(storageError(result));
}

function sourceLabel(value) {
  if (!value || value === "none") return t("data.sourceNone");
  if (value === "demo") return t("data.sourceDemo");
  if (value === "real") return t("data.sourceReal");
  return value;
}

function updateStatus() {
  const source = store.source();
  const sources = [source.history, source.fixtures, source.players, source.lineups];
  const demo = sources.some(value => value === "demo");
  const hasReal = sources.some(value => value === "real");
  const allReal = sources.every(value => value === "real");

  if ($("dataState")) {
    if (allReal || hasReal) {
      $("dataState").textContent = t("scanner.realData");
      $("dataState").className = "badge success";
    } else if (demo) {
      $("dataState").textContent = t("scanner.demoData");
      $("dataState").className = "badge warning";
    } else {
      $("dataState").textContent = t("scanner.ownData");
      $("dataState").className = "badge";
    }
  }
  if ($("historyStatus")) $("historyStatus").textContent = t("data.statusHistory", { count: history.length, source: sourceLabel(source.history) });
  if ($("fixturesStatus")) $("fixturesStatus").textContent = t("data.statusFixtures", { count: fixtures.length, source: sourceLabel(source.fixtures) });
  if ($("playersStatus")) $("playersStatus").textContent = t("data.statusPlayers", { count: players.length, source: sourceLabel(source.players) });
  if ($("lineupsStatus")) $("lineupsStatus").textContent = t("data.statusLineups", { count: lineups.length, source: sourceLabel(source.lineups) });
  if ($("storageInfo")) $("storageInfo").textContent = t("data.storageInfo", { matches: history.length, players: players.length, size: num(bytes() / 1024, 1), version: storageVersion });
}

const slipId = (fixtureId, market) => `${fixtureId}::${market}`;
const inSlip = (fixtureId, market) => slip.some(item => slipId(item.fixtureId, item.market) === slipId(fixtureId, market));

function persistSlip() {
  const result = store.setSlip(slip);
  if (result && !result.ok) showToast(storageError(result), "error");
}

function toggleSlip(fixtureId, market) {
  const key = slipId(fixtureId, market);
  slip = inSlip(fixtureId, market) ? slip.filter(item => slipId(item.fixtureId, item.market) !== key) : [...slip, { fixtureId: String(fixtureId), market }];
  persistSlip();
  renderSlip();
  renderScanner();
  if ($("fixtureSelect")?.value) renderMatch($("fixtureSelect").value);
}

function slipLegs() {
  return slip.map(item => {
    const entry = analyses.find(analysis => String(analysis.fixture.id) === String(item.fixtureId) && analysis.market === item.market);
    return entry ? { fixture: entry.fixture, prediction: entry.prediction, market: entry.market, odds: entry.odds, probability: entry.probability } : null;
  }).filter(Boolean);
}

function legLabel(leg) {
  return t("combo.legLabel", { home: leg.fixture.home, away: leg.fixture.away, market: marketLabel(leg.market) });
}

function slipButton(fixtureId, market) {
  const active = inSlip(fixtureId, market);
  return `<button class="btn subtle slip-toggle${active ? " active" : ""}" data-fixture="${escapeHtml(fixtureId)}" data-market="${escapeHtml(market)}" title="${escapeHtml(active ? t("combo.remove") : t("combo.add"))}" aria-label="${escapeHtml(active ? t("combo.remove") : t("combo.add"))}">${active ? "✓" : "+"}</button>`;
}

function wireSlipToggles() {
  document.querySelectorAll(".slip-toggle").forEach(button => button.onclick = () => toggleSlip(button.dataset.fixture, button.dataset.market));
}

function renderSlip() {
  if (!$("slipLegs")) return;
  const legs = slipLegs();
  const stake = Number($("slipStake")?.value || 0);
  const analysis = comboAnalysis(legs);
  $("slipLegs").innerHTML = legs.map(leg => `<div class="slip-row"><span>${escapeHtml(legLabel(leg))}</span><b>${leg.odds > 1 ? num(leg.odds) : "–"}</b><span class="muted">${pct(leg.probability)}</span><button class="btn danger slip-remove" data-fixture="${escapeHtml(leg.fixture.id)}" data-market="${escapeHtml(leg.market)}" aria-label="${escapeHtml(t("combo.remove"))}">×</button></div>`).join("") || `<p class="muted">${escapeHtml(t("combo.empty"))}</p>`;
  $("slipSummary").innerHTML = legs.length ? [
    [t("combo.combinedOdds"), analysis.combinedOdds ? num(analysis.combinedOdds) : "–", t("combo.combinedOddsHint")],
    [t("combo.probability"), pct(analysis.probability), analysis.correlated ? t("combo.probabilityJoint") : t("combo.legs", { count: analysis.count })],
    [t("combo.fairOdds"), analysis.fairOdds ? num(analysis.fairOdds) : "–", t("combo.fairOddsHint")],
    [t("combo.edge"), analysis.edge === null ? "–" : `${num(analysis.edge, 1)} %`, analysis.combinedOdds ? t("combo.payout", { value: money(stake * analysis.combinedOdds) }) : t("combo.legs", { count: analysis.count })]
  ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("") : "";
  const notes = [];
  if (legs.length && analysis.correlated) notes.push(["warning-box", t("combo.correlationNote", { value: pct(analysis.independentProbability) })]);
  if (legs.length && analysis.impossible) notes.push(["warning-box", t("combo.impossible")]);
  if (legs.length && analysis.missingOdds) notes.push(["warning-box", t("combo.missingOdds")]);
  $("slipNotes").innerHTML = notes.map(([css, text]) => `<p class="slip-note ${css}">${escapeHtml(text)}</p>`).join("");
  $("slipToJournalBtn").disabled = !analysis.combinedOdds;
  document.querySelectorAll(".slip-remove").forEach(button => button.onclick = () => toggleSlip(button.dataset.fixture, button.dataset.market));
}

function predictionForFixture(fixture) {
  return adjustPredictionWithPlayers(predictFixture(fixture, history), fixture, players, lineups);
}

function compute() {
  try {
    analyses = fixtures.flatMap(fixture => {
      const prediction = predictionForFixture(fixture);
      return markets.map(market => {
        const odds = Number(fixture.odds?.[market] || 0);
        return { fixture, prediction, market, probability: prediction.markets[market], odds, edge: edge(prediction.markets[market], odds) };
      });
    });
    renderScanner();
    renderFixtureSelect();
    renderSlip();
    updatePlayerTeamOptions();
    updateStatus();
  } catch (error) {
    console.error(error);
    showToast(t("toast.computeFailed", { message: error.message }), "error", 8000);
  }
}

function lineupStatusLabel(status) {
  const keys = { official: "lineup.official", expected: "lineup.expected", estimated: "lineup.estimated", "no-player-data": "lineup.noPlayerData", "teams-unmatched": "lineup.teamsUnmatched" };
  return keys[status] ? t(keys[status]) : status || t("lineup.noData");
}

function lineupBadge(prediction) {
  if (!prediction.playerAdjustmentAvailable) return `<span class="lineup-badge none">${escapeHtml(lineupStatusLabel(prediction.lineupStatus))}</span>`;
  const css = prediction.lineupStatus === "official" ? "official" : "";
  return `<span class="lineup-badge ${css}">${escapeHtml(lineupStatusLabel(prediction.lineupStatus))}</span>`;
}

function renderScanner() {
  if (!$("scannerRows")) return;
  const league = $("leagueFilter").value;
  const market = $("marketFilter").value;
  const minEdge = Number($("edgeFilter").value);
  const minQuality = Number($("qualityFilter").value);
  const sort = $("sortFilter").value;
  let rows = analyses.filter(item => (league === "all" || item.fixture.league === league) && (market === "all" || item.market === market) && item.prediction.quality >= minQuality && item.edge !== null && item.edge >= minEdge);
  rows.sort((a, b) => sort === "quality" ? b.prediction.quality - a.prediction.quality : sort === "probability" ? b.probability - a.probability : sort === "date" ? a.fixture.date.localeCompare(b.fixture.date) : (b.edge ?? -999) - (a.edge ?? -999));
  const positive = rows.filter(item => item.edge > 0);
  const best = positive[0];
  const adjustedGames = new Set(rows.filter(item => item.prediction.playerAdjustmentAvailable).map(item => item.fixture.id)).size;
  $("scannerSummary").innerHTML = [
    [t("scanner.cardMatches"), new Set(rows.map(item => item.fixture.id)).size, t("scanner.cardMatchesHint")],
    [t("scanner.cardAdjusted"), adjustedGames, t("scanner.cardAdjustedHint")],
    [t("scanner.cardValue"), positive.length, t("scanner.cardValueHint", { edge: num(minEdge, 1) })],
    [t("scanner.cardBest"), best ? `${num(best.edge, 1)} %` : "–", best ? `${best.fixture.home} – ${best.fixture.away}` : t("scanner.cardBestNone")]
  ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("");
  $("scannerRows").innerHTML = rows.map(item => `<tr>
    <td><strong>${escapeHtml(item.fixture.home)} – ${escapeHtml(item.fixture.away)}</strong><br><small>${escapeHtml(leagueLabel(item.fixture.league, item.fixture.leagueName))} · ${escapeHtml(item.fixture.date)} ${escapeHtml(item.fixture.time || "")}</small></td>
    <td>${lineupBadge(item.prediction)}</td><td>${escapeHtml(marketLabel(item.market))}</td><td>${pct(item.probability)}</td><td>${num(fairOdds(item.probability))}</td><td>${num(item.odds)}</td>
    <td class="${item.edge >= 0 ? "edge-positive" : "edge-negative"}">${num(item.edge, 1)} %</td><td><div class="quality"><span style="width:${item.prediction.quality}%"></span></div><small>${item.prediction.quality}/100</small></td>
    <td><div class="row-actions">${slipButton(item.fixture.id, item.market)}<button class="btn subtle open-match" data-id="${escapeHtml(item.fixture.id)}">${escapeHtml(t("scanner.details"))}</button></div></td></tr>`).join("") || `<tr><td colspan="9">${escapeHtml(t("scanner.noHits"))}</td></tr>`;
  document.querySelectorAll(".open-match").forEach(button => button.onclick = () => { navigate("match"); $("fixtureSelect").value = button.dataset.id; renderMatch(button.dataset.id); });
  wireSlipToggles();
}

function renderFixtureSelect() {
  if (!$("fixtureSelect")) return;
  const current = $("fixtureSelect").value;
  $("fixtureSelect").innerHTML = fixtures.map(fixture => `<option value="${escapeHtml(fixture.id)}">${escapeHtml(fixture.league)} · ${escapeHtml(fixture.home)} – ${escapeHtml(fixture.away)}</option>`).join("");
  const selected = fixtures.some(item => item.id === current) ? current : fixtures[0]?.id;
  if (selected) { $("fixtureSelect").value = selected; renderMatch(selected); }
  else $("matchAnalysis").innerHTML = `<section class="panel">${escapeHtml(t("match.noFixtures"))}</section>`;
}

function formationLabel(summary) {
  return summary.formation || t(summary.source === "lineup" ? "lineup.formationUnknown" : "lineup.fromAvailability");
}

function insightText(insight) {
  const params = { name: insight.player.name, position: insight.player.position, attack: num(insight.impact.attack), defense: num(insight.impact.defense) };
  if (insight.type === "replacement") return t("lineup.replacement", params);
  if (insight.notStarting) return t("lineup.notStarting", params);
  return t("lineup.missing", { ...params, reason: insight.player.statusNote || statusLabel(insight.player.status) });
}

function renderLineupTeam(teamName, summary) {
  if (!summary?.starters?.length) return `<article class="lineup-team"><h3>${escapeHtml(teamName)}</h3><p>${escapeHtml(t("lineup.noStarters"))}</p></article>`;
  return `<article class="lineup-team"><div class="lineup-head"><div><h3>${escapeHtml(teamName)}</h3><span class="formation">${escapeHtml(formationLabel(summary))}</span></div><small>${escapeHtml(t("lineup.playerCount", { count: summary.starters.length }))}</small></div><div class="starter-list">${summary.starters.map(player => { const impact = playerImpact(player); return `<div class="starter-row"><span class="player-name"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.position)} · ${escapeHtml(statusLabel(player.status))}</small></span><span class="impact-positive">A ${num(impact.attack)}</span><span>D ${num(impact.defense)}</span></div>`; }).join("")}</div></article>`;
}

function renderMatch(id) {
  const fixture = fixtures.find(item => String(item.id) === String(id));
  if (!fixture || !$("matchAnalysis")) return;
  const prediction = predictionForFixture(fixture);
  const topScores = [...prediction.matrix].sort((a, b) => b.p - a.p).slice(0, 12);
  const baseHome = prediction.baseLambdaHome ?? prediction.lambdaHome;
  const baseAway = prediction.baseLambdaAway ?? prediction.lambdaAway;
  $("matchAnalysis").innerHTML = `<div class="match-hero"><div class="team-name">${escapeHtml(fixture.home)}</div><div><div class="versus">VS</div><small>${escapeHtml(leagueLabel(fixture.league, fixture.leagueName))}<br>${escapeHtml(fixture.date)} ${escapeHtml(fixture.time || "")}<br>${lineupBadge(prediction)}</small></div><div class="team-name">${escapeHtml(fixture.away)}</div></div>
  <div class="summary-grid">${[
    [t("match.baseLambdaHome"), num(baseHome), t("match.withoutPlayers")],
    [t("match.finalLambdaHome"), num(prediction.lambdaHome), t("match.adjustment", { value: signedNum(prediction.lambdaHome - baseHome) })],
    [t("match.baseLambdaAway"), num(baseAway), t("match.withoutPlayers")],
    [t("match.finalLambdaAway"), num(prediction.lambdaAway), t("match.adjustment", { value: signedNum(prediction.lambdaAway - baseAway) })]
  ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("")}</div>
  <section class="panel"><div class="section-head"><div><p class="kicker">${escapeHtml(t("match.diagnosticsKicker"))}</p><h2>${escapeHtml(t("match.diagnosticsTitle"))}</h2></div><span class="badge">${escapeHtml(t("match.quality", { value: prediction.quality }))}</span></div><div class="diagnostic-grid"><div><strong>${prediction.diagnostics?.homeMatches ?? 0}</strong><span>${escapeHtml(t("match.matchesOf", { team: fixture.home }))}</span></div><div><strong>${prediction.diagnostics?.awayMatches ?? 0}</strong><span>${escapeHtml(t("match.matchesOf", { team: fixture.away }))}</span></div><div><strong>${prediction.samples}</strong><span>${escapeHtml(t("match.commonSample"))}</span></div><div><strong>${escapeHtml(prediction.diagnostics?.fallback ? t("match.yes") : t("match.no"))}</strong><span>${escapeHtml(t("match.leagueFallback"))}</span></div></div></section>
  <section class="panel"><div class="section-head"><div><p class="kicker">${escapeHtml(t("match.playerImpactKicker"))}</p><h2>${escapeHtml(t("match.playerImpactTitle"))}</h2></div></div>${prediction.playerAdjustmentAvailable ? `<div class="adjustment-grid">${[[t("match.attackOf", { team: fixture.home }), prediction.adjustments.homeAttack], [t("match.defenseOf", { team: fixture.home }), prediction.adjustments.homeDefense], [t("match.attackOf", { team: fixture.away }), prediction.adjustments.awayAttack], [t("match.defenseOf", { team: fixture.away }), prediction.adjustments.awayDefense]].map(item => `<div class="adjustment-card"><span>${escapeHtml(item[0])}</span><strong class="${item[1] >= 0 ? "impact-positive" : "impact-negative"}">${signedNum(item[1])}</strong></div>`).join("")}</div><div class="insight-list">${prediction.insights.map(item => `<div class="insight ${escapeHtml(item.type)}">${escapeHtml(insightText(item))}</div>`).join("") || `<div class="insight">${escapeHtml(t("match.noChanges"))}</div>`}</div>` : `<p>${escapeHtml(t("match.baseModelNote", { status: lineupStatusLabel(prediction.lineupStatus) }))}</p>`}</section>
  <section class="panel"><div class="section-head"><div><p class="kicker">${escapeHtml(t("match.marketsKicker"))}</p><h2>${escapeHtml(t("match.marketsTitle"))}</h2></div></div><div class="market-grid">${markets.map(market => { const odds = Number(fixture.odds?.[market] || 0); const currentEdge = edge(prediction.markets[market], odds); return `<article class="market-card"><span>${escapeHtml(marketLabel(market))}</span><strong>${pct(prediction.markets[market])}</strong><div class="market-meta"><span>${escapeHtml(t("match.fairOdds"))}</span><b>${num(fairOdds(prediction.markets[market]))}</b><span>${escapeHtml(t("match.marketOdds"))}</span><b>${odds > 1 ? num(odds) : "–"}</b><span>${escapeHtml(t("match.edge"))}</span><b class="${(currentEdge ?? 0) >= 0 ? "edge-positive" : "edge-negative"}">${currentEdge === null ? "–" : `${num(currentEdge, 1)} %`}</b></div><div class="market-actions">${slipButton(fixture.id, market)}<small>${escapeHtml(inSlip(fixture.id, market) ? t("combo.inSlip") : t("combo.add"))}</small></div></article>`; }).join("")}</div></section>
  <section class="panel"><div class="section-head"><div><p class="kicker">${escapeHtml(t("match.lineupKicker"))}</p><h2>${escapeHtml(t("match.lineupTitle"))}</h2></div></div><div class="lineup-grid">${renderLineupTeam(fixture.home, prediction.homeLineup)}${renderLineupTeam(fixture.away, prediction.awayLineup)}</div></section>
  <div class="two-col"><section class="panel"><h2>${escapeHtml(t("match.matrixTitle"))}</h2><div class="score-matrix">${topScores.map(score => `<div class="score-cell"><strong>${score.h}:${score.a}</strong><br>${pct(score.p)}</div>`).join("")}</div></section><section class="panel"><h2>${escapeHtml(t("match.sentimentTitle"))}</h2><textarea id="sentimentText" rows="5" placeholder="${escapeHtml(t("match.sentimentPlaceholder"))}"></textarea><button id="sentimentBtn" class="btn secondary">${escapeHtml(t("match.sentimentRun"))}</button><div id="sentimentOut"></div></section></div>`;
  wireSlipToggles();
  $("sentimentBtn").onclick = () => { const result = sentiment($("sentimentText").value); $("sentimentOut").innerHTML = `<p><strong>${escapeHtml(t("match.sentimentOffense"))}</strong> ${num(result.offense)}<br><strong>${escapeHtml(t("match.sentimentDefense"))}</strong> ${num(result.defenseRisk)}<br><strong>${escapeHtml(t("match.sentimentHits"))}</strong> ${escapeHtml(result.hits.join(", ") || t("match.sentimentNone"))}</p>`; };
}

function updatePlayerTeamOptions() {
  if (!$("playerTeamFilter")) return;
  const league = $("playerLeagueFilter")?.value || "all";
  const teams = [...new Set(players.filter(player => league === "all" || player.league === league).map(player => player.team))].sort();
  const current = $("playerTeamFilter").value;
  $("playerTeamFilter").innerHTML = `<option value="all">${escapeHtml(t("players.allTeams"))}</option>${teams.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`).join("")}`;
  $("playerTeamFilter").value = teams.includes(current) ? current : "all";
}

function renderPlayers() {
  if (!$("playerRows")) return;
  const league = $("playerLeagueFilter").value;
  const team = $("playerTeamFilter").value;
  const position = $("playerPositionFilter").value;
  const search = $("playerSearch").value.trim().toLowerCase();
  const sort = $("playerSort").value;
  let ranked = playerRanking(players, league, team).filter(player => position === "all" || player.position === position).filter(player => !search || player.name.toLowerCase().includes(search));
  ranked.sort((a, b) => sort === "attack" ? b.impact.attack - a.impact.attack : sort === "defense" ? b.impact.defense - a.impact.defense : sort === "minutes" ? b.minutes - a.minutes : sort === "goals" ? b.goals - a.goals : (b.impact.attack + b.impact.defense) - (a.impact.attack + a.impact.defense));
  const unavailable = ranked.filter(player => ["injured", "suspended"].includes(player.status)).length;
  const topAttack = [...ranked].sort((a, b) => b.impact.attack - a.impact.attack)[0];
  const topDefense = [...ranked].sort((a, b) => b.impact.defense - a.impact.defense)[0];
  $("playerSummary").innerHTML = [
    [t("players.cardPlayers"), ranked.length, t("players.cardUsable", { count: ranked.length - unavailable })],
    [t("players.cardOut"), unavailable, t("players.cardOutHint")],
    [t("players.cardTopAttack"), topAttack?.name || "–", topAttack ? num(topAttack.impact.attack, 3) : ""],
    [t("players.cardTopDefense"), topDefense?.name || "–", topDefense ? num(topDefense.impact.defense, 3) : ""]
  ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("");
  $("playerRows").innerHTML = ranked.slice(0, 500).map(player => `<tr><td><span class="player-name"><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.expectedStarter ? t("players.regularStarter") : t("players.squad"))}</small></span></td><td>${escapeHtml(player.team)}</td><td>${player.position}</td><td class="status-${player.status}">${escapeHtml(statusLabel(player.status))}</td><td>${player.minutes}</td><td>${player.goals}</td><td>${num(player.xg)}</td><td>${player.assists}</td><td>${num(player.xa)}</td><td class="impact-positive">${num(player.impact.attack, 3)}</td><td>${num(player.impact.defense, 3)}</td></tr>`).join("") || `<tr><td colspan="11">${escapeHtml(t("players.none"))}</td></tr>`;
}

function renderProfiles() {
  if (!$("profileLeagueSelect")) return;
  const league = $("profileLeagueSelect").value || leagues[0]?.code;
  const stats = leagueStats(history, league);
  const teams = profileTeams(history, league);
  const name = leagueLabel(league);
  $("leagueProfile").innerHTML = `<div class="summary-grid">${[
    [t("profiles.matches"), stats.matches, name],
    [t("profiles.goalsPerMatch"), num(stats.total), t("profiles.homeAwaySplit", { home: num(stats.homeGoals), away: num(stats.awayGoals) })],
    [marketLabel("over25"), pct(stats.over25), t("profiles.historicRate")],
    [marketLabel("bttsYes"), pct(stats.btts), t("profiles.historicRate")]
  ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("")}</div>`;
  $("teamProfiles").innerHTML = teams.map(team => `<article class="profile-card"><h3>${escapeHtml(team.team)}</h3><div class="stat-list"><span>${escapeHtml(t("profiles.matches"))}</span><span>${team.matches}</span><span>${escapeHtml(t("profiles.homeGF"))}</span><span>${num(team.homeGF)} / ${num(team.homeGA)}</span><span>${escapeHtml(t("profiles.awayGF"))}</span><span>${num(team.awayGF)} / ${num(team.awayGA)}</span><span>${escapeHtml(marketLabel("over25"))}</span><span>${pct(team.over25)}</span><span>BTTS</span><span>${pct(team.btts)}</span></div></article>`).join("") || `<p>${escapeHtml(t("profiles.empty", { league: name }))}</p>`;
}

async function runBacktest() {
  const button = $("runBacktestBtn");
  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = t("backtest.running");
  $("backtestOutput").innerHTML = `<section class="panel"><p>${escapeHtml(t("backtest.runningHint"))}</p></section>`;
  try {
    const selectedLeague = $("btLeague").value;
    const market = $("btMarket").value;
    const minEdge = Number($("btEdge").value);
    const minHistory = Number($("btMinHistory").value);
    const stake = Number($("btStake").value);
    const leaguesToTest = selectedLeague === "all" ? [...new Set(history.map(match => match.league))] : [selectedLeague];
    const bets = [];
    let processed = 0, bank = 0, peak = 0, maxDrawdown = 0;
    for (const league of leaguesToTest) {
      const rows = history.filter(match => match.league === league).sort((a, b) => a.date.localeCompare(b.date));
      const prior = [];
      const counts = new Map();
      for (const match of rows) {
        const homeKey = match.homeKey || canonicalTeam(match.home);
        const awayKey = match.awayKey || canonicalTeam(match.away);
        const enoughHistory = (counts.get(homeKey) || 0) >= minHistory && (counts.get(awayKey) || 0) >= minHistory;
        if (enoughHistory) {
          const prediction = predictFixture(match, prior, match.date);
          const probability = prediction.markets[market];
          const odds = Number(match.odds?.[market] || 0);
          const currentEdge = edge(probability, odds);
          if (odds > 1 && currentEdge !== null && currentEdge >= minEdge) {
            const goals = Number(match.homeGoals) + Number(match.awayGoals);
            const won = market === "over25" ? goals >= 3 : market === "under25" ? goals <= 2 : market === "bttsYes" ? match.homeGoals > 0 && match.awayGoals > 0 : match.homeGoals === 0 || match.awayGoals === 0;
            const profit = won ? stake * (odds - 1) : -stake;
            bank += profit; peak = Math.max(peak, bank); maxDrawdown = Math.max(maxDrawdown, peak - bank);
            bets.push({ ...match, won, profit });
          }
        }
        prior.push(match);
        counts.set(homeKey, (counts.get(homeKey) || 0) + 1);
        counts.set(awayKey, (counts.get(awayKey) || 0) + 1);
        processed++;
        if (processed % 75 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    const wins = bets.filter(item => item.won).length;
    const totalStake = bets.length * stake;
    const profit = bets.reduce((sum, item) => sum + item.profit, 0);
    const roi = totalStake ? profit / totalStake * 100 : 0;
    const byLeague = Object.entries(bets.reduce((acc, bet) => { acc[bet.league] ??= { n: 0, p: 0, w: 0 }; acc[bet.league].n++; acc[bet.league].p += bet.profit; acc[bet.league].w += bet.won ? 1 : 0; return acc; }, {})).sort((a, b) => b[1].p - a[1].p);
    $("backtestOutput").innerHTML = `<div class="summary-grid">${[
      [t("backtest.bets"), bets.length, t("backtest.walkForward")],
      [t("backtest.hitRate"), bets.length ? `${num(wins / bets.length * 100, 1)} %` : "–", t("backtest.won", { count: wins })],
      [t("backtest.profit"), money(profit), t("backtest.roi", { value: num(roi, 1) })],
      [t("backtest.drawdown"), money(maxDrawdown), t("backtest.simulated")]
    ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("")}</div><section class="panel"><p class="muted">${escapeHtml(t("backtest.lineupNote"))}</p><h2>${escapeHtml(t("backtest.byLeague"))}</h2><div class="table-wrap"><table><thead><tr><th>${escapeHtml(t("backtest.thLeague"))}</th><th>${escapeHtml(t("backtest.thBets"))}</th><th>${escapeHtml(t("backtest.thHits"))}</th><th>${escapeHtml(t("backtest.thProfit"))}</th></tr></thead><tbody>${byLeague.map(([code, stats]) => `<tr><td>${escapeHtml(leagueLabel(code))}</td><td>${stats.n}</td><td>${num(stats.w / stats.n * 100, 1)} %</td><td class="${stats.p >= 0 ? "edge-positive" : "edge-negative"}">${money(stats.p)}</td></tr>`).join("") || `<tr><td colspan="4">${escapeHtml(t("backtest.noBets"))}</td></tr>`}</tbody></table></div></section>`;
  } catch (error) {
    $("backtestOutput").innerHTML = `<section class="panel warning-box"><strong>${escapeHtml(t("backtest.failed"))}</strong> ${escapeHtml(error.message)}</section>`;
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

const betMarketLabel = (value, bet) => value === "combo" ? (bet?.legs > 1 ? t("bets.comboLegs", { count: bet.legs }) : t("market.combo")) : markets.includes(value) ? marketLabel(value) : value;
const betStatusLabel = status => ["open", "won", "lost", "void"].includes(status) ? t(`betStatus.${status}`) : status;

function renderBets() {
  if (!$("betRows")) return;
  const bets = store.bets();
  const profit = bets.reduce((sum, bet) => sum + (bet.status === "won" ? bet.stake * (bet.odds - 1) : bet.status === "lost" ? -bet.stake : 0), 0);
  const settled = bets.filter(bet => ["won", "lost"].includes(bet.status));
  const wins = settled.filter(bet => bet.status === "won").length;
  const staked = settled.reduce((sum, bet) => sum + bet.stake, 0);
  $("bankrollCards").innerHTML = [
    [t("bets.cardBets"), bets.length, t("bets.cardBetsHint")],
    [t("bets.cardProfit"), money(profit), t("bets.cardProfitHint")],
    [t("bets.cardHitRate"), settled.length ? `${num(wins / settled.length * 100, 1)} %` : "–", t("bets.cardSettled", { count: settled.length })],
    [t("bets.cardYield"), staked ? `${num(profit / staked * 100, 1)} %` : "–", t("bets.cardStaked", { value: money(staked) })]
  ].map(item => `<article class="summary-card"><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></article>`).join("");
  $("betRows").innerHTML = bets.map(bet => { const itemProfit = bet.status === "won" ? bet.stake * (bet.odds - 1) : bet.status === "lost" ? -bet.stake : 0; return `<tr><td>${escapeHtml(bet.date)}</td><td>${escapeHtml(bet.match)}</td><td>${escapeHtml(betMarketLabel(bet.market, bet))}</td><td>${num(bet.odds)}</td><td>${money(bet.stake)}</td><td>${escapeHtml(betStatusLabel(bet.status))}</td><td class="${itemProfit >= 0 ? "edge-positive" : "edge-negative"}">${money(itemProfit)}</td><td><button class="btn danger del-bet" data-id="${escapeHtml(bet.id)}">×</button></td></tr>`; }).join("") || `<tr><td colspan="8">${escapeHtml(t("bets.empty"))}</td></tr>`;
  document.querySelectorAll(".del-bet").forEach(button => button.onclick = () => { const result = store.setBets(bets.filter(bet => bet.id !== button.dataset.id)); if (!result.ok) showToast(storageError(result), "error"); renderBets(); });
}

function dedupe(items, keyFn) {
  return [...new Map(items.map(item => [keyFn(item), item])).values()];
}

async function loadDemo(kind) {
  const config = {
    history: ["./data/demo-history.csv", async path => normalizeHistory(parseCSV(await fetchText(path)))],
    fixtures: ["./data/demo-fixtures.json", async path => normalizeFixtures(await fetchJSON(path))],
    players: ["./data/demo-players.json", async path => normalizePlayers(await fetchJSON(path))],
    lineups: ["./data/demo-lineups.json", async path => normalizeLineups(await fetchJSON(path))]
  }[kind];
  const value = await config[1](config[0]);
  if (kind === "history") history = value;
  if (kind === "fixtures") fixtures = value;
  if (kind === "players") players = value;
  if (kind === "lineups") lineups = value;
  persist(kind, value); saveSource(kind, "demo"); compute();
  showToast(t("toast.demoLoaded", { count: value.length }), "success");
}

async function loadReal(kind) {
  const config = {
    history: ["./data/real-history.csv", async path => normalizeHistory(parseCSV(await fetchText(path)))],
    fixtures: ["./data/real-fixtures.json", async path => normalizeFixtures(await fetchJSON(path))],
    players: ["./data/real-players.json", async path => normalizePlayers(await fetchJSON(path))],
    lineups: ["./data/real-lineups.json", async path => normalizeLineups(await fetchJSON(path))]
  }[kind];
  const value = await config[1](config[0]);
  if (kind === "history") history = value;
  if (kind === "fixtures") fixtures = value;
  if (kind === "players") players = value;
  if (kind === "lineups") lineups = value;
  persist(kind, value); saveSource(kind, "real"); compute(); renderPlayers(); runDiagnostics();
  showToast(t("toast.realLoaded", { count: value.length, kind: t(`kind.${kind}`) }), "success");
}

async function loadAllRealData() {
  try {
    showToast(t("toast.loadingRealData"), "info", 4000);
    const [hText, fData, pData, lData] = await Promise.all([
      fetchText("./data/real-history.csv"),
      fetchJSON("./data/real-fixtures.json"),
      fetchJSON("./data/real-players.json"),
      fetchJSON("./data/real-lineups.json")
    ]);
    history = normalizeHistory(parseCSV(hText));
    fixtures = normalizeFixtures(fData);
    players = normalizePlayers(pData);
    lineups = normalizeLineups(lData);
    persist("history", history); saveSource("history", "real");
    persist("fixtures", fixtures); saveSource("fixtures", "real");
    persist("players", players); saveSource("players", "real");
    persist("lineups", lineups); saveSource("lineups", "real");
    compute(); renderPlayers(); runDiagnostics();
    showToast(t("toast.allRealLoaded", { matches: history.length, fixtures: fixtures.length, players: players.length }), "success", 8000);
  } catch (error) {
    console.error(error);
    showToast(t("toast.error", { message: error.message }), "error", 9000);
  }
}

async function readFiles(fileList, mode) {
  const files = [...fileList];
  const output = [];
  for (const file of files) {
    const text = await file.text();
    if (mode === "lineups") output.push(...normalizeLineups(JSON.parse(text)));
    else if (mode === "players") output.push(...normalizePlayers(file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCSV(text)));
    else if (mode === "fixtures") output.push(...normalizeFixtures(file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseCSV(text)));
    else output.push(...normalizeHistory(parseCSV(text)));
  }
  return output;
}

async function importFiles(fileList, kind) {
  try {
    let values = await readFiles(fileList, kind);
    if (!values.length) throw new Error(t("toast.noValidRecords"));
    if (kind === "history") values = dedupe(values, item => item.id || `${item.league}-${item.date}-${item.homeKey}-${item.awayKey}`);
    if (kind === "fixtures") values = dedupe(values, item => item.id);
    if (kind === "players") values = dedupe(values, item => item.id);
    if (kind === "lineups") values = dedupe(values, item => item.fixtureId);
    persist(kind, values);
    saveSource(kind, [...fileList].map(file => file.name).join(", "));
    if (kind === "history") history = values;
    if (kind === "fixtures") fixtures = values;
    if (kind === "players") players = values;
    if (kind === "lineups") lineups = values;
    compute(); renderPlayers();
    const report = kind === "history" || kind === "fixtures" ? importReport(values, supportedLeagueCodes()) : null;
    const warning = report?.unknown.length ? t("toast.unknownLeagues", { codes: report.unknown.join(", ") }) : "";
    showToast(`${t("toast.imported", { count: values.length, kind: t(`kind.${kind}`) })}${warning}`, report?.unknown.length ? "warning" : "success", 8000);
    runDiagnostics();
  } catch (error) {
    console.error(error);
    showToast(t("toast.importFailed", { message: error.message }), "error", 9000);
  }
}

function runDiagnostics() {
  if (!$("diagnosticOutput")) return;
  const supported = new Set(supportedLeagueCodes());
  const historyLeagues = [...new Set(history.map(item => item.league))];
  const fixtureLeagues = [...new Set(fixtures.map(item => item.league))];
  const unknown = [...new Set([...historyLeagues, ...fixtureLeagues].filter(code => !supported.has(code)))];
  const fixturesWithHistory = fixtures.filter(fixture => history.some(match => match.league === fixture.league && [fixture.homeKey, fixture.awayKey].every(key => history.some(item => item.league === fixture.league && (item.homeKey === key || item.awayKey === key))))).length;
  const fixturesWithOdds = fixtures.filter(fixture => Object.values(fixture.odds || {}).some(value => Number(value) > 1)).length;
  const fixturesWithPlayers = fixtures.filter(fixture => [fixture.home, fixture.away].every(team => players.some(player => player.league === fixture.league && player.teamKey === canonicalTeam(team)))).length;
  const matchingLineups = lineups.filter(lineup => fixtures.some(fixture => String(fixture.id) === String(lineup.fixtureId))).length;
  const checks = [
    [t("diagnostics.history"), history.length, history.length ? "ok" : "error"],
    [t("diagnostics.fixtures"), fixtures.length, fixtures.length ? "ok" : "error"],
    [t("diagnostics.fixturesWithHistory"), `${fixturesWithHistory}/${fixtures.length}`, fixturesWithHistory === fixtures.length && fixtures.length ? "ok" : "warning"],
    [t("diagnostics.fixturesWithOdds"), `${fixturesWithOdds}/${fixtures.length}`, fixturesWithOdds === fixtures.length && fixtures.length ? "ok" : "warning"],
    [t("diagnostics.fixturesWithPlayers"), `${fixturesWithPlayers}/${fixtures.length}`, fixturesWithPlayers === fixtures.length && fixtures.length ? "ok" : "warning"],
    [t("diagnostics.matchingLineups"), `${matchingLineups}/${lineups.length}`, matchingLineups === lineups.length && lineups.length ? "ok" : "warning"],
    [t("diagnostics.unknownLeagues"), unknown.length ? unknown.join(", ") : t("diagnostics.none"), unknown.length ? "error" : "ok"]
  ];
  $("diagnosticOutput").innerHTML = checks.map(([label, value, state]) => `<div class="diagnostic-item ${state}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function fillLeagueSelects() {
  const items = localizedLeagues();
  setOptions($("leagueFilter"), items, t("scanner.allLeagues"));
  setOptions($("profileLeagueSelect"), items);
  setOptions($("btLeague"), items, t("backtest.allLeagues"));
  setOptions($("playerLeagueFilter"), items, t("players.allLeagues"));
}

function refreshLanguage() {
  applyTranslations();
  fillLeagueSelects();
  updatePlayerTeamOptions();
  networkBadge();
  compute();
  renderSlip();
  renderPlayers();
  renderProfiles();
  renderBets();
  runDiagnostics();
}

function networkBadge() {
  if (!$("onlineBadge")) return;
  $("onlineBadge").textContent = navigator.onLine ? t("app.online") : t("app.offline");
  $("onlineBadge").classList.toggle("offline", !navigator.onLine);
}

function wireEvents() {
  document.querySelectorAll("[data-nav]").forEach(button => button.onclick = event => { event.preventDefault(); navigate(button.dataset.nav); });
  ["leagueFilter", "marketFilter", "edgeFilter", "qualityFilter", "sortFilter"].forEach(id => $(id).onchange = renderScanner);
  ["playerPositionFilter", "playerSort"].forEach(id => $(id).onchange = renderPlayers);
  $("playerSearch").oninput = renderPlayers;
  $("playerLeagueFilter").onchange = () => { updatePlayerTeamOptions(); renderPlayers(); };
  $("playerTeamFilter").onchange = renderPlayers;
  $("languageSelect").innerHTML = LANGUAGES.map(item => `<option value="${item.code}">${escapeHtml(item.label)}</option>`).join("");
  $("languageSelect").value = language();
  $("languageSelect").onchange = event => setLanguage(event.target.value);
  $("refreshScannerBtn").onclick = compute;
  $("slipStake").oninput = renderSlip;
  $("clearSlipBtn").onclick = () => { slip = []; persistSlip(); renderSlip(); renderScanner(); if ($("fixtureSelect")?.value) renderMatch($("fixtureSelect").value); };
  $("slipToJournalBtn").onclick = () => {
    const legs = slipLegs();
    const analysis = comboAnalysis(legs);
    if (!analysis.combinedOdds) return;
    pendingComboLegs = analysis.count;
    navigate("bets");
    const form = $("betForm");
    form.reset();
    const field = name => form.elements.namedItem(name);
    field("date").value = new Date().toISOString().slice(0, 10);
    field("match").value = legs.map(legLabel).join(" + ");
    field("market").value = "combo";
    field("odds").value = analysis.combinedOdds.toFixed(2);
    field("stake").value = Number($("slipStake").value || 10).toFixed(2);
    $("betDialog").showModal();
  };
  $("fixtureSelect").onchange = event => renderMatch(event.target.value);
  $("profileLeagueSelect").onchange = renderProfiles;
  $("runBacktestBtn").onclick = runBacktest;
  const handleReal = kind => loadReal(kind).catch(error => showToast(error.message, "error"));
  const handleAllReal = () => loadAllRealData().catch(error => showToast(error.message, "error"));

  if ($("loadRealDataTopBtn")) $("loadRealDataTopBtn").onclick = handleAllReal;
  if ($("loadRealDataHeroBtn")) $("loadRealDataHeroBtn").onclick = handleAllReal;
  if ($("loadAllRealBtn")) $("loadAllRealBtn").onclick = handleAllReal;
  if ($("loadRealHistoryBtn")) $("loadRealHistoryBtn").onclick = () => handleReal("history");
  if ($("loadRealHistoryBtnCard")) $("loadRealHistoryBtnCard").onclick = () => handleReal("history");
  if ($("loadRealFixturesBtn")) $("loadRealFixturesBtn").onclick = () => handleReal("fixtures");
  if ($("loadRealFixturesBtnCard")) $("loadRealFixturesBtnCard").onclick = () => handleReal("fixtures");
  if ($("loadRealPlayersBtn")) $("loadRealPlayersBtn").onclick = () => handleReal("players");
  if ($("loadRealPlayersBtnCard")) $("loadRealPlayersBtnCard").onclick = () => handleReal("players");
  if ($("loadRealLineupsBtn")) $("loadRealLineupsBtn").onclick = () => handleReal("lineups");
  if ($("loadRealLineupsBtnCard")) $("loadRealLineupsBtnCard").onclick = () => handleReal("lineups");

  $("loadDemoHistoryBtn").onclick = () => loadDemo("history").catch(error => showToast(error.message, "error"));
  $("loadDemoFixturesBtn").onclick = () => loadDemo("fixtures").catch(error => showToast(error.message, "error"));
  $("loadDemoPlayersBtn").onclick = () => loadDemo("players").catch(error => showToast(error.message, "error"));
  $("loadDemoLineupsBtn").onclick = () => loadDemo("lineups").catch(error => showToast(error.message, "error"));
  $("historyFile").onchange = event => event.target.files.length && importFiles(event.target.files, "history");
  $("fixturesFile").onchange = event => event.target.files.length && importFiles(event.target.files, "fixtures");
  $("playersFile").onchange = event => event.target.files.length && importFiles(event.target.files, "players");
  $("lineupsFile").onchange = event => event.target.files.length && importFiles(event.target.files, "lineups");
  $("clearHistoryBtn").onclick = () => { history = []; store.clearHistory(); saveSource("history", "none"); compute(); };
  $("clearFixturesBtn").onclick = () => { fixtures = []; store.clearFixtures(); saveSource("fixtures", "none"); compute(); };
  $("clearPlayersBtn").onclick = () => { players = []; store.clearPlayers(); saveSource("players", "none"); compute(); renderPlayers(); };
  $("clearLineupsBtn").onclick = () => { lineups = []; store.clearLineups(); saveSource("lineups", "none"); compute(); };
  $("exportScannerBtn").onclick = () => download("rajudhara-football-predictor-scanner.csv", toCSV(analyses.map(item => ({ date: item.fixture.date, league: item.fixture.league, leagueName: leagueLabel(item.fixture.league, item.fixture.leagueName), home: item.fixture.home, away: item.fixture.away, lineupStatus: lineupStatusLabel(item.prediction.lineupStatus), baseLambdaHome: item.prediction.baseLambdaHome ?? item.prediction.lambdaHome, finalLambdaHome: item.prediction.lambdaHome, baseLambdaAway: item.prediction.baseLambdaAway ?? item.prediction.lambdaAway, finalLambdaAway: item.prediction.lambdaAway, market: marketLabel(item.market), probability: item.probability, fairOdds: fairOdds(item.probability), marketOdds: item.odds, edge: item.edge, quality: item.prediction.quality }))), "text/csv");
  $("runDiagnosticsBtn").onclick = runDiagnostics;
  $("resetAppBtn").onclick = () => { if (!confirm(t("data.resetConfirm"))) return; store.clearAll(); location.reload(); };
  $("addBetBtn").onclick = () => { pendingComboLegs = 1; $("betForm").reset(); $("betForm").elements.namedItem("date").value = new Date().toISOString().slice(0, 10); $("betDialog").showModal(); };
  $("betForm").onsubmit = event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.target);
    const bets = store.bets();
    bets.unshift({ id: crypto.randomUUID?.() || `bet-${Date.now()}`, date: form.get("date"), match: form.get("match"), market: form.get("market"), odds: Number(form.get("odds")), stake: Number(form.get("stake")), status: form.get("status"), note: form.get("note"), legs: form.get("market") === "combo" ? pendingComboLegs : 1 });
    pendingComboLegs = 1;
    const result = store.setBets(bets);
    if (!result.ok) return showToast(storageError(result), "error");
    $("betDialog").close(); renderBets();
  };
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "scanner", false));
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstall = event; $("installBtn").classList.remove("hidden"); });
  $("installBtn").onclick = async () => { if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; } };
  window.addEventListener("online", networkBadge); window.addEventListener("offline", networkBadge); networkBadge();
  window.addEventListener("error", event => showToast(t("toast.error", { message: event.message }), "error", 9000));
  window.addEventListener("unhandledrejection", event => showToast(t("toast.error", { message: event.reason?.message || event.reason }), "error", 9000));
  onLanguageChange(refreshLanguage);
}

async function init() {
  try {
    applyTranslations();
    leagues = await fetchJSON("./data/leagues.json");
    fillLeagueSelects();
    wireEvents();
    history = normalizeHistory(store.history());
    fixtures = normalizeFixtures(store.fixtures());
    players = normalizePlayers(store.players());
    lineups = normalizeLineups(store.lineups());
    slip = Array.isArray(store.slip()) ? store.slip().filter(item => item && item.fixtureId && markets.includes(item.market)) : [];
    const tasks = [];
    if (!history.length) tasks.push(fetchText("./data/demo-history.csv").then(text => { history = normalizeHistory(parseCSV(text)); persist("history", history); saveSource("history", "demo"); }));
    if (!fixtures.length) tasks.push(fetchJSON("./data/demo-fixtures.json").then(data => { fixtures = normalizeFixtures(data); persist("fixtures", fixtures); saveSource("fixtures", "demo"); }));
    if (!players.length) tasks.push(fetchJSON("./data/demo-players.json").then(data => { players = normalizePlayers(data); persist("players", players); saveSource("players", "demo"); }));
    if (!lineups.length) tasks.push(fetchJSON("./data/demo-lineups.json").then(data => { lineups = normalizeLineups(data); persist("lineups", lineups); saveSource("lineups", "demo"); }));
    await Promise.all(tasks);
    compute(); renderPlayers(); runDiagnostics();
    navigate(location.hash.slice(1) || "scanner", false);
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register("./sw.js");
      registration.update().catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => showToast(t("toast.updated"), "success", 7000));
    }
  } catch (error) {
    console.error(error);
    showToast(t("toast.startFailed", { message: error.message }), "error", 12000);
    if ($("scannerRows")) $("scannerRows").innerHTML = `<tr><td colspan="9">${escapeHtml(t("toast.startFailed", { message: error.message }))}</td></tr>`;
  }
}

init();
