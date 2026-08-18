# Architektur für automatische Instagram-Stories

## Zielbild

Für freigegebene Spiele entstehen drei Story-Jobs:

1. **Spielankündigung:** 24 Stunden vor Anpfiff.
2. **Aufstellung:** 30 Minuten vor Anpfiff, aber nur nach manueller Freigabe.
3. **Ergebnis:** ab 120 Minuten nach Anpfiff, sobald ein plausibles Endergebnis vorliegt.

Spielunabhängige Stories liegen getrennt in `social_independent_stories`. Sie enthalten Kategorie, Zielgruppe, Termin, Titel, Aktivität, Motivation und ein hochgeladenes Bild. Einmalige Posting-Zeitpunkte und wöchentliche Regeln erzeugen Vorkommen in `social_independent_story_jobs`. Nach einer erfolgreich erzeugten wöchentlichen Story plant der Worker den nächsten lokalen Termin in `Europe/Berlin`, einschließlich Sommer-/Winterzeitwechsel.

Die Spiel-ID aus einer fussball.de-URL ist der stabile externe Bezeichner. Für das Beispiel ist das `0316BRN2AC000000VS5489BTVU7GTVLE`.

## Komponenten

```text
tracked game / admin input
          │
          ▼
  source adapter (fussball.de)
          │ normalisierte Spieldaten
          ▼
   Supabase social_games
          │ erzeugt fällige Jobs
          ▼
 Supabase Cron → Edge Function
          │
          ├─ Testmodus → Vorschau erzeugen und zur Freigabe ablegen
          │
          └─ Produktiv → JPEG rendern → Instagram Graph API → Status speichern
```

Das separate Supabase-Projekt `maejihwjzxkmthjavgnx` ist eingerichtet. Dadurch bleiben Datenbankmigrationen, Storage, Secrets und Cron-Jobs unabhängig von der Vereinswebsite.

## Datenquelle fussball.de

Der Zugriff liegt hinter einem eigenen Adapter. Das ist wichtig, weil die öffentlich sichtbare Website keine zugesagte allgemeine Spiel-API darstellt und HTML-Strukturen geändert werden können.

Die Edge Function `fussball-de-sync` liest stündlich die Team-Matches-Widgets aus, die auf den vier aktiven Mannschaftsseiten der BSV-Webseite eingebettet sind. Die Widget- und Team-IDs liegen an `social_teams`; Spiele werden anhand der stabilen FUSSBALL.DE-Spiel-ID eingefügt oder aktualisiert. Ein wiederholter Abruf erzeugt deshalb keine Duplikate. Bereits manuell auf `finished`, `cancelled` oder `aborted` gesetzte Spiele werden durch einen späteren Abruf nicht wieder auf `scheduled` zurückgesetzt.

Regeln:

- Original-URL und externe Spiel-ID speichern.
- Empfangene Werte validieren und Zeitstempel mit `Europe/Berlin` normalisieren.
- Vorhandene manuelle Werte niemals still durch leere Scraping-Werte überschreiben.
- Bei nicht plausiblen Daten einen Prüfstatus setzen, nicht veröffentlichen.
- Abrufe drosseln und die Nutzungsbedingungen der Quelle prüfen.

Die Aufstellung wird nicht automatisch aus fussball.de übernommen. Sie wird durch eine berechtigte Person gepflegt und bestätigt.

## Jobzustände

`pending → rendering → preview_ready → published`

Zusätzliche Zustände:

- `needs_input`: Pflichtdaten oder Freigabe fehlen.
- `failed`: technischer Fehler; Fehlertext und Versuchszahl werden gespeichert.
- `skipped`: bewusst nicht veröffentlicht.

Die Kombination aus Spiel und Storytyp ist eindeutig. Dadurch kann derselbe Job bei wiederholten Cron-Aufrufen nicht doppelt entstehen.

## Zentraler Testmodus

`INSTAGRAM_TEST_MODE` gilt für alle Storytypen und ist standardmäßig aktiv. Nur `INSTAGRAM_TEST_MODE=false` erlaubt den späteren Publisher-Pfad.

Im Testmodus:

- werden Daten gelesen und validiert,
- werden Storys gerendert,
- werden Vorschauen gespeichert,
- wird niemals die Meta Publishing API aufgerufen.

Zusätzlich sollte vor dem ersten echten Einsatz ein separater Instagram Professional Test Account verwendet werden.

## Supabase

Die vorbereitete Migration aktiviert RLS auf allen Tabellen. `anon` und `authenticated` erhalten keinen Zugriff. Der Worker wird service-to-service mit einem Secret Key aufgerufen. Nach aktuellem Supabase-Modell wird dafür bei der Edge Function `verify_jwt = false` gesetzt und die Secret-Key-Authentifizierung in `@supabase/server` verwendet.

Bei neuen Supabase-Projekten kann die Data API zunächst deaktiviert sein. Da der Worker über den Supabase-Client auf `public.social_games` und `public.social_story_jobs` zugreift, muss im Dashboard die Data API für das Schema `public` aktiviert werden. RLS, entzogene Rollenrechte und der Secret Key schützen die Tabellen weiterhin; Browser-Clients erhalten keinen Zugriff.

Der aktive Cron-Job `bsv-social-worker` ruft den Worker alle fünf Minuten per HTTP auf. `bsv-fussball-de-match-sync` startet den Spielabgleich stündlich zur Minute 23. Ein eigenes zufälliges Cron-Geheimnis liegt verschlüsselt in Supabase Vault und zusätzlich als Edge Secret vor. Die Migration enthält nur den Namen des Vault-Eintrags, nie den Geheimniswert. Direkte Aufrufe ohne dieses Geheimnis werden abgewiesen.

Die Admin-Oberfläche läuft owner-only unter <https://bsv-story-automatik.jerome-ernsberger.chatgpt.site>. Sie verwendet ausschließlich den öffentlichen Publishable Key im Browser. Schreib- und Lesezugriffe laufen über die JWT-geschützte Edge Function `social-media-admin-api`, die zusätzlich die Mitgliedschaft in `social_admins` prüft.

### Aufstellung und Torschützen aus Bildern

Aufstellung und Torschützen können weiterhin direkt als Text eingegeben oder alternativ aus einem PNG-, JPG- oder WebP-Bild gelesen werden. Das Admin-Frontend verkleinert das Bild und wertet es anschließend mit Tesseract.js vollständig lokal im Browser aus. Das Bild wird weder an die Admin-API gesendet noch im Storage oder in der Datenbank gespeichert. Nur das deutsche Sprachmodell und die WebAssembly-Laufzeit werden beim ersten Einsatz versionsgebunden von jsDelivr geladen und danach vom Browser zwischengespeichert.

Der erkannte Text wird in das bereits bestehende Format normalisiert und als bearbeitbarer Entwurf in das jeweilige Eingabefeld übernommen. Erst ein anschließendes Speichern beziehungsweise Freigeben aktualisiert das Spiel und erzeugt Bilder. Für die lokale Texterkennung wird kein API-Schlüssel benötigt und es entstehen keine nutzungsabhängigen API-Kosten.

Aktuelle Referenzen:

- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Edge Functions absichern](https://supabase.com/docs/guides/functions/auth)
- [Storage aus Edge Functions](https://supabase.com/docs/guides/functions/storage-caching)

## Instagram Publishing

Für das Publishing wird ein Instagram Professional Account benötigt. Der Produktionsadapter folgt dem Container-Prinzip der Instagram Platform: Mediencontainer mit öffentlicher JPEG-URL erstellen, Status prüfen und anschließend veröffentlichen.

Der Publisher ist in Version 0.1 absichtlich noch nicht aktiv. Zuerst müssen Meta App, Berechtigungen, Account-ID, langlebiger Token und ein öffentlich abrufbarer JPEG-Renderpfad eingerichtet und getestet werden.

Secrets:

- `INSTAGRAM_ACCOUNT_ID`
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_TEST_MODE`
- `STORY_RENDER_ENDPOINT`
- `STORY_RENDER_SECRET`
- `SOCIAL_WORKER_CRON_SECRET`

## Betrieb und Freigabe

- Cron alle fünf Minuten.
- Spielplan-Abgleich stündlich zur Minute 23.
- Höchstens ein Worker übernimmt einen Job durch bedingtes Status-Update.
- Maximal drei automatische Wiederholungen mit wachsendem Abstand.
- Jede Veröffentlichung speichert Provider-ID und Zeitpunkt.
- Manuelle Freigabe ist für Aufstellungen zwingend und für die Pilotphase bei allen Storytypen empfohlen.
- Ein globaler Kill-Switch bleibt verfügbar: `INSTAGRAM_TEST_MODE=true`.

## Ausbauphasen

### Phase 1 · Abgeschlossen

Corporate Design, SVG-Vorlagen, lokaler JPEG-Renderer, Datenmodell und sicherer Worker-Rahmen.

### Phase 2 · Abgeschlossen im Testbetrieb

Eigenes Supabase-Projekt, Admin-Eingabe, Online-Renderer, privater Storage, Cron, Freigabeoberfläche und automatischer FUSSBALL.DE-Spielplan-Abgleich für alle aktiven Mannschaften.

### Phase 3 · Meta-Testkonto

Instagram-App verbinden, Vorschau-URLs prüfen, begrenzte Testveröffentlichungen und Monitoring.

### Phase 4 · Produktiv

Einzelne Mannschaften freischalten, Fehleralarme ergänzen und erst danach weitere Teams übernehmen.
## Vereinswappen-Verzeichnis

Beim Speichern eines Spiels werden Heim- und Gastverein über normalisierte Aliase dem
Wappen-Verzeichnis `social_clubs` zugeordnet. Unbekannte Gegner werden automatisch mit
dem Status `missing` angelegt. Schreibweisen wie `TSV Aach-Linz 2`, `TSV Aach Linz II`
und `TSV Aach-Linz` können dadurch dasselbe Vereinswappen verwenden.

Originale und freigestellte PNGs liegen getrennt im privaten Storage-Bucket unter
`club-crests/<verein>/`. Die Browserroutine entfernt ausschließlich Hintergrundpixel,
die mit dem äußeren Bildrand verbunden sind. Gleichfarbige Flächen innerhalb eines
geschlossenen Wappens bleiben erhalten. Bereits vorhandene Alphakanäle werden nicht neu
berechnet.

Jede neue Freistellung erhält zunächst `needs_review`. Erst nach der Kontrolle auf dem
Schachbrett-Hintergrund und der manuellen Freigabe verwendet der Story-Renderer die
Datei. Quellenlink, Erkennungswerte und Freigabeinformationen bleiben am Vereinsdatensatz
gespeichert.
