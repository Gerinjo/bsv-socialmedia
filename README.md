# BSV Social Media

Eigenständiges Projekt für die Gestaltung und spätere Automatisierung von Instagram-Stories des BSV Nordstern Radolfzell.

Der aktuelle Stand liefert:

- ein aus der Website abgeleitetes Corporate Design,
- editierbare Story-Vorlagen in 1080 × 1920 Pixel,
- einen lokalen Renderer für Spielankündigung, Aufstellung und Ergebnis,
- Beispieldaten für die fussball.de-Spiel-ID `0316BRN2AC000000VS5489BTVU7GTVLE`,
- eine vorbereitete Supabase-Struktur für Spiele und Story-Jobs,
- einen zentralen, standardmäßig aktiven Testmodus.

## Vorschau

| Spielankündigung | Aufstellung | Ergebnis |
| --- | --- | --- |
| ![Spielankündigung](previews/announcement.jpg) | ![Aufstellung](previews/lineup.jpg) | ![Ergebnis](previews/result.jpg) |

Das vollständige Gestaltungssystem ist als [Corporate-Design-Dokument](docs/corporate-design.md) und als [visuelle HTML-Fassung](docs/corporate-design.html) enthalten.

## Schnellstart

Voraussetzung sind Node.js 22 oder neuer und ImageMagick (`magick`).

```bash
npm run check
npm run render:all
```

Die erzeugten Dateien landen in `output/`. Bereits freigegebene Beispiele liegen unter `previews/`.

Ein einzelnes Motiv lässt sich so erzeugen:

```bash
npm run render -- --type announcement --input examples/match.json
npm run render -- --type lineup --input examples/match.json --lineup examples/lineup.json
npm run render -- --type result --input examples/match.json
```

## Sicherheitsstandard

`INSTAGRAM_TEST_MODE` ist zentral definiert und standardmäßig aktiv. Nur der exakte Wert `false` erlaubt später einem Publisher den echten Versand. Der aktuelle Code enthält absichtlich noch keinen aktiven Meta-Publisher. Er kann also keine Story versehentlich veröffentlichen.

Secrets gehören ausschließlich in GitHub Actions Secrets oder Supabase Project Secrets und niemals in dieses Repository.

## Projektstruktur

```text
brand/                 Farben, Typografie und Vereinswappen
config/                überwachte Spiele und Zeitregeln
docs/                  Corporate Design und technische Architektur
examples/              Testdaten
previews/              freigegebene Beispiel-Renderings
scripts/               lokale Render- und Prüfskripte
src/                   gemeinsame Renderlogik
supabase/               Datenmodell und vorbereiteter Worker
templates/              editierbare SVG-Storyvorlagen
tests/                  automatisierte Tests
```

## Nächste Betriebs-Schritte

1. Eigenes privates Supabase-Projekt für Social Media anlegen.
2. Data API für das Schema `public` aktivieren, Migration anwenden und den privaten Storage-Bucket für Entwürfe prüfen.
3. Instagram Professional Account mit der Meta Graph API verbinden.
4. Einen geeigneten JPEG-Renderdienst anbinden.
5. Erst nach erfolgreichen Freigabetests `INSTAGRAM_TEST_MODE=false` setzen.

Die Details stehen in [docs/automation-architecture.md](docs/automation-architecture.md).
