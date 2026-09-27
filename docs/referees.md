# Schiri-Zuweisung und Auszahlungen

Die Suite enthält den Bereich **Schiedsrichter** für Schiedsrichteradmins und den separaten Trainerzugang unter `/schiedsrichter`.

## Ablauf

1. Ein Schiedsrichteradmin nimmt ein vorhandenes Spiel über **Spiel ohne Schirieinteilung aufnehmen** auf. Die Aufnahme ist je Spiel eindeutig und überschreibt keine vorhandenen Angaben.
2. Der verantwortliche Trainer wählt Mannschaft und Namen und identifiziert sich mit seinem vollständigen hinterlegten Geburtsdatum. Die Zuordnung kommt aus `social_team_people`; aktivierte Personen mit einer Trainerfunktion in einer für Schiedsrichter freigeschalteten Mannschaft (`referee_enabled`) sind zugelassen. Die Freischaltung ist unabhängig von `active`, das die Social-Media-Veröffentlichung steuert.
3. Der Trainer sieht ausschließlich die aufgenommenen Spiele seiner Mannschaft und trägt Schiriname und **7er-Feld** oder **9er-Feld** ein. Bis zur Auszahlung kann er seine Angaben ändern; abgesagte, verlegte und abgebrochene Spiele sind gesperrt.
4. Der Schiedsrichteradmin filtert **Auszahlung offen**, bestätigt **Geld wurde ausgezahlt** und speichert. Voraussetzung: Spielstatus `finished`, Anstoß in der Vergangenheit, Schiri und Feldgröße vorhanden.
5. Der Datensatz erhält Auszahlungszeitpunkt, Admin-ID und einen Schnappschuss der Spiel- und Schiridaten. Ausgezahlte Datensätze sind unveränderlich. Die Funktion dokumentiert eine erfolgte Zahlung; sie führt keine Überweisung aus.

## Zugänge einrichten

In der Benutzerverwaltung kann der Super-Admin die Rolle **Schiedsrichteradmin** (`referee-admin`) vergeben. Diese Rolle erhält ausschließlich den Bereich `referees`. Alternativ lässt sich einem normalen Benutzer der Bereich **Schiedsrichter** zusätzlich zuweisen. Super-Admins haben ebenfalls Zugriff.

Trainer benötigen keinen Supabase-Auth-Benutzer. Fehlende Geburtsdaten können Schiedsrichteradmins in ihrem Bereich hinterlegen. Es wird nur angezeigt, ob ein Geburtsdatum hinterlegt ist, nicht das Datum selbst. Die Mannschaftszuordnung wird aus dem bestehenden Trainerverzeichnis übernommen und bei jedem Zugriff erneut geprüft.

Der Trainerzugang hält die Zugangsdaten ausschließlich im Arbeitsspeicher der geöffneten Seite. Nach 15 Minuten, Abmeldung oder Verlassen der Seite wird die Anmeldung verworfen. Fünf fehlgeschlagene Prüfungen pro Person sperren weitere Versuche für den Rest des 15-Minuten-Fensters. Dieser Zähler liegt in der Datenbank und gilt auch bei parallelen Anfragen und mehreren Edge-Instanzen.

## Jugendleitung und Kasse

Jérôme Ernsberger und Ole Schmal sind als **Jugendleitung**, Wiebke Baronner-Dieterle als **Kassiererin** für jede freigeschaltete Mannschaft auswählbar. Die Auswahl heißt **Person** und zeigt die jeweilige Vereinsfunktion an. Auch neue Mannschaften erhalten diese Auswahl automatisch. Bestehende Trainerzuordnungen werden nicht verändert, Personen mit beiden Funktionen erscheinen je Mannschaft nur einmal.

Die gesonderten Berechtigungen liegen in `private.referee_club_roles`. Die nur für den Server lesbare Sicht `referee_portal_people` verbindet diese mit den Trainerzuordnungen. Auswahl, Geburtsdatumsprüfung, Kontodatenzuordnung und die Pflege fehlender Geburtsdaten nutzen denselben Personenkreis. Deaktivierte Personen, Rollen oder Mannschaften werden bei jedem Zugriff erneut ausgeschlossen. Die Anmeldung verlangt weiterhin das persönliche Geburtsdatum; sie erteilt keine Schiedsrichteradmin-Rechte. Erstattungen werden der jeweils angemeldeten Person zugeordnet.

Für diese Erweiterung nach den beiden Basismigrationen `20260927214316_referee_club_roles.sql` anwenden und beide APIs sowie die Oberfläche bereitstellen. `supabase/tests/referee_club_roles.sql` prüft Zugriff auf mehrere und neue Mannschaften, ausgeschlossene Personen, Rollenentzug, unveränderte Trainerrechte, Geburtsdatum, Erstattungen sowie fehlende Adminrechte.

## Anbindung der identifizierten Spiele

Im vorliegenden Repository und im geprüften Datenbankschema gab es zum Implementierungszeitpunkt noch keine Kennzeichnung für Spiele ohne Schirieinteilung. Daher werden Spiele ausdrücklich aufgenommen; ein leeres oder unbekanntes Schirifeld gilt nicht automatisch als fehlende Einteilung.

Die vorhandene Erkennung kann die authentifizierte Admin-Aktion `referee_register` mit der `gameId` aufrufen. Für einen serverseitigen Import gibt es `referee_admin_request(actor, payload)` mit demselben Aktionsnamen. `actor` muss einem aktiven berechtigten Suite-Nutzer entsprechen. Die eindeutige Referenz auf `social_games.id` verhindert doppelte Einträge. Die bestehende Erkennung im benachbarten Website-Projekt `football-alerts` ist identifiziert. Deren automatische Übergabe an diese Zuweisungstabelle ist weiterhin offen. Der neue [Gebührenabgleich](referee-expenses.md) verwendet dieselbe Prüfung der beschrifteten Schiedsrichterzeile.

## Bereitstellung

1. Migration `20260927205415_referee_assignments.sql` anwenden.
2. Edge Functions `social-media-admin-api` und `referee-coach-api` bereitstellen. Die neue Trainer-API ist in `supabase/config.toml` und dem Deployment-Workflow eingetragen.
3. `npm run build` ausführen und die Website bereitstellen. Der Worker liefert die Traineransicht unter `/schiedsrichter` aus.
4. Rolle, Trainerzuordnungen und hinterlegte Geburtsdaten prüfen; identifizierte Spiele aufnehmen bzw. deren Import anschließen.

Die neuen Tabellen haben RLS, aber keine direkten Browserrechte. Auch die RPCs sind ausschließlich für `service_role` freigegeben. Die Trainer-API erlaubt Lesen der eigenen Spiele, Ändern von Schiriname/Feldgröße und das Einreichen der eigenen [Erstattungen](referee-expenses.md). Auszahlung und Registrierung laufen durch die angemeldete Admin-API und prüfen die Mitgliedschaft zusätzlich in der Datenbank. Versionsprüfung und Zeilensperren verhindern verlorene Änderungen und doppelte Auszahlungen.

Spiele mit einem Schiridatensatz bleiben von der üblichen Social-Media-Datenbereinigung ausgeschlossen. Die Fremdschlüssel verhindern das versehentliche Löschen dieser Spiel- und Zahlungsnachweise.

## Lokale Vorschau und Tests

`npm run preview` startet die Vorschau auf `http://localhost:4173`. Im Bereich **Schiedsrichter** lässt sich die Auszahlung testen. Unter `http://localhost:4173/schiedsrichter` lautet der Beispielzugang **D1-Junioren / Alex Beispiel / 01.01.1980**. Ausschließlich fiktive Daten werden im lokalen Browser gespeichert. Der Produktionsbuild enthält diese Beispieldaten nicht.

- `npm run check`: Projektprüfung und Node-Tests einschließlich Eingabeprüfung, API-Grenzen, Auszahlungsregeln und Aufbewahrung.
- `supabase/tests/referee_assignments.sql`: SQL-Integrationstest nach Anwendung der Migration in einer separaten Testdatenbank. Er prüft Zugriffsrechte, falsche Geburtsdaten, fremde Mannschaften, Versionskonflikte, gesperrte Spiele, Auszahlungsnachweis, doppelte Auszahlung und Fehlversuchslimit. Alle Testdaten werden zurückgerollt.
- Die neuen Edge-Module können mit `deno check --node-modules-dir=none supabase/functions/referee-coach-api/index.ts supabase/functions/social-media-admin-api/referees.ts` geprüft werden. Der vollständige Typecheck der bestehenden Admin-API hat bereits im unveränderten Ausgangsstand 161 Typfehler; diese sind nicht Teil dieser Änderung.

Migration und Tests wurden lokal gegen PostgreSQL 17 geprüft. Am 27.09.2026 wurden die beiden Schiedsrichtermigrationen im Suite-Projekt angewendet; die Veröffentlichung erfolgt unter der bestehenden Club-Suite-Adresse. Der Trainerzugang verwendet dort echte Trainerzuordnungen und hinterlegte Geburtsdaten.
