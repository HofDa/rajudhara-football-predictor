const LEAGUE_ALIASES = new Map(Object.entries({
  DK1: "DK1", DNK: "DK1", DENMARK: "DK1", SUPERLIGA: "DK1",
  DK2: "DK2", "1STDIVISION": "DK2", "DANISH1STDIVISION": "DK2",
  BE1: "BE1", B1: "BE1", BELGIUM: "BE1", JUPILER: "BE1", PROLEAGUE: "BE1",
  BE2: "BE2", CHALLENGERPROLEAGUE: "BE2",
  SE1: "SE1", SWE: "SE1", SWEDEN: "SE1", ALLSVENSKAN: "SE1",
  SE2: "SE2", SUPERETTAN: "SE2",
  NO1: "NO1", NOR: "NO1", NORWAY: "NO1", ELITESERIEN: "NO1",
  NO2: "NO2", OBOSLIGAEN: "NO2", OBOS: "NO2",
  AT1: "AT1", AUT: "AT1", AUSTRIA: "AT1", AUSTRIANBUNDESLIGA: "AT1",
  AT2: "AT2", AUSTRIAN2LIGA: "AT2", "2LIGA": "AT2",
  IT1: "IT1", I1: "IT1", SERIEA: "IT1", ITALYSERIEA: "IT1",
  IT2: "IT2", I2: "IT2", SERIEB: "IT2", ITALYSERIEB: "IT2",
  ES1: "ES1", SP1: "ES1", LALIGA: "ES1", PRIMERADIVISION: "ES1",
  ES2: "ES2", SP2: "ES2", SEGUNDADIVISION: "ES2", LALIGA2: "ES2"
}));

const TEAM_ALIASES = new Map(Object.entries({
  "athmadrid": "atletico madrid",
  "atleticomadrid": "atletico madrid",
  "athleticomadrid": "atletico madrid",
  "realmad": "real madrid",
  "realsociedad": "real sociedad",
  "sociedad": "real sociedad",
  "intermilan": "inter",
  "internazionale": "inter",
  "acmilan": "milan",
  "fcbarcelona": "barcelona",
  "clubbrugge": "club brugge",
  "clubbruggekv": "club brugge",
  "bodoglimt": "bodo glimt",
  "bodoglimt": "bodo glimt",
  "fcstpauli": "st pauli",
  "sudtirol": "sudtirol"
}));

export function stripDiacritics(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function compactKey(value = "") {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function canonicalLeague(value = "") {
  const raw = String(value).trim();
  if (!raw) return "";
  return LEAGUE_ALIASES.get(compactKey(raw).toUpperCase()) || raw.toUpperCase();
}

export function canonicalTeam(value = "") {
  const raw = String(value).trim();
  if (!raw) return "";
  const key = compactKey(raw);
  return TEAM_ALIASES.get(key) || stripDiacritics(raw).toLowerCase().replace(/\b(fc|cf|ac|sc|afc|fk|bk|if|calcio)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizePosition(value = "CM") {
  const key = compactKey(value).toUpperCase();
  if (["GK", "GOALKEEPER", "TORWART", "PORTIERE"].includes(key)) return "GK";
  if (["CB", "CENTREBACK", "CENTERBACK", "INNENVERTEIDIGER", "DIFENSORECENTRALE"].includes(key)) return "CB";
  if (["FB", "LB", "RB", "FULLBACK", "WINGBACK", "AUSSENVERTEIDIGER"].includes(key)) return "FB";
  if (["DM", "CDM", "DEFENSIVEMIDFIELD", "SECHSER"].includes(key)) return "DM";
  if (["CM", "MIDFIELD", "CENTRALMIDFIELD", "MITTELFELD"].includes(key)) return "CM";
  if (["AM", "CAM", "ATTACKINGMIDFIELD", "OFFENSIVEMIDFIELD"].includes(key)) return "AM";
  if (["W", "LW", "RW", "WINGER", "FLUGEL"].includes(key)) return "W";
  if (["ST", "CF", "FW", "FORWARD", "STRIKER", "STURMER", "ATTACCANTE"].includes(key)) return "ST";
  return ["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"].includes(key) ? key : "CM";
}

export function safeText(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}
