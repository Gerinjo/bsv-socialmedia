# Ressourcenverwaltung · Vereinsbus

Unter **Sport & Training → Ressourcenverwaltung** können Trainer den Vereinsbus für ihre zugeordneten Mannschaften reservieren. Super-Admins können für alle Teams buchen und Buchungen freigeben. Trainer und Jugendleitung erhalten den neuen Bereich über ihre bestehende Rolle; weitere Zugriffe lassen sich in der Benutzerverwaltung vergeben. Die Buchung selbst prüft immer die aktuelle Trainerzuordnung und das aktive Trainerprofil.

Der Kalender zeigt die über die Vereins-Spielplanquellen verfügbaren Partien von D-Jugend bis Aktive einschließlich der Juniorinnen. Die Auswahl ist unabhängig von der Social-Media-Aktivierung. Eigene Spiele sind hervorgehoben, die Busreservierungen aller Mannschaften sind sichtbar. **Spielpläne aktualisieren** lädt die offiziellen Mannschafts-Widgets erneut. Fehler einzelner Mannschaften bleiben als Spielplanlücken sichtbar. Andere Teams und Fahrten ohne zugehöriges Spiel nutzen **Bus reservieren** mit freiem Zeitraum.

## Buchungsablauf

1. Das eigene Spiel anklicken. Der tatsächliche Spielort wird aus dem Ortslink der offiziellen Spielseite gelesen. Das gilt auch für Heimspiele einer Spielgemeinschaft, die auf einem anderen Sportplatz stattfinden.
2. Die Ortssuche liefert passende Adressen; die erste wird für den Routenvorschlag verwendet. Bei Bedarf einen anderen Treffer auswählen oder die Adresse korrigieren. **Route ansehen** öffnet die Karte zur Kontrolle.
3. Abfahrt und Rückgabe prüfen und gegebenenfalls anpassen. Die Vorgabe lautet: Hinfahrzeit + 45 Minuten vor Anpfiff; Rückfahrzeit + 45 Minuten nach dem kalkulierten Spielende. Auch die Puffer und die Spieldauer sind anpassbar.
4. **Verbindlich reservieren** speichert den Zeitraum. Überlappende Buchungen werden in der Datenbank abgewiesen, auch bei gleichzeitigen Anfragen. Direkt angrenzende Reservierungen sind möglich. **Reservierung freigeben** storniert eine eigene Teamreservierung; die Stornierung bleibt gespeichert.

Abholung und Rückgabe sind beim BSV Nordstern, Schlesierstraße 43, 78315 Radolfzell am Bodensee. Vorgaben für Spiel plus Pause: D 70, C 85, B 95, A und Aktive 105 Minuten. Das sind anpassbare Planungswerte, keine automatische Ermittlung der tatsächlichen Schlusszeit. Routen enthalten keine Echtzeit-Verkehrsdaten. Wenn Spielortsuche oder Routing ausfallen, können Adresse und Zeiten manuell eingegeben werden. Die Buchung bleibt ein ausdrücklicher Schritt; ein Spielplanabruf reserviert keinen Bus.

Geänderte Anstoßzeiten oder Spielabsagen ändern bestehende Reservierungen nicht automatisch. Sie werden bei der betroffenen Buchung als Prüfhinweis angezeigt. Beim Buchen werden die aktuelle Anstoßzeit und der Spielstatus erneut geprüft.

## Betrieb

- Migration: `20261030133113_resources_bus.sql`; anschließend `social-media-admin-api` und UI bereitstellen.
- Daten liegen in privaten Tabellen mit aktivem RLS und ohne direkten Clientzugriff. Die service-only RPC `resource_request` prüft Benutzerstatus, Bereichsrecht und Mannschaftszuordnung. Jede Reservierung beziehungsweise Stornierung sperrt denselben Ressourcen-Datensatz bis zum Transaktionsende.
- `resource_*`-API-Aktionen erlauben ausschließlich `list`, `sync`, `match`, `route`, `book` und `cancel`; interne Abruf-/Cache-Aktionen lassen sich nicht aus dem Browser weiterleiten.
- Ortssuche: Photon/komoot. Straßenroute: OSRM/FOSSGIS auf OpenStreetMap-Daten, Hin- und Rückweg getrennt berechnet. Adress- und Routenergebnisse werden sieben Tage zwischengespeichert. Provider-Aufrufe werden anwendungsweit über eine Datenbanksperre auf höchstens einen pro 1,1 Sekunden begrenzt. Die Dienste können über `RESOURCE_GEOCODER_URL` und `RESOURCE_ROUTER_URL` in den Edge-Function-Einstellungen umgestellt werden. Die Oberfläche enthält die Attribution und den Link zum Berichtigen von Kartendaten.
- Nur öffentliche Zieladressen und Koordinaten werden für die Routenplanung übertragen. Trainerdaten werden nicht an Routendienste gesendet.
- Die lokale Vorschau arbeitet mit ausdrücklich gekennzeichneten Spielen, Adressen und Fahrzeiten. Sie verändert keine Live-Buchungen.

Validierung: Node-Tests für Mannschaftsgruppen, Zeitvorschläge, Sommer-/Winterzeit, Überschneidungen, Spielortauswertung, Zugriffsschutz und Routencache; isolierte PostgreSQL-17-Tests für Rechte, Kalender, Spielplanänderungen, Buchungen und Stornierungen; parallele Reservierungen mit genau einer erfolgreichen Buchung; Browserprüfung für Trainerablauf, Wiederladen, Konflikt, Stornierung und 390-Pixel-Ansicht.
