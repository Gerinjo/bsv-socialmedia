# Erstattung vorgestreckter Schiedsrichtergebühren

Die Erweiterung ergänzt die [Vereinsschiri-Zuweisung](referees.md) um einen eigenen Ablauf für offiziell angesetzte Jugend-Schiedsrichter. Sie erkennt gebührenrelevante Heimspiele anhand der Ansetzung und liest den tatsächlich vorgestreckten Betrag aus der Quittung. Sie berechnet keine Gebührenordnung und unterstellt keinen pauschalen Erstattungsbetrag.

## Lokale Demo

`npm run preview` startet `http://localhost:4173/schiedsrichter`. Zugang: **D1-Junioren / Alex Beispiel / 01.01.1980**, anschließend **Gebühren erstatten**. Die verlinkte Beispielquittung enthält 30,00 € Gebühr und 7,40 € Fahrtkosten, insgesamt 37,40 €. Alle Personen, Belege und Kontodaten der Demo sind fiktiv. Änderungen bleiben im lokalen Browser; echte Kontodaten werden hier nicht importiert.

Die Verwaltung unter `http://localhost:4173` bietet **Schiedsrichter → Erstattungen an Trainer**. Dort lassen sich Quittungen ansehen, zur Korrektur zurückgeben, freigeben und als Prüfliste herunterladen. Ein künftiges Beispielspiel zeigt den gesperrten Upload vor Spielende.

## Ablauf und Status

1. Der Abgleich liest die bekannten A–D-Jugendmannschaften einschließlich B–D-Juniorinnen aus FUSSBALL.DE. Er berücksichtigt ausschließlich BSV-Heimspiele mit bestätigter Mannschaftsidentität. Die Jugendteams müssen nicht für Social-Media-Beiträge aktiviert sein.
2. Im mit Geburtsdatum geschützten Trainerzugang erscheinen Spiele mit offizieller Ansetzung. Nach bestätigtem Spielende kann der Trainer eine Quittung (JPG, PNG, WebP oder PDF, maximal 8 MB) einreichen. Der letzte erfolgreiche Ansetzungsabgleich darf höchstens 48 Stunden zurückliegen.
3. Fotos werden mit Tesseract lokal im Browser gelesen. Eindeutige Gesamtbeträge werden vorgeschlagen. Der Trainer kann den Betrag ändern und muss bestätigen, dass er ihn vorgestreckt und geprüft hat. Erkennung und korrigierter Betrag werden getrennt in Cent gespeichert. Bei PDFs oder fehlgeschlagener Erkennung wird der Betrag manuell eingetragen.
4. **Zur Prüfung**: Der Schiedsrichteradmin sieht Beleg, Betrag, Einreicher und die letzten vier IBAN-Zeichen. Er kann mit einem Hinweis zurückgeben. Nur derselbe Trainer darf eine zurückgegebene Erstattung erneut einreichen.
5. **Zur Auszahlung**: Die Freigabe verlangt geprüfte Kontodaten sowie eine aktuelle Ansetzungs- und Spielstatusprüfung. Sie erzeugt genau einen vorbereiteten Zahlungsauftrag mit festgehaltenem Empfänger, Kontoversion und Betrag. Die Prüfliste enthält nur eine maskierte IBAN und ist keine Bank-Importdatei.

**Es ist noch kein Zahlungsanbieter angebunden.** Eine Freigabe oder ein CSV-Download führt keine Überweisung aus und setzt keinen Status „Erstattet“. Die spätere Integration benötigt Anbieterkonfiguration, einen eindeutigen Schlüssel je Zahlungsauftrag gegen Doppelauszahlungen und überprüfte Zahlungsbestätigungen. Erst bestätigte Ausführung darf „Erstattet“ setzen. Der aktuelle Datenbankschutz sperrt jede Änderung freigegebener Erstattungen; für die Anbieterintegration ist eine gesonderte, autorisierte Statusfunktion mit passender Migration nötig.

## Ansetzungen und Grenzen der Quelle

`syncRefereeFees` läuft im vorhandenen stündlichen `fussball-de-sync` und kann zusätzlich vom Schiedsrichteradmin gestartet werden. Bekannte Widget- und Mannschafts-IDs stehen in `src/referee-source.mjs`. Der Abgleich liest die vom Widget gelieferten letzten und nächsten Spiele im Zeitraum **30 Tage zurück bis 14 Tage voraus**. Er ist kein vollständiger Saisonimport; Spiele, die das Widget nicht mehr liefert, werden nicht neu erfasst. Weitere Jugendteams und nachträgliche Altbelege erfordern eine Erweiterung der Quelle.

Nur die beschriftete Zeile „Schiedsrichter“ auf einer passenden Spielseite zählt. Fehlende Seiten, Datenschutztexte und ein unbekanntes Seitenformat führen zu **unknown**. Ein ausdrücklich leeres Feld führt zu **missing**. Keiner dieser Zustände erlaubt eine Erstattung. `acknowledged` und `finished` gelten als beendet; ein vergangener Anstoß allein genügt nicht. Die Lesedauer ist begrenzt, und die Reihenfolge der Mannschaften rotiert stündlich. Quellfehler werden im Abgleichergebnis angezeigt.

Die Fälle stehen unabhängig von Social-Media-Spielen in `referee_fee_cases`. Der Abgleich erzeugt keine Social-Media-Jobs. Nicht mehr im Widget enthaltene Fälle bleiben erhalten, werden aber ohne frischen Abgleich nicht zur Einreichung oder Freigabe zugelassen. Ein fehlgeschlagener Abgleich bestätigt keine Ansetzung erneut.

Jugendleitung und Kasse können sich ebenfalls für jede Mannschaft auswählen; ihre Erstattungen bleiben der tatsächlich angemeldeten Person zugeordnet. Die [Vereinsfunktionen](referees.md#jugendleitung-und-kasse) werden auch bei der Kontodatenzuordnung und Geburtsdatumspflege berücksichtigt.

## Kontodaten aus dem Trainer-Onboarding

In den Onboarding-Nachrichten des angegebenen Gmail-Postfachs sind die Felder **Kontoinhaber**, **IBAN** und **BIC** vorhanden. Es wurden keine echten Bankdaten in Repository, Demo oder Live-Datenbank übernommen und keine Nachrichten verändert. Die Zuordnung erfolgt nach der Veröffentlichung durch den Schiedsrichteradmin.

Die Admin-Funktion **Kontodaten aus Trainer-Onboarding zuordnen** nimmt einen ausgewählten Trainer, die Nachrichtenreferenz und den Nachrichtentext entgegen. Die IBAN-Prüfziffer und die Feldformate werden geprüft; die bewusste Trainerzuordnung vermeidet automatische Zuordnungen nur anhand gleicher Namen. Eine laufende Gmail-Synchronisierung ist nicht eingerichtet.

Die API verschlüsselt den Kontodatensatz mit AES-GCM und einer zufälligen Nonce. Die Trainer-ID wird als authentifizierte Zusatzinformation gebunden. Speicherung in `private.referee_bank_accounts`; im Browser erscheint nur die letzte Vierergruppe der IBAN. Vorbereitete Zahlungen enthalten einen verschlüsselten Schnappschuss des freigegebenen Kontos; spätere Kontoänderungen verändern diesen Auftrag nicht.

## Bereitstellung

1. Beide Migrationen in Reihenfolge anwenden: `20260927205415_referee_assignments.sql`, anschließend `20260927211334_referee_expenses.sql`. Beide wurden am 27.09.2026 im Suite-Projekt angewendet.
2. Die Kontoverschlüsselung wurde für das Suite-Projekt eingerichtet. Die lokale Sicherung liegt außerhalb des Repositorys unter `~/.config/bsv-socialmedia/referee-bank-key.env` mit Dateirechten `0600`. Für weitere Umgebungen: Einen zufälligen Schlüssel mit `openssl rand -base64 32` erzeugen und als Edge Secret `REFEREE_BANK_ENCRYPTION_KEY` hinterlegen. Den Schlüssel separat sicher aufbewahren. Verlust verhindert die Entschlüsselung; Rotation benötigt eine gezielte Umschlüsselung bestehender Konten und Aufträge.
3. `referee-coach-api`, `social-media-admin-api` und `fussball-de-sync` sowie den Website-Build bereitstellen. Die Funktionenkonfiguration und der Deployment-Workflow sind ergänzt.
4. Trainerzuordnungen, Geburtsdaten, `referee_enabled`, Quellen und Adminrolle prüfen; einen Ansetzungsabgleich durchführen und geprüfte Kontodaten zuordnen.
5. Den Zahlungsanbieter erst nach Auswahl integrieren und mit dessen Testumgebung prüfen.

## Zugriff und Nachweise

Alle neuen Tabellen haben RLS und keine Browserrechte. Bankdaten, Zahlungsaufträge und Ereignisprotokolle liegen im privaten Schema. RPCs sind ausschließlich für `service_role` aufrufbar; sie prüfen zusätzlich Geburtstag/Mannschaft oder die aktive Adminmitgliedschaft. Uploads erfolgen erst nach erfolgreicher Identitäts- und Spielprüfung. Die private Storage-Ablage erlaubt keine direkten Browserzugriffe; Quittungen werden für berechtigte Admins über auf drei Minuten begrenzte Links bereitgestellt.

Eine eindeutige Erstattung je Spiel, Beleg-Hashes, Versionsnummern und Zeilensperren verhindern doppelte Einreichungen und verlorene Änderungen. Freigegebene Erstattungen sind gesperrt. Ein Ereignisprotokoll hält Einreichung, Rückgabe, Korrektur und Freigabe fest. Zahlungsnachweise werden nicht von der Social-Media-Bereinigung gelöscht.

Bei abgebrochenen Uploads können private, noch nicht zugeordnete Dateien verbleiben. Ein erneuter Versuch verwendet denselben unveränderlichen Pfad aus Trainer, Spiel und Datei-Hash. Es gibt bewusst keine sofortige Löschung, die eine zeitgleich erfolgreiche Einreichung beschädigen könnte. Eine spätere Aufbewahrungs- und Bereinigungsroutine muss nur sicher unreferenzierte Altdateien entfernen.

## Prüfung

- `npm run check`: Projektprüfung und Node-Tests, darunter Beträge, Erkennung, IBAN-Prüfung, Verschlüsselung, Belegformate, Wiederholung von Uploads und API-Grenzen.
- `supabase/tests/referee_expenses.sql`: transaktionale Tests in einer separaten Datenbank für RLS, Identität, Mannschaften, Spielzustände, doppelte Belege, Korrekturen, Freigabe, gesperrte Beträge, Kontoschnappschüsse und Audit. Testdaten werden zurückgerollt.
- `deno test --no-lock --node-modules-dir=none --allow-read --allow-env supabase/tests/referee_fee_sync_test.ts`: Quelltests einschließlich kanonischer Weiterleitung, fremder Spielidentität und Quellausfall.
- `deno check --no-lock --node-modules-dir=none supabase/functions/referee-coach-api/index.ts supabase/functions/social-media-admin-api/referees.ts`: Prüfung der neuen Edge-Module.

Die Demo wurde im Browser einschließlich echter Texterkennung der Beispielquittung, manueller Korrektur, Rückgabe und Neueinreichung, Adminfreigabe, CSV-Download und mobiler Ansicht geprüft. Ein lesender Probeabgleich der D1-Quelle erkannte ein beendetes Heimspiel mit Ansetzung und ein zukünftiges Heimspiel ohne Ansetzung; dabei wurden keine Live-Daten geschrieben.
