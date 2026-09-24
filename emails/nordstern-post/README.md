# Nordstern Post · Club Suite

Die Newsletter-Dateien wurden am 24.09.2026 aus `bsv-website` hierher verschoben. Dieses Projekt ist jetzt der Pflegeort für Vorlage, Versandarchiv, Sponsoren-Auswahl und Weiterentwicklung. Die sechs Ausgabedateien sind bytegleich übernommen; `website-import.json` dokumentiert ihre SHA-256-Prüfsummen.

Die Suite bietet unter **Redaktion → Newsletter** eine eigene E-Mail-Vorschau und HTML-/Text-Export. Dort lassen sich Stadionhefte und einzelne Artikel auswählen; die E-Mail enthält kurze Auszüge und Links zum vollständigen Heft. Website-Vorlage und Versandarchiv bleiben als Dateien in diesem Ordner erhalten. Neue redaktionelle Ausgaben verwenden `templates/newsletter.html`, abgeleitet aus dem bestehenden Layout. Details und Grenzen: [Newsletter-Konzept](../../docs/newsletter.md).

## Ausgabe 01 / September 2026

Status: am 18. September 2026 um 15:51 Uhr (Europe/Berlin) auf Nutzeranweisung versendet. Resend bestätigt `sent`. Name in Resend: `NordsternPost`.

- **Resend-Broadcast-ID:** `508062c7-3552-4209-a8ec-c6c208461f53`
- **Dashboard:** [Resend Broadcasts](https://resend.com/broadcasts)
- **Absender / Antwortadresse:** `info@bsvnordstern.de`
- **Empfängergruppe:** `Nordstern Post` (beim Versand vier abonnierte Kontakte: die drei angelegten Vereinsadressen und eine zusätzlich vorhandene Adresse)
- **Prüfung:** Status `sent` und Versandzeit über die API zurückgelesen.
- **Versandarchiv:** `2026-09.sent.html` und `2026-09.sent.txt` enthalten den nach dem Versand aus Resend gelesenen Inhalt. Die Dateien ohne `.sent` bleiben die bearbeitbare Vorlage. Für weitere Ausgaben neue Dateien und einen neuen Broadcast anlegen.
- **Metadaten:** `2026-09.resend.json`

- **Betreff:** Nordstern Post: Dein Verein. Dein September. ✦
- **Vorschautext:** Junge Sterne stärken, gemeinsam Sport erleben und beim BSV mitmachen.
- **Ausgabe:** 01 / September 2026
- **HTML:** `2026-09.html` (direkt im Browser öffnen)
- **Textalternative:** `2026-09.txt`

## Zufällige Sponsoren pro Ausgabe

Für jede neue Ausgabe die Auswahl neu ziehen und dann für den Entwurf festhalten:

- Allgemeiner Teil: **3 Sponsoren**, derselbe freigegebene Pool wie auf der
  Startseite (einschließlich Mannschaftspartnern, ohne reine Stadionheft-Partner).
- Jugendteil: **3 Jugendsponsoren** aus `youth_department` oder `youth_team`.
- Stadionheft: **4 Partner** mit Sponsorart `stadionheft`.

Die Zuordnungen stammen ursprünglich aus `bsv-website/src/data/advertisingPartners.generated.json`. Der übernommene Stand liegt mit PNG-Bildmaßen in `sponsor-catalog.json`; für den Befehl ist kein Website-Checkout erforderlich. Vor einer neuen Auswahl den Katalog gegen die aktuellen freigegebenen Partner prüfen und aktualisieren. Die öffentlich gehosteten Logos bleiben auf der Website.
Innerhalb eines Blocks wird jeder Sponsor höchstens einmal ausgewählt; ein Partner
mit passender Zuordnung kann in mehreren Blöcken vorkommen. Alle Partner eines
Pools haben dieselbe Auswahlchance. Logos und Firmennamen sind verlinkt.

```sh
# Zuerst HTML und TXT unter dem Dateipfad der neuen Ausgabe anlegen.
node scripts/newsletter-sponsors.mjs emails/nordstern-post/2026-10
```

Der Befehl ersetzt ausschließlich die markierten Sponsorenblöcke in den lokalen
HTML- und Textdateien und speichert die gezogene Auswahl in der zur neuen Ausgabe gehörenden `.sponsors.json`.
Bei weniger als 3/3/4 passenden Partnern bricht er ab. Für neue Ausgaben dieselben
HTML-Kommentarmarker und Textblock-Überschriften übernehmen und den neuen Dateipfad
angeben. Die Zufallsauswahl erfolgt beim Erstellen/Aktualisieren der Ausgabe,
nicht beim Öffnen einer E-Mail und nicht automatisch beim Duplizieren in Resend.
Anschließend HTML und Text in den zugehörigen Resend-Entwurf übernehmen;
das Skript selbst ruft Resend nicht auf und versendet nichts.

Die HTML-Mail verwendet die Vereinsfarben Grün und Gelb, ein Tabellenlayout mit
Inline-Styles, Systemschriften und eine mobile Anpassung. Rechts im Header steht
das Originalwappen (`/images/verein/wappen/bsv-nordstern.png`). Der Kopfbereich
verwendet das Motiv des mobilen Teams-Menüs (`/images/fussball/teams-schuss.webp`)
als abgedunkelten Hintergrund. Beide Bilder werden von `https://bsvnordstern.de`
geladen; Clients ohne Unterstützung für WebP/CSS-Hintergründe zeigen die grüne
Grundfarbe. Der Stadionheft-Abschnitt
bindet zwei öffentlich erreichbare Mannschaftsfotos vom Stadionheft auf GitHub Pages
ein. Die Sponsorenlogos werden von `https://bsvnordstern.de/images/sponsors/synced/`
geladen. Auch bei deaktivierten Bildern bleiben Namen, Text und Links nutzbar. Es werden
kein JavaScript und keine zusätzlichen Pakete benötigt. Die Quelldateien liegen im Suite-Projekt unter `emails/nordstern-post/`. Die Dateien bleiben als Vorlagenarchiv im Suite-Projekt; die Website veröffentlicht sie nicht.

## Verwendung mit Resend

Die Dateien sind für einen [Resend Broadcast](https://resend.com/docs/dashboard/broadcasts/introduction)
vorbereitet. Beim [Anlegen über die Broadcast API](https://resend.com/docs/api-reference/broadcasts/create-broadcast)
wird `2026-09.html` als `html` und `2026-09.txt` als `text` übergeben, zusammen mit
Betreff, verifiziertem Absender und dem gewünschten Newsletter-Segment.
Für einen Entwurf `send` weglassen bzw. auf `false` setzen.

In diesen historischen Vorlagen wird der Platzhalter `{{{RESEND_UNSUBSCRIBE_URL}}}` im Footer beim Broadcast-Versand
von Resend durch den individuellen Abmeldelink ersetzt; in der lokalen
Browser-Vorschau funktioniert er noch nicht. Die Vorlage ist deshalb für den
Broadcast-Versand bestimmt und sollte nicht unverändert über `/emails` versendet werden.

Neue Suite-Exporte führen zuerst auf eine eigene Bestätigungsseite und versenden nach erfolgter Abmeldung eine Bestätigungsmail; Einrichtung und aktueller Betriebsstatus: [Newsletter-Abmeldung](../../docs/newsletter-abmeldung.md). Die historischen Dateien bleiben unverändert.

Vor dem Versand Ausgabe und Inhalte redaktionell prüfen, das Segment der
Newsletter-Abonnenten auswählen und die Darstellung mit einer Testmail prüfen.
Die drei gewünschten Empfänger wurden über die Contacts-API mit dem Segment
`Nordstern Post` verknüpft; die Zuordnung und der abonnierte Status wurden geprüft.
Empfängeradressen werden in Resend verwaltet und nicht in diesen Projektdateien
gespeichert. Eine Versandautomatisierung wurde nicht eingerichtet.

## Inhaltliche Grundlage

Die Texte wurden anhand der vorhandenen Website neu formuliert:

- `bsv-website/src/pages/index.astro`: Vereinsname, Gründungsjahr, Abteilungen, Spielplan.
- `bsv-website/src/pages/jugend/trainer-gesucht.astro`: Engagement im Jugendtrainerteam.
- `bsv-website/src/components/FoerdervereinPage.astro`: Aufgaben des Fördervereins.
- `bsv-website/src/pages/impressum.astro`: Vereinsanschrift und Kontakt.
- [Digitales Stadionheft](https://gerinjo.github.io/bsv-stadionheft-pages/):
  neuer Abschnitt „Nordstern News“ mit Heftlink und den Originalbildern
  `assets/saison-2627/herren-eins.jpeg` und `assets/saison-2627/frauen.jpg`.
  Beide Fotos tragen laut Heft den Bildstand 2025/26. Die verlinkte Ausgabe 01
  der Saison 2026/27 ist als Beispielheft gekennzeichnet; auf die noch nicht
  freigegebenen KI-Textentwürfe wird im Newsletter hingewiesen.

Konkrete Spieltermine, Ergebnisse, Zitate und Veranstaltungsmeldungen sind nicht
erfunden worden. Spielplan und Kalender sind als Links enthalten, damit Leserinnen
und Leser die jeweils aktuellen Angaben auf der Website finden.
