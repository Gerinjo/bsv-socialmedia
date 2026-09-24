# Nordstern Post in der Club Suite

Seit dem 24.09.2026 liegt die Newsletter-Pflege im Projekt `bsv-socialmedia`. Die Website bleibt Quelle der öffentlichen Vereinsinhalte und Bilder. Die bereits versendete September-Ausgabe, die bearbeitbare Website-Vorlage, HTML und Text, Resend-Metadaten, Sponsoren-Auswahl und die zugehörigen Tests wurden übernommen. `emails/nordstern-post/website-import.json` enthält Prüfsummen der sechs unverändert verschobenen Ausgabedateien.

## Newsletter und Stadionheft

Beide Formate nutzen die Redaktion für Planung, Verantwortliche, Texte und Freigaben. Ihre Ausgaben bleiben eigenständig:

| | Nordstern Post | Nordstern News / Stadionheft |
| --- | --- | --- |
| Zweck | Vereinsneuigkeiten und kurze Einladungen zum Mitmachen | Ausführliche Berichte, Mannschaften und Sportdaten |
| Gestaltung | Grün-gelbe E-Mail mit Wappen und Header-Motiv aus der Website | Blätterbares Heft mit Titelblatt, Seiten und Anzeigen |
| Abschluss | HTML- und Textdatei für einen Resend-Broadcast | Veröffentlichung mit öffentlichem Heftlink |
| Verbindung | Fester Abschnitt verlinkt veröffentlichte Stadionhefte automatisch | Bleibt eine eigene Ausgabe |

Die Newsletter-Planung führt damit in eine E-Mail-Vorschau. Ein Erscheinungsdatum plant die Ausgabe; es verschickt keine E-Mail. Der bereits bestehende manuelle Resend-Ablauf wird beibehalten.

## Übernommene redaktionelle Grundlage

Die September-Vorlage bleibt die Referenz für Gestaltung und Tonalität:

1. Begrüßung und Vereinsleben.
2. Junge Sterne: Jugend und Engagement.
3. Dabei sein: Spielplan und Termine.
4. Gemeinsam mehr ermöglichen: Förderverein und Mitmachen.
5. Nordstern News: Verweis zum digitalen Stadionheft.
6. Weitere Abteilungen, Kontakt und Abschluss.

Neue Ausgaben können diese Reihenfolge als Orientierung nutzen; die vorhandene freie Beitragsplanung wird nicht durch Pflichttexte ersetzt. Konkrete Termine, Ergebnisse und Aussagen müssen redaktionell geprüft werden. Die historische September-Ausgabe verweist ausdrücklich auf ein Beispielheft; diese Kennzeichnung bleibt im Archiv erhalten.

## Arbeit in der Suite

Unter **Redaktion → Newsletter** eine Ausgabe auswählen oder anlegen, Texte bearbeiten und Beiträge freigeben. Ohne eigene E-Mail-Angaben dient der Ausgabentitel als Betreff und der Anfang des ersten nicht leeren Beitrags als Vorschautext. Links im Beitrag werden in der HTML-Mail anklickbar. Die Gestaltung verwendet die aus der Website-Vorlage abgeleitete Datei `templates/newsletter.html`.

**E-Mail vorab ansehen** zeigt auch Entwürfe und kennzeichnet offene Beiträge. **E-Mail-HTML exportieren** und **E-Mail-Text exportieren** sind nach Freigabe aller Beiträge und Öffnen der aktuellen Vorschau verfügbar. Diese Exporte enthalten den aktuellen Redaktionsstand; sie sind getrennt vom allgemeinen Arbeitsstand-Export **Texte exportieren**.

Jeder neue Newsletter enthält automatisch den festen Abschnitt **Unsere Stadionhefte** – in der Vorschau sowie im HTML- und Text-Export. Er verlinkt alle bereits veröffentlichten Stadionhefte der Suite, nach Veröffentlichungsdatum absteigend, sowie das bestehende digitale Heft unter `https://gerinjo.github.io/bsv-stadionheft-pages/`. Der feste Heft-Link erscheint auch dann, wenn noch keine Suite-Ausgabe veröffentlicht ist. Die aktuelle Ausgabenliste wird für jede Vorschau und jeden Export neu gelesen. Unveröffentlichte Entwürfe werden ausgeschlossen; bei bereits veröffentlichten, erneut bearbeiteten Ausgaben verweist der Link weiterhin auf die letzte Veröffentlichung. Die Beschriftung verwendet das Veröffentlichungsdatum, damit geänderte Entwurfstitel nicht in der E-Mail landen. Alle Links sind absolute öffentliche Adressen. Lokale Beispielausgaben werden nicht als öffentlich verfügbare Hefte ausgegeben.

Die Karte **Aus dem Stadionheft übernehmen** bietet **Heft & Artikel auswählen**. Zuerst ein veröffentlichtes Stadionheft auswählen, dann bis zu 30 Artikel ankreuzen. Die Auswahl zeigt bereits die späteren kurzen Auszüge (höchstens 420 Zeichen, möglichst am Satzende gekürzt). **Artikelauswahl speichern** übernimmt die Texte aus der veröffentlichten Fassung in den Newsletter. Im HTML- und Text-Export führt **Weiterlesen im Stadionheft** direkt zum jeweiligen vollständigen Artikel. Die Artikel bleiben in der Heftreihenfolge. Zusätzliche eigene Newsletter-Beiträge sind möglich; eine Ausgabe kann auch ausschließlich aus ausgewählten Heftartikeln bestehen.

Auszüge, Titel und Heftfassung werden gemeinsam gespeichert. Spätere Änderungen am Heft ändern die Auswahl nicht automatisch. Falls eine neuere Veröffentlichung vorliegt, lässt sie sich im Auswahlfenster ausdrücklich laden. Die Links enthalten die Heftversion und öffnen auch nach einer erneuten Veröffentlichung die passende Fassung. Abwählen einzelner Artikel oder **Keine Artikel übernehmen** entfernt die Übernahme. Jede Änderung verlangt vor dem Versandexport eine neue E-Mail-Vorschau. In der lokalen Vorschau steht ein ausdrücklich gekennzeichnetes Beispielheft zum Ausprobieren bereit; dessen Leselinks funktionieren nur lokal im selben Browser.

Die historische Website-Vorlage und das Versandarchiv liegen weiterhin unverändert unter `emails/nordstern-post/`. Sie sind kein Auswahlbereich der Newsletter-Oberfläche mehr.

Der Export bettet den persönlichen Resend-Abmeldelink in eine Suite-Seite mit **Abmeldung bestätigen** ein. Erst nach diesem Klick erfolgt die Abmeldung bei Resend; ein signierter Webhook löst anschließend eine Bestätigungsmail aus. Vorschau, technische Einrichtung und Betriebsstatus sind unter [Newsletter-Abmeldung](newsletter-abmeldung.md) beschrieben. Die Dateien in einen Broadcast übernehmen, Absender und Abonnentensegment auswählen und vor dem eigentlichen Versand prüfen. Der Broadcast-Versand bleibt manuell. Die neue Abmeldebestätigung verwendet nach ihrer Einrichtung die Resend-API. Empfängeradressen bleiben dort verwaltet.

## Name, Ausgabe & Gestaltung

Die aufklappbare Karte **Name, Ausgabe & Gestaltung** speichert die Angaben für die ausgewählte Newsletter-Ausgabe:

- Newsletter-Name und manuelle Ausgabenummer.
- Überschrift, Dachzeile und Einleitung im Kopfbereich.
- Sichtbarkeit von Name, Nummer, Erscheinungsmonat, Überschrift, Dachzeile und Einleitung.
- Eigener E-Mail-Betreff und Vorschautext; leere Felder verwenden die bisherigen automatischen Werte.

Der Erscheinungsmonat kommt aus **Planung & Termine**. Eine leere Ausgabenummer wird auch bei aktiviertem Schalter nicht ausgegeben. Diese Einstellungen wirken auf HTML und Text; die festen Stadionheft-Links bleiben enthalten. Die Ausgabennummer wird nicht automatisch hochgezählt. Einstellungen anderer Ausgaben bleiben erhalten.

**Newsletter-Angaben speichern** sichert die Felder gemeinsam. Ein Versionskonflikt überschreibt keine neuere Änderung. Ungespeicherte Angaben verhindern den Wechsel zur Vorschau, zum Export oder zu einer anderen Ausgabe; **Änderungen verwerfen** lädt den gespeicherten Stand. Nach einer tatsächlichen Änderung ist vor dem Export eine neue Vorschau erforderlich.

Das neue E-Mail-Layout ist auf Desktop auf 720 statt 600 Pixel begrenzt und besitzt einen grünen, 4 Pixel breiten Rahmen mit gelbem Abschluss am Kopf. Auf schmalen Bildschirmen passt es sich der verfügbaren Breite an. Die Outlook-Tabellenbegrenzung verwendet ebenfalls 720 Pixel. Die übernommene September-Vorlage und das Versandarchiv bleiben unverändert.

## Sponsoren

Das vollständige bestehende Verfahren liegt jetzt in `scripts/newsletter-sponsors.mjs`: drei allgemeine Partner, drei Jugendpartner und vier Stadionheft-Partner; keine doppelten Partner innerhalb eines Blocks. Die Auswahl wird gemeinsam für HTML und Text in der ausgabenspezifischen `.sponsors.json` festgehalten. Öffnen einer Vorschau zieht keine neue Auswahl.

Für eine neue Ausgabe auf Basis der **vollständigen Website-Vorlage** beide Dateien unter einem neuen Namen anlegen, Inhalte aktualisieren und anschließend:

```sh
node scripts/newsletter-sponsors.mjs emails/nordstern-post/2026-10
```

Die drei HTML-Kommentarmarker und Textüberschriften der Vorlage müssen erhalten bleiben. Der Befehl verwendet den übertragenen Katalog `emails/nordstern-post/sponsor-catalog.json`, einschließlich geprüfter PNG-Bildmaße, ohne einen Website-Checkout zu benötigen. Dies ist der beim Umzug übernommene Quellenstand, kein Live-Abgleich. Aktuelle Freigaben und Zuordnungen vor einer neuen Ausgabe prüfen. Reine Stadionheftpartner kommen nicht in den allgemeinen Pool. Die veröffentlichten Logo-Adressen bleiben auf der Website.

Die automatische Sponsoren-Auswahl ist weiterhin ein dateibasierter Schritt der vollständigen Website-Vorlage. Freie Ausgaben aus dem Suite-Editor übernehmen keine historischen Sponsoren automatisch; eine im Editor gespeicherte Auswahl pro Ausgabe ist noch nicht implementiert.

## Bilder und Betrieb

Die bestehenden öffentlich erreichbaren Bilder der Website-Vorlage bleiben unverändert. Neue Uploads im Redaktionsbereich haben derzeit zeitlich begrenzte Storage-Links. Sie funktionieren in der Vorschau, werden aber beim Newsletter-Export abgewiesen, damit keine später ablaufenden Bilder versendet werden. Dauerhaft öffentliche Bilder werden im Renderer unterstützt; ein eigener Veröffentlichungsablauf für Newsletter-Bilder steht noch aus.

Die Newsletter-Gestaltung benötigt die Migration `20260924143541_editorial_newsletter_settings.sql`, die Artikelauswahl zusätzlich `20260924144820_editorial_newsletter_selection.sql`. Zuerst die Migrationen, dann die aktualisierten Funktionen `social-media-admin-api` und `editorial-publications`, danach den UI-Build bereitstellen. Der öffentliche Heft-Endpunkt unterstützt mit `version` eine bestimmte veröffentlichte Fassung; ohne Parameter bleibt die neueste Veröffentlichung der Standard. Eine nicht verfügbare Fassung ergibt 404, ohne auf andere Texte auszuweichen. Die Angaben liegen in `editorial_issues.newsletter_settings`, die Artikelauswahl in `editorial_issues.newsletter_selection` und sind Teil des versionsgeprüften Vorschau-Snapshots. Die bestehenden privaten Tabellenrechte und RLS bleiben bestehen; eine neue Tabelle oder neue Zugriffsrechte sind nicht nötig. Die lokale Vorschau speichert die gleichen Angaben im Browserspeicher. Der UI-Build enthält das Newsletter-Layout; die historischen Dateien bleiben im Projektarchiv. Neue Vorschau und Export verwenden die bestehende Newsletter-Ausgabeart und die vorhandene, versionsgeprüfte Vorschau-API. Das öffentliche Heftarchiv und die Stadionheft-Veröffentlichung bleiben eigenständige Funktionen.

Die Newsletter-Funktionen wurden am 24.09.2026 für die produktive Club Suite freigegeben. Die drei Datenbankmigrationen und die aktualisierten Edge Functions sind im Suite-Projekt bereitgestellt; der Abmelde-Webhook ist aktiviert. Die Oberfläche wird als Sites-Version unter `https://bsv-story-automatik.jerome-ernsberger.chatgpt.site` veröffentlicht. Der Newsletter-Versand bleibt ein eigener redaktioneller Schritt.

Verifikation der Gestaltung: 225 Node-Projekttests, 26 Deno-API-Tests, Deno-Typprüfung und UI-Build erfolgreich. Die vollständige Redaktionsmigration wurde in einer isolierten PostgreSQL-17-Datenbank ausgeführt; `supabase/tests/editorial_newsletter_settings.sql`, `supabase/tests/editorial_newsletter_selection.sql` und der bestehende Veröffentlichungstest bestätigen Snapshot, Versionsschutz, Vorschaupflicht und Rechte. Der Security Advisor meldete dort keine Probleme. Browserprüfung: Speichern und Neuladen, Schutz ungespeicherter Eingaben, Vorschaupflicht nach Änderungen, 720-Pixel-Rahmen und mobile Darstellung ohne horizontalen Überlauf. Die Artikelauswahl wurde mit Speichern/Neuladen, Abwählen, Entfernen der gesamten Auswahl, gekürztem Export und einem Artikellink in den Heftleser geprüft.
