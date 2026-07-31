# Rajudhara Football Predictor – stabilisierte Version 3

Installierbare local-first PWA für Over/Under, Goal/No Goal, Spielerstatistiken und aufstellungsbereinigte Fußballprognosen.

## Behobene Hauptprobleme

- Ligacodes aus Football-Data.co.uk werden normalisiert, darunter `I1 → IT1`, `I2 → IT2`, `SP1 → ES1`, `SP2 → ES2`, `B1 → BE1`, `DNK → DK1` und `AUT → AT1`.
- Fixtures erkennen nun auch die Spalte `Div` und die Quotenfelder `Avg>2.5`, `Avg<2.5`, `B365>2.5` und `B365<2.5`.
- Teamnamen werden für die Zuordnung vereinheitlicht.
- Spieler werden nach Liga **und** Team zugeordnet; gleichnamige Teams aus anderen Wettbewerben laufen nicht mehr zusammen.
- Aufstellungen werden über kanonische Teamnamen und Fixture-IDs verknüpft.
- Importfehler, unbekannte Ligacodes und voller Browserspeicher werden sichtbar gemeldet.
- Mehrere CSV-Dateien können gemeinsam importiert werden.
- Der Backtest blockiert die Oberfläche bei größeren Dateien deutlich weniger.
- Der Service Worker lädt Programmdateien bevorzugt aus dem Netzwerk und löscht alte App-Caches.
- Ein Diagnosebereich prüft Historie, Quoten, Spieler- und Aufstellungszuordnung.
- Ein vollständiger Reset ist über `reset.html` möglich.

## Sprache / Language

Die Oberfläche ist zweisprachig. Die Umschaltung Deutsch/English liegt oben rechts in der Kopfzeile, die Auswahl wird lokal gespeichert. Ohne gespeicherte Auswahl entscheidet die Browsersprache. Zahlen, Prozentwerte und Beträge folgen der gewählten Sprache (`1,90` und `10,00 €` gegenüber `1.90` und `€10.00`), Ligennamen ebenfalls (`Österreich · 2. Liga` gegenüber `Austria · 2. Liga`). Übersetzungen stehen in `i18n.js`.

The interface is bilingual. The German/English switch sits in the top right of the header and the choice is stored locally; without a stored choice the browser language decides. Numbers, percentages, amounts and league names follow the selected language. Translations live in `i18n.js`.

## Kombiwetten

Der Scanner enthält einen Wettschein. Über „+“ in der Trefferliste oder auf den Marktkarten der Spielanalyse werden Auswahlen verkettet.

- Die **Kombiquote** ist das Produkt der Einzelquoten.
- Die **Wahrscheinlichkeit** ist bei Auswahlen aus verschiedenen Spielen das Produkt der Einzelwahrscheinlichkeiten.
- Bei mehreren Auswahlen aus **demselben Spiel** wird nicht multipliziert. Diese Märkte sind abhängig: Over 2,5 und BTTS Ja treffen häufig gemeinsam ein. Die gemeinsame Wahrscheinlichkeit stammt aus der Score-Matrix des Spiels, also aus der Summe aller Ergebnisse, die alle gewählten Märkte gleichzeitig gewinnen.
- Sich ausschließende Auswahlen wie Over 2,5 und Under 2,5 ergeben 0 und einen Edge von −100 %.
- Faire Kombiquote, Edge, Auszahlung und Gewinn folgen aus dieser Wahrscheinlichkeit. Der Wettschein lässt sich als eine Wette ins Journal übernehmen.

Beispiel aus den Demo-Daten: Over 3,5 und BTTS Ja im selben Spiel ergeben gemeinsam 33,7 %. Multipliziert man die Einzelwerte, kommt man auf 19,9 % und unterschätzt die Kombination deutlich. Buchmacher lassen solche Kombinationen meist nur als Bet-Builder mit eigener Quote zu.

## Enthalten

- 14 Zielwettbewerbe: erste und zweite Liga in Dänemark, Belgien, Schweden, Norwegen, Österreich, Italien und Spanien
- Over 1,5; Over/Under 2,5; Over 3,5; BTTS Ja/Nein
- Poisson-Modell und Score-Matrix
- faire Quote und Edge
- Spieler- und Aufstellungsimpact
- Liga- und Teamprofile
- Walk-forward-Backtest
- Wettjournal
- CSV-/JSON-Import
- Offlinebetrieb und PWA-Installation

## Start

```bash
unzip rajudhara-football-predictor-stable.zip
cd rajudhara-football-predictor
python3 -m http.server 8080
```

Dann öffnen:

```text
http://localhost:8080
```

Nicht direkt über `file://` öffnen. JavaScript-Module und Service Worker benötigen einen Webserver.

## Falls noch eine alte Version angezeigt wird

Öffne:

```text
http://localhost:8080/reset.html
```

Klicke auf **Jetzt zurücksetzen**. Dadurch werden alte Service Worker, Caches und lokale App-Daten entfernt.

## Historische CSV

Unterstützte Kernspalten:

```text
Date, Div oder League, HomeTeam, AwayTeam, FTHG, FTAG
```

Erkannte Quotenfelder:

```text
O25, U25, Avg>2.5, Avg<2.5, B365>2.5, B365<2.5, BTTSY, BTTSN
```

## Datenquellen und zweite Ligen

Football-Data.co.uk stellt bei Italien und Spanien die ersten und zweiten Ligen als separate Divisionscodes bereit. Bei mehreren „Extra Leagues“ deckt diese Quelle primär die erste Liga ab. Die App kann zweite Ligen trotzdem verarbeiten, sofern CSV-, JSON- oder Backend-Daten mit den internen Codes `DK2`, `BE2`, `SE2`, `NO2` und `AT2` geliefert werden.

## Demo-Daten

Die enthaltenen historischen Spiele, Spieler und Aufstellungen sind synthetisch. Sie dienen ausschließlich dem Funktionstest und sind keine reale Wettgrundlage.

## Live-Daten

API-Schlüssel gehören in einen Server-Proxy, nicht in die PWA. Die vorgesehene Schnittstelle ist in `data-adapter.example.js` beschrieben.
