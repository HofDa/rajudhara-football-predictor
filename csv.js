import { canonicalLeague, canonicalTeam, safeText } from "./normalization.js";

const pick = (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== "");

const optionalNumber = value => {
  const raw = String(value ?? "").replace(/\s/g, "").replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const number = value => optionalNumber(value) ?? 0;

export function parseCSV(text) {
  const input = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = input.split("\n").filter(line => line.trim().length);
  if (!lines.length) return [];
  const candidates = [",", ";", "\t"];
  const separator = candidates.sort((a, b) => (lines[0].split(b).length - lines[0].split(a).length))[0];

  const parseLine = line => {
    const output = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index++;
        } else quoted = !quoted;
      } else if (char === separator && !quoted) {
        output.push(current);
        current = "";
      } else current += char;
    }
    output.push(current);
    return output;
  };

  const headers = parseLine(lines[0]).map(header => header.trim());
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()]));
  });
}

export function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dateOnly = raw.split(/[ T]/)[0];
  const parts = dateOnly.split(/[\/.\-]/);
  if (parts.length === 3) {
    let [first, second, third] = parts;
    if (first.length === 4) return `${first}-${second.padStart(2, "0")}-${third.padStart(2, "0")}`;
    if (third.length === 2) third = Number(third) >= 70 ? `19${third}` : `20${third}`;
    return `${third}-${second.padStart(2, "0")}-${first.padStart(2, "0")}`;
  }
  return raw;
}

const SUPPORTED_LEAGUES = new Set(["DK1", "DK2", "BE1", "BE2", "SE1", "SE2", "NO1", "NO2", "AT1", "AT2", "IT1", "IT2", "ES1", "ES2"]);

// Football-Data's "extra leagues" files carry Country and League separately
// ("Austria" + "Bundesliga"), where neither alone is unambiguous. Try the
// combination first, then the league, then the country.
function leagueValue(row, fallback = "") {
  const league = pick(row.league, row.League, row.Div, row.division, row.Competition);
  const country = pick(row.country, row.Country);
  const candidates = [country && league ? `${country} ${league}` : null, league, country, fallback];
  const mapped = candidates.filter(Boolean).map(canonicalLeague);
  return mapped.find(code => SUPPORTED_LEAGUES.has(code)) || mapped[0] || "";
}

function oddsFromRow(row) {
  return {
    over15: number(pick(row.over15, row.O15, row["Avg>1.5"], row["B365>1.5"])),
    over25: number(pick(row.over25, row.O25, row["Avg>2.5"], row["B365>2.5"], row["Max>2.5"])),
    under25: number(pick(row.under25, row.U25, row["Avg<2.5"], row["B365<2.5"], row["Max<2.5"])),
    over35: number(pick(row.over35, row.O35, row["Avg>3.5"], row["B365>3.5"])),
    bttsYes: number(pick(row.bttsYes, row.BTTSY, row.BTTSYes, row.GG)),
    bttsNo: number(pick(row.bttsNo, row.BTTSN, row.BTTSNo, row.NG))
  };
}

function mergedOdds(row) {
  const stored = row.odds && typeof row.odds === "object" ? row.odds : {};
  const merged = { ...oddsFromRow(row) };
  for (const [market, value] of Object.entries(stored)) {
    const parsed = optionalNumber(value);
    if (parsed !== null && (parsed > 0 || !(merged[market] > 0))) merged[market] = parsed;
  }
  return merged;
}

export function normalizeHistory(rows, defaultLeague = "") {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const league = leagueValue(row, defaultLeague);
    const home = safeText(pick(row.home, row.HomeTeam, row.Home));
    const away = safeText(pick(row.away, row.AwayTeam, row.Away));
    const date = normalizeDate(pick(row.date, row.Date));
    return {
      id: safeText(row.id, `${league}-${date}-${index}`),
      date,
      time: safeText(pick(row.time, row.Time)),
      league,
      originalLeague: safeText(pick(row.League, row.Div, row.league)),
      leagueName: safeText(pick(row.leagueName, row.LeagueName, row.Competition), league),
      home,
      away,
      homeKey: canonicalTeam(home),
      awayKey: canonicalTeam(away),
      homeGoals: optionalNumber(pick(row.homeGoals, row.FTHG, row.HG)),
      awayGoals: optionalNumber(pick(row.awayGoals, row.FTAG, row.AG)),
      odds: mergedOdds(row)
    };
  }).filter(match => match.date && match.league && match.home && match.away && Number.isFinite(match.homeGoals) && Number.isFinite(match.awayGoals));
}

export function normalizeFixtures(rows, defaultLeague = "") {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const league = leagueValue(row, defaultLeague);
    const home = safeText(pick(row.home, row.HomeTeam, row.Home));
    const away = safeText(pick(row.away, row.AwayTeam, row.Away));
    const date = normalizeDate(pick(row.date, row.Date));
    return {
      id: safeText(pick(row.id, row.fixtureId, row.fixture_id), `${league}-${date}-${canonicalTeam(home)}-${canonicalTeam(away)}-${index}`),
      date,
      time: safeText(pick(row.time, row.Time)),
      league,
      originalLeague: safeText(pick(row.League, row.Div, row.league)),
      leagueName: safeText(pick(row.leagueName, row.LeagueName, row.Competition), league),
      home,
      away,
      homeKey: canonicalTeam(home),
      awayKey: canonicalTeam(away),
      odds: mergedOdds(row)
    };
  }).filter(fixture => fixture.date && fixture.league && fixture.home && fixture.away);
}

export function importReport(items, supportedLeagues = []) {
  const supported = new Set(supportedLeagues);
  const leagues = [...new Set(items.map(item => item.league).filter(Boolean))];
  const unknown = supported.size ? leagues.filter(league => !supported.has(league)) : [];
  return {
    count: items.length,
    leagues,
    unknown,
    teams: new Set(items.flatMap(item => [item.home, item.away]).filter(Boolean)).size
  };
}

export function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(","), ...rows.map(row => headers.map(header => escape(row[header])).join(","))].join("\n");
}
