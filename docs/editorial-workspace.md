# Redaktion für Stadionheft und Newsletter

Der neue Suite-Bereich **Redaktion** verwaltet Ausgaben und ihre Beiträge. Stadionhefte erhalten beim Anlegen feste Rubriken: Grußwort der Vorstandschaft, Grußwort der Jugendleitung sowie Trainerbegrüßung und Sportdaten für jede zu diesem Zeitpunkt aktive Mannschaft. Newsletter beginnen mit einem leeren Inhaltsplan. Weitere Beiträge lassen sich vereinsweit oder einer aktiven Abteilung zugeordnet anlegen.

## Arbeitsablauf

1. **Ausgabe anlegen**: Titel, Ausgabeart, Redaktionsstart, Redaktionsschluss und Erscheinungsdatum eingeben. Die Termine müssen in dieser Reihenfolge liegen; gleiche Tage sind möglich. Die Ausgabeart bleibt nach dem Anlegen unveränderlich.
2. Im Monatskalender erscheinen alle drei Termine in beschrifteten Farben. Balken kennzeichnen den Redaktionszeitraum. Ausgaben sind nach Heft und Newsletter filterbar; ein Klick öffnet den Inhaltsplan.
3. Im Inhaltsplan Beiträge öffnen, Titel, Abteilung, Verantwortliche und Text pflegen. Die Status sind **Offen**, **In Prüfung**, **Fertig**. Der Fortschritt zeigt fertige Beiträge. Termine dienen zunächst der Planung und sperren die Bearbeitung nicht automatisch.
4. **Speichern & überarbeiten** speichert die Eingabe zuerst sicher in der Datenbank. Geänderte Texte werden anschließend über die konfigurierte KI sprachlich überarbeitet und direkt übernommen. Originale und gespeicherte Fassungen bleiben unter **Original & Verlauf** abrufbar (UI: letzte 30 Versionen; Datenbank: vollständiger Verlauf). Nach einer KI-Änderung steht der Beitrag auf **In Prüfung**. Eine reine Statusänderung löst keine neue KI-Anfrage aus. **Erneut überarbeiten** startet sie ausdrücklich nochmals.
5. **Tabellen & Ergebnisse abrufen** erzeugt die Sportbeiträge für alle Mannschaften des Hefts. Bereits vorhandene Texte werden erst nach Hinweis auf die Ersetzung neu erzeugt und bleiben im Verlauf. Sportdaten durchlaufen keine KI.
6. **Texte exportieren** lädt eine Textdatei mit allen Beiträgen und ihrem Bearbeitungsstatus herunter, auch noch offene Entwürfe.

## Sportdaten

Die Mannschaftsseite wird unter `https://bsvnordstern.de/` aus dem bestehenden `website_path` geladen. Ihre offizielle FUSSBALL.DE-Tabellenkennung wird ausgelesen. Die verschleierten Zeichen des Widgets werden mit dessen eigener Schrift decodiert. Die Tabelle wird niemals aus den Spielen des BSV berechnet. Gespeichert werden Tabellenzeilen, Quelladresse, Abrufzeit, Ergebnisse und Warnungen als dauerhafter Quellenstand je Beitrag.

Ergebnisse kommen aus `social_games`: die letzten zehn gespeicherten abgeschlossenen Spiele der Mannschaft bis einschließlich Erscheinungsdatum (Zeitzone Berlin). Sie sind **kein vollständiges Ergebnisarchiv**; die bestehende Aufbewahrung der Social-Media-Daten kann ältere Spiele bereits entfernt haben. Fehlt eine Verbandstabelle, wird dies ausdrücklich angezeigt. Scheitert ein späterer Tabellenabruf, bleibt ein zuvor erfolgreicher Quellenstand erhalten. Tabellen stellen den aktuellen Abrufstand dar; ein vergangenes Erscheinungsdatum rekonstruiert keine historische Tabelle. Ein neuer Abruf setzt die Beiträge auf **In Prüfung**.

## Technik und Bereitstellung

- UI: `admin-site/editorial.mjs`, `admin-site/editorial.css`, eingebettet durch den bestehenden Build.
- API: Aktionen `editorial_*` im bestehenden `social-media-admin-api`, umgesetzt in `editorial.ts`.
- Datenbank: Migration `20260919234213_editorial_workspace.sql` mit `editorial_issues`, `editorial_articles`, `editorial_article_revisions` und einer transaktionalen Erzeugungsfunktion.
- Rechte: eigener Bereich `editorial`. Super-Admins haben automatisch Zugriff; weitere Benutzer erhalten ihn in der Benutzerverwaltung. Keine automatische Erweiterung bestehender Benutzerrechte. Tabellen und RPC sind für `anon` und `authenticated` gesperrt, RLS ist aktiviert. Die API prüft aktive Mitgliedschaft und Bereichsrecht vor jedem Zugriff mit der Serverrolle.
- Gleichzeitige Bearbeitung: Versionsnummern verhindern stilles Überschreiben. Auch eine verspätete KI-Antwort darf eine inzwischen neuere Änderung nicht ersetzen. Die Redaktion gehört nicht zum automatischen 30-Tage-Löschlauf der Social-Media-Daten.

Zum Onlineeinsatz zuerst die Migration im Zielprojekt anwenden, danach die aktualisierte Admin-API und den UI-Build bereitstellen. Die Änderung im Repository allein aktualisiert den laufenden Dienst nicht.

Für die automatische Textüberarbeitung ausschließlich serverseitig die Supabase Edge Secrets `OPENAI_API_KEY` und `EDITORIAL_AI_MODEL` setzen. Das Modell wird bewusst explizit konfiguriert. Ohne beide Werte funktioniert das Schreiben und Speichern, die Oberfläche meldet die fehlende Einrichtung. Keine Zugangsdaten gehören in HTML, Git oder die öffentliche Konfiguration.

Die KI verwendet die [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text) mit `store: false`, 45 Sekunden Timeout und begrenzter Ausgabelänge. Der Prompt erlaubt sprachliche Ergänzungen und untersagt erfundene Fakten, Namen, Zitate, Ergebnisse und Termine. Eine redaktionelle Prüfung bleibt durch den Status **In Prüfung** vorgesehen. Unvollständige Antworten oder Dienstfehler lassen den gespeicherten Eingabetext bestehen.

Diese Oberfläche versendet keine Newsletter und veröffentlicht keine Stadionhefte. Drucklayout, PDF-Erzeugung und die Übergabe an das separate Projekt `bsv-stadionheft` sind nachgelagerte Ausbauschritte. Ebenso sind automatische Erinnerungen, eine konfigurierbare Rubrikenbibliothek und Abteilungsrechte innerhalb der Redaktion noch nicht enthalten.

## Verifikation

```bash
npm run check
npm run build
npx deno check supabase/functions/social-media-admin-api/editorial.ts
npx deno test --no-check --allow-env=OPENAI_API_KEY,EDITORIAL_AI_MODEL tests/editorial-api.test.ts
```

`--no-check` beim Testlauf umgeht fehlende Node-Assert-Typen in der vorhandenen Deno/npm-Umgebung; das Produktivmodul wird separat typgeprüft. `supabase/tests/editorial_workspace.sql` kann nach der Migration mit `psql -v ON_ERROR_STOP=1` in einer isolierten Testdatenbank ausgeführt werden und rollt alle Testdaten zurück. Es prüft RLS/Grants, transaktionale Heftanlage, Datumskonsistenz, Versionskonflikte und Revisionen.

Die gesamte bestehende Admin-API hat unabhängig von dieser Erweiterung bereits Typfehler durch ihre untypisierte Supabase-Datenbankschnittstelle. Eine vollständige Deno-Typprüfung des alten und neuen Gesamtmoduls meldet jeweils 161 Fehler; der neue Redaktionshandler besteht seine eigene Typprüfung.
