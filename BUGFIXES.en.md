# Stabilisation test

*Deutsche Fassung: [BUGFIXES.md](BUGFIXES.md)*

Verified:

- Syntax of all JavaScript modules
- Initialisation with empty browser storage
- Demo import: 784 matches, 14 fixtures, 2,016 players and 14 lineups
- Probabilities within the 0–1 range
- Complementarity of Over/Under 2.5 and BTTS Yes/No
- Player adjustment on all demo fixtures
- Football-Data code mapping for `I1`, `SP2`, `B1`, `DNK` and `AUT`
- Fixture import via the `Div` column
- Detection of `Avg>2.5` and `Avg<2.5`
- Scanner, player, diagnostics and backtest rendering in an automated DOM smoke test
- Visible import and storage error messages

Browser-dependent install dialogs may look different depending on the browser and hosting environment.

## Bugs fixed from the repo scan

- **History odds were destroyed on every reload.** `normalizeHistory` read odds only from the CSV columns, but `init()` also re-normalises the already stored objects, whose odds live under `row.odds`. After the first reload every historical odds value was `0`, and the backtest reported "Keine Wetten erfüllten die Kriterien" without any error. `normalizeHistory` and `normalizeFixtures` now share `mergedOdds(row)`, which layers stored odds over the column-derived ones. Verified: 784 of 784 odds and 104 of 104 backtest bets survive the storage round-trip.
- **Empty columns shadowed their alternatives.** The fallback chains used `??`, but `parseCSV` emits `""` for a declared-yet-empty column, which is not nullish. A file with an empty `O25` and a populated `Avg>2.5` was therefore imported with odds `0`. All chains in `csv.js` and `player-data.js` now go through `pick()`, which selects the first non-empty value.
- **Matches without a result were imported as 0:0.** `number()` returned `0` for empty `FTHG`/`FTAG`, so the `Number.isFinite` filter could never reject anything. Postponed or not-yet-played games skewed league averages, team ratings and the Over/BTTS base rates. Goal fields now use `optionalNumber()` and return `null`; such rows are dropped.
- **Clearing data did not remove the legacy entries.** `clearHistory`, `clearFixtures`, `clearPlayers`, `clearLineups` and `clearAll` deleted only the `v3` keys, while `read()` still fell back to `rfp.*.v2` and `gl.*.v1`. Cleared data came back after a reload. `storage.js` now deletes the legacy keys as well.
- **Lineup team names decayed into the canonical key.** On a second pass `normalizeLineups` set `name` from the already canonical key, turning `Kopenhagen` into `kopenhagen`. The display name is now preserved and the function is idempotent.

Known and deliberately unchanged: the service worker serves `data/*.json` and `data/*.csv` cache-first. Updated demo data therefore only reaches an already installed app once the cache name changes.

## Accumulators

The scanner includes a bet slip. Use “+” in the results table or on the market cards in the match analysis to chain selections.

- **Combined odds** are the product of the single odds.
- The **probability** is the product of the single probabilities when the selections come from different matches.
- For several selections from the **same match** nothing is multiplied. Those markets are dependent: over 2.5 and BTTS yes tend to land together. The joint probability comes from that match's score matrix, i.e. the summed probability of every scoreline that wins all selected markets at once.
- Mutually exclusive selections such as over 2.5 and under 2.5 give 0 and an edge of −100 %.
- Fair combined odds, edge, payout and profit follow from that probability. The slip can be written to the journal as a single bet.

Example from the demo data: over 3.5 and BTTS yes in the same match come to 33.7 % jointly. Multiplying the single values gives 19.9 % and clearly understates the combination. Bookmakers usually only accept such combinations as a bet builder with its own price.
