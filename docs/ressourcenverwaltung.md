# Ressourcenverwaltung · Vereinsbus

Unter **Sport & Training → Ressourcenverwaltung** können Trainer den Vereinsbus für zukünftige Auswärtsspiele ihrer zugeordneten Mannschaften reservieren. Super-Admins können für alle Teams buchen und Buchungen freigeben. Trainer und Jugendleitung erhalten den neuen Bereich über ihre bestehende Rolle; weitere Zugriffe lassen sich in der Benutzerverwaltung vergeben. Die Buchung selbst prüft immer die aktuelle Trainerzuordnung und das aktive Trainerprofil.

Der Kalender zeigt die über die Vereins-Spielplanquellen verfügbaren Partien von D-Jugend bis Aktive einschließlich der Juniorinnen. Die Auswahl ist unabhängig von der Social-Media-Aktivierung. Eigene Spiele sind hervorgehoben, die Busreservierungen aller Mannschaften sind sichtbar. **Spielpläne aktualisieren** lädt die offiziellen Mannschafts-Widgets erneut. Fehler einzelner Mannschaften bleiben als Spielplanlücken sichtbar. Heimspiele bleiben zur Orientierung sichtbar, haben aber keine Buchungsfunktion. Die Datenbank weist direkte Spielbuchungen für Heimspiele oder ohne zugeordnetes Auswärtsspiel ab. Freie Events sind eine eigene Buchungsart.

## Freie Events

**Freies Event buchen** reserviert den Bus unabhängig von einer Mannschaft oder einem Spiel. Zur Auswahl stehen Trainerweiterbildung, Förderverein, Stadtevent/Verkauf und Sonstiges. Pflichtangaben sind Anlass, verantwortliche Person sowie Übernahme und Rückgabe; Gruppe/Veranstalter, Zieladresse und Hinweis sind optional. Der vollständige Zeitraum einschließlich Fahrt, Einsatz und Rückgabe wird selbst angegeben (höchstens 72 Stunden).

Freie Events erscheinen violett mit ◆, Veranstaltungsname und Veranstaltungsart im Kalender und in der Buchungsliste. Auswärtsspielfahrten behalten die goldene Buskennzeichnung. Auch beim Filtern nach einer Mannschaft bleiben alle Busbelegungen sichtbar. Beide Buchungsarten verwenden dieselbe atomare Überschneidungsprüfung.

Alle aktiven Mitglieder mit Ressourcenrecht können freie Events buchen, auch ohne Trainer- oder Mannschaftszuordnung. Nur die buchende Person und Super-Admins können sie freigeben; der frei eingegebene Kontakt überträgt keine Zugriffsrechte. Veranstaltungsdaten werden in `event` und die Art in `booking_kind` gespeichert; freie Events haben keine Mannschafts- oder Spielreferenz. Die API validiert beide Buchungsarten getrennt und akzeptiert keine Spielreferenz in freien Events. Stornierungen bleiben wie bei Spielfahrten erhalten.

## Buchungsablauf

1. Das eigene Spiel anklicken. Der tatsächliche Spielort wird aus dem Ortslink der offiziellen Spielseite gelesen. Entscheidend ist der tatsächliche Austragungsort; der Heimatort des Gegners allein reicht für die Routenplanung nicht aus.
2. Die Ortssuche liefert passende Adressen; die erste wird für den Routenvorschlag verwendet. Bei Bedarf einen anderen Treffer auswählen oder die Adresse korrigieren. **Route ansehen** öffnet die Karte zur Kontrolle.
3. Abfahrt und Rückgabe prüfen und gegebenenfalls anpassen. Die Vorgabe vor dem Anpfiff lautet: 15 Minuten Treffpunkt/Packen beim BSV + Hinfahrt + 15 Minuten Umziehen + 45 Minuten Aufwärmen. Nach dem Spiel: 15 Minuten Auslaufen/Nachspiel + 30 Minuten Umziehen + Rückfahrt + 20 Minuten Toleranz bis zur Bus-Rückgabe. Die Straßenroute liefert Hin- und Rückfahrzeit getrennt. Alle Werte sind anpassbar. Änderungen berechnen den Vorschlag sofort neu; der Ablauf zeigt die Uhrzeit jedes Schrittes.
4. **Verbindlich reservieren** speichert den Zeitraum. Überlappende Buchungen werden in der Datenbank abgewiesen, auch bei gleichzeitigen Anfragen. Direkt angrenzende Reservierungen sind möglich. **Reservierung freigeben** storniert eine eigene Teamreservierung; die Stornierung bleibt gespeichert.

Abholung und Rückgabe sind beim BSV Nordstern, Schlesierstraße 43, 78315 Radolfzell am Bodensee. Vorgaben für Spiel plus Pause: D 70, C 85, B 95, A und Aktive 105 Minuten. Das sind anpassbare Planungswerte, keine automatische Ermittlung der tatsächlichen Schlusszeit. Routen enthalten keine Echtzeit-Verkehrsdaten. Wenn Spielortsuche oder Routing ausfallen, können Adresse und geschätzte Fahrzeiten manuell eingegeben werden. Der berechnete Ablauf wird zusammen mit der Buchung gespeichert. Die Buchung bleibt ein ausdrücklicher Schritt; ein Spielplanabruf reserviert keinen Bus.

Beispiel: Anpfiff 16:00, 30 Minuten je Fahrtrichtung, 90 Minuten Spiel plus 15 Minuten Halbzeitpause → Treffpunkt 14:15, Abfahrt 14:30, Ankunft 15:00, Aufwärmen ab 15:15, Spielende 17:45, Umziehen ab 18:00, Rückfahrt 18:30, zurück beim BSV 19:00, Bus-Rückgabe spätestens 19:20. Jugendspiele verwenden die kürzere, weiterhin anpassbare Spieldauer.

Geänderte Anstoßzeiten, eine Änderung zum Heimspiel oder Spielabsagen ändern bestehende Reservierungen nicht automatisch. Sie werden bei der betroffenen Buchung als Prüfhinweis angezeigt. Beim Buchen werden die aktuelle Anstoßzeit und der Spielstatus erneut geprüft.

## Betrieb

- Migration: `20261030133113_resources_bus.sql` , `20261030160152_resource_away_timing.sql` und `20261030160906_resource_free_events.sql`; anschließend `social-media-admin-api` und UI bereitstellen.
- Daten liegen in privaten Tabellen mit aktivem RLS und ohne direkten Clientzugriff. Die service-only RPC `resource_request` prüft Benutzerstatus, Bereichsrecht und Mannschaftszuordnung. Jede Reservierung beziehungsweise Stornierung sperrt denselben Ressourcen-Datensatz bis zum Transaktionsende.
- `resource_*`-API-Aktionen erlauben ausschließlich `list`, `sync`, `match`, `route`, `book` und `cancel`; interne Abruf-/Cache-Aktionen lassen sich nicht aus dem Browser weiterleiten.
- Ortssuche: Photon/komoot. Straßenroute: OSRM/FOSSGIS auf OpenStreetMap-Daten, Hin- und Rückweg getrennt berechnet. Adress- und Routenergebnisse werden sieben Tage zwischengespeichert. Provider-Aufrufe werden anwendungsweit über eine Datenbanksperre auf höchstens einen pro 1,1 Sekunden begrenzt. Die Dienste können über `RESOURCE_GEOCODER_URL` und `RESOURCE_ROUTER_URL` in den Edge-Function-Einstellungen umgestellt werden. Die Oberfläche enthält die Attribution und den Link zum Berichtigen von Kartendaten.
- Nur öffentliche Zieladressen und Koordinaten werden für die Routenplanung übertragen. Trainerdaten werden nicht an Routendienste gesendet.
- Die lokale Vorschau arbeitet mit ausdrücklich gekennzeichneten Spielen, Adressen und Fahrzeiten. Sie verändert keine Live-Buchungen.

Validierung: Node-Tests für Mannschaftsgruppen, Zeitvorschläge, Sommer-/Winterzeit, Überschneidungen, Spielortauswertung, Zugriffsschutz und Routencache; isolierte PostgreSQL-17-Tests für Rechte, Kalender, Spielplanänderungen, Buchungen und Stornierungen; parallele Reservierungen mit genau einer erfolgreichen Buchung; Browserprüfung für Trainerablauf, Wiederladen, Konflikt, Stornierung und 390-Pixel-Ansicht.

`npm run test:resources:api` prüft zusätzlich den tatsächlichen Admin-API-Einstieg einschließlich Kalenderabruf, Spielplansynchronisierung mit einer echten TTF-Schrift, Bereichsschutz, Ablehnung von Heimspielbuchungen und Speicherung des detaillierten Zeitplans. Nur der Auth-Wrapper wird über eine ausschließlich für diesen Test verwendete Import-Map ersetzt; Router und Schriftbibliothek entsprechen der Produktion. Diese Prüfung reproduziert den früheren Fehler `opentype is not defined`, der in der Browser-Vorschau mit ihren Beispieldaten nicht auftrat.

Zusätzliche Prüfungen für freie Events: Buchung ohne Mannschaft, erforderliche Veranstaltungsdaten, Sichtbarkeit bei fehlender Mannschaftsreferenz, Ereignis-/Spielüberschneidungen, Stornierungsrechte, unveränderte Heimspielsperre und Darstellung auf Mobilgeräten.
