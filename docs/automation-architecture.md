# Architektur für automatische Instagram-Stories

## Zielbild

Für freigegebene Spiele entstehen drei Story-Jobs:

1. **Spielankündigung:** 24 Stunden vor Anpfiff.
2. **Aufstellung:** 30 Minuten vor Anpfiff, aber nur nach manueller Freigabe.
3. **Ergebnis:** ab 120 Minuten nach Anpfiff, sobald ein plausibles Endergebnis vorliegt.

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

Ein separates Supabase-Projekt wird empfohlen. Dadurch bleiben Datenbankmigrationen, Storage, Secrets und Cron-Jobs unabhängig von der Website.

## Datenquelle fussball.de

Der Zugriff liegt hinter einem eigenen Adapter. Das ist wichtig, weil die öffentlich sichtbare Website keine zugesagte allgemeine Spiel-API darstellt und HTML-Strukturen geändert werden können.

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

Der Cron-Job wird nach dem Deployment im Supabase Dashboard unter **Integrations → Cron** angelegt und ruft den Worker alle fünf Minuten per HTTP auf. Das Secret wird nicht in eine Migration geschrieben.

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

## Betrieb und Freigabe

- Cron alle fünf Minuten.
- Höchstens ein Worker übernimmt einen Job durch bedingtes Status-Update.
- Maximal drei automatische Wiederholungen mit wachsendem Abstand.
- Jede Veröffentlichung speichert Provider-ID und Zeitpunkt.
- Manuelle Freigabe ist für Aufstellungen zwingend und für die Pilotphase bei allen Storytypen empfohlen.
- Ein globaler Kill-Switch bleibt verfügbar: `INSTAGRAM_TEST_MODE=true`.

## Ausbauphasen

### Phase 1 · Jetzt

Corporate Design, SVG-Vorlagen, lokaler JPEG-Renderer, Datenmodell und sicherer Worker-Rahmen.

### Phase 2 · Daten und Vorschau

Eigenes Supabase-Projekt, Admin-Eingabe, fussball.de-Adapter, Storage und Freigabeoberfläche.

### Phase 3 · Meta-Testkonto

Instagram-App verbinden, Vorschau-URLs prüfen, begrenzte Testveröffentlichungen und Monitoring.

### Phase 4 · Produktiv

Einzelne Mannschaften freischalten, Fehleralarme ergänzen und erst danach weitere Teams übernehmen.
