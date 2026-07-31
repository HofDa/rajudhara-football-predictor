# Stabilisierungstest

*English version: [BUGFIXES.en.md](BUGFIXES.en.md)*

Geprüft wurden:

- Syntax aller JavaScript-Module
- Initialisierung mit leerem Browserspeicher
- Demo-Import: 784 Spiele, 14 Fixtures, 2.016 Spieler und 14 Aufstellungen
- Wahrscheinlichkeiten im Bereich 0–1
- Komplementarität von Over/Under 2,5 und BTTS Ja/Nein
- Spieleranpassung bei allen Demo-Fixtures
- Football-Data-Codezuordnung für `I1`, `SP2`, `B1`, `DNK` und `AUT`
- Fixture-Import über die Spalte `Div`
- Erkennung von `Avg>2.5` und `Avg<2.5`
- Scanner-, Spieler-, Diagnose- und Backtest-Rendering in einem automatisierten DOM-Smoke-Test
- sichtbare Importfehlermeldungen und Speicherfehler

Browserabhängige Installationsdialoge können je nach Browser und Hostingumgebung unterschiedlich erscheinen.

## Behobene Fehler aus dem Repo-Scan

- **Quoten der Historie gingen bei jedem Neuladen verloren.** `normalizeHistory` las Quoten nur aus den CSV-Spalten, `init()` normalisiert jedoch auch die bereits gespeicherten Objekte, deren Quoten unter `row.odds` liegen. Nach dem ersten Neuladen standen alle historischen Quoten auf `0`, und der Backtest meldete ohne Fehlermeldung „Keine Wetten erfüllten die Kriterien“. `normalizeHistory` und `normalizeFixtures` verwenden jetzt gemeinsam `mergedOdds(row)`, das gespeicherte Quoten über die spaltenbasierten legt. Geprüft: 784 von 784 Quoten und 104 von 104 Backtest-Wetten überstehen den Speicher-Roundtrip.
- **Leere Spalten überdeckten die Alternativspalten.** Die Fallback-Ketten nutzten `??`; `parseCSV` liefert für vorhandene, aber leere Spalten jedoch `""`, was nicht nullish ist. Eine Datei mit leerem `O25` und gefülltem `Avg>2.5` wurde deshalb mit Quote `0` importiert. Alle Ketten in `csv.js` und `player-data.js` laufen jetzt über `pick()`, das den ersten nicht leeren Wert wählt.
- **Spiele ohne Ergebnis wurden als 0:0 importiert.** `number()` lieferte für leere `FTHG`/`FTAG` den Wert `0`, sodass der `Number.isFinite`-Filter nie greifen konnte. Verlegte oder noch nicht gespielte Partien verzerrten Ligaschnitte, Team-Ratings und Over/BTTS-Quoten. Torfelder nutzen jetzt `optionalNumber()` und liefern `null`; solche Zeilen werden verworfen.
- **Löschen entfernte die Altdaten nicht.** `clearHistory`, `clearFixtures`, `clearPlayers`, `clearLineups` und `clearAll` löschten nur die `v3`-Schlüssel, während `read()` weiterhin auf `rfp.*.v2` und `gl.*.v1` zurückfiel. Gelöschte Daten kehrten nach dem Neuladen zurück. `storage.js` löscht jetzt zusätzlich alle Legacy-Schlüssel.
- **Teamnamen in Aufstellungen verfielen zum kanonischen Schlüssel.** `normalizeLineups` setzte `name` beim zweiten Durchlauf auf den bereits kanonischen Schlüssel, aus `Kopenhagen` wurde `kopenhagen`. Der Anzeigename bleibt jetzt erhalten, die Funktion ist idempotent.

Offen und bewusst unverändert: Der Service Worker liefert `data/*.json` und `data/*.csv` cache-first. Geänderte Demo-Daten erreichen eine bereits installierte App daher erst, wenn sich der Cache-Name ändert.
