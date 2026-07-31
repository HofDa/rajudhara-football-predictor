const VERSION = "v3";
const KEYS = {
  history: `rfp.history.${VERSION}`,
  fixtures: `rfp.fixtures.${VERSION}`,
  players: `rfp.players.${VERSION}`,
  lineups: `rfp.lineups.${VERSION}`,
  bets: `rfp.bets.${VERSION}`,
  slip: `rfp.slip.${VERSION}`,
  source: `rfp.source.${VERSION}`
};
const LEGACY = {
  history: ["rfp.history.v2", "gl.history.v1"],
  fixtures: ["rfp.fixtures.v2", "gl.fixtures.v1"],
  players: ["rfp.players.v2"],
  lineups: ["rfp.lineups.v2"],
  bets: ["rfp.bets.v2", "gl.bets.v1"],
  slip: [],
  source: ["rfp.source.v2", "gl.source.v1"]
};

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

function read(name, fallback = []) {
  const current = localStorage.getItem(KEYS[name]);
  if (current) return parse(current, fallback);
  for (const key of LEGACY[name] || []) {
    const legacy = localStorage.getItem(key);
    if (legacy) return parse(legacy, fallback);
  }
  return fallback;
}

function write(name, value) {
  try {
    localStorage.setItem(KEYS[name], JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    const quota = error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED";
    return { ok: false, code: quota ? "quota" : "unknown", error: String(error?.message || error) };
  }
}

function clear(name) {
  localStorage.removeItem(KEYS[name]);
  for (const key of LEGACY[name] || []) localStorage.removeItem(key);
}

export const store = {
  history: () => read("history"),
  fixtures: () => read("fixtures"),
  players: () => read("players"),
  lineups: () => read("lineups"),
  bets: () => read("bets"),
  slip: () => read("slip"),
  source: () => read("source", { history: "none", fixtures: "none", players: "none", lineups: "none" }),
  setHistory: value => write("history", value),
  setFixtures: value => write("fixtures", value),
  setPlayers: value => write("players", value),
  setLineups: value => write("lineups", value),
  setBets: value => write("bets", value),
  setSlip: value => write("slip", value),
  setSource: value => write("source", value),
  clearHistory: () => clear("history"),
  clearFixtures: () => clear("fixtures"),
  clearPlayers: () => clear("players"),
  clearLineups: () => clear("lineups"),
  clearAll: () => Object.keys(KEYS).forEach(clear)
};

export const bytes = () => new Blob(Object.values(KEYS).map(key => localStorage.getItem(key) || "")).size;
export const storageVersion = VERSION;
