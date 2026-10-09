# Kassenbuch der Jugendabteilung in der Club Suite

Das Kassenbuch der Jugendabteilung ist ein eigener Arbeitsbereich mit dem gemeinsamen Suite-Login. Benutzer sehen ausschließlich freigegebene Bereiche; für reine Kassennutzer genügt das Recht **Kassenbuch der Jugendabteilung** (`cashbook`). Der frühere Pfad `/kassenbuch/` leitet zu `/?area=cashbook` weiter. Der Super-Admin verwaltet Personen und Safe unter **Administration → Kassenbuch verwalten**.

## Geldbewegungen

- **Kasse:** Geld in den Umschlag im Safe legen, das eingelegte Geld fotografieren, Betrag und optionalen Verwendungszweck eintragen und die Kontrollansicht bestätigen.
- **Trainer und Jugendleiter:** Safe mit Schlüssel oder Zahlencode öffnen, Schiriquittung fotografieren, berechtigte Mannschaft und tatsächlich entnommenen Betrag angeben, mit dem Finger unterschreiben und die Kontrollansicht bestätigen.
- Die Startseite zeigt den aktuellen Bestand und die letzten Bewegungen mit Person, Mannschaft, Betrag, Buchungsnummer, serverseitigem Zeitpunkt und anschließendem Bestand. Ältere Bewegungen lassen sich nachladen. Kasse und Super-Admin können das vollständige Logbuch als CSV exportieren.
- Kasse und Super-Admin dürfen alle Belege und Unterschriften prüfen; Trainer und Jugendleiter ausschließlich ihre eigenen. Andere Zugänge sehen die Bewegungen, aber keine fremden Belegbilder.

Der Safe wird mechanisch geöffnet. Die App steuert kein Schloss. Der Hinweis zum Safe kann in der Verwaltung geändert werden und ist für alle Kassenbuchzugänge sichtbar.

Der Anfangsbestand ist **0 €**. Bereits vorhandenes Bargeld muss beim Start gezählt und als erste Einzahlung mit Foto erfasst werden.

Trainer und Jugendleiter können ihre eigenen aktuellen Einträge **bearbeiten** oder **löschen**. Bearbeiten erlaubt Betrag, eigene Mannschaft, Verwendungszweck und optional ein neues Quittungsfoto. Ein Grund, eine neue Unterschrift und die Bestätigung des tatsächlichen Bargeldbestands sind erforderlich. Nur die Differenz zum bisherigen Auszahlungsbetrag wird gebucht. Bei einer Verringerung muss bereits entnommenes Geld zurück in den Safe; bei einer Erhöhung wird die Differenz zusätzlich entnommen.

**Löschen** storniert die zuletzt gültige Entnahme vollständig. Bereits entnommenes Geld muss zurückgelegt werden; irrtümlich erfasste, gar nicht ausgeführte Entnahmen können ebenfalls storniert werden. Originale, frühere Korrekturen, Belege, Gründe und Zeitpunkte bleiben unveränderlich im Logbuch und im CSV-Export. Nach einer Änderung ist nur die neueste Fassung bearbeitbar; nach einem Storno keine. Fremde Einträge und Einzahlungen sind von diesen Traineraktionen ausgeschlossen. Der serverseitig gespeicherte Suite-Benutzer schützt die Urheberschaft auch bei einer späteren Profil-Neuzuordnung. Unsichere Netzwerkantworten lassen sich mit denselben Angaben erneut prüfen, ohne doppelte Geldbewegung.

## Zugänge und Import

Die Migration übernimmt die Trainerfunktionen aus `social_team_people`, einschließlich Co-Trainern und Fitnesscoaches. Standardmäßig freigeschaltet sind die männlichen Mannschaften **U19 A, U17 B, U15 C1, U15 C2, U13 D1, U13 D2 und U13 D3**. Die Einstellung ist unabhängig von der Social-Media-Veröffentlichung. Weitere Mannschaften können ausdrücklich freigeschaltet und anschließend importiert werden.

Die Jugendleiter **Jérôme Ernsberger** und **Ole Schmal** werden aus den aktiven Jugendleitungsrollen in `private.referee_club_roles` übernommen, auch ohne Trainerzuordnung. Sie können Entnahmen für alle freigeschalteten Mannschaften erfassen. Trainer haben Zugriff auf ihre eigenen Mannschaften. Wer beide Funktionen hat, erhält einen einzigen Zugang. Rollenentzug und gesperrte Mannschaften werden bei jedem Zugriff berücksichtigt.

Zusätzlich werden die vorhandenen Personen **Wiebke Baronner-Dieterle** und **Claudia Gastaudo** als Kasse angelegt. Geburtsdaten können optional im vorhandenen Personenverzeichnis ergänzt werden; für neue Benutzerzugänge sind sie nicht erforderlich. Die Verwaltung kann Personen aus dem Vereinsverzeichnis ergänzen, Rollen vergeben und Zugänge sperren.

Das Login besteht aus den ersten vier Buchstaben des Nachnamens und dem ersten Buchstaben des Vornamens, in Kleinbuchstaben. Umlaute werden zu `a`, `o`, `u`, `ß` zu `ss`; Leerzeichen und Bindestriche entfallen. Beispiele: `jentm` für Michael Jentsch, `barow` für Wiebke Baronner-Dieterle und `gastc` für Claudia Gastaudo. Beim Anlegen eines **neuen** Suite-Zugangs lautet das Startpasswort `bsv1956`; ein Geburtsdatum ist dafür nicht erforderlich. Danach lässt sich das gemeinsame Passwort im Suite-Profil ändern. Bereits vorhandene Suite-Benutzer behalten ihre Zugangsdaten und Passwörter. Bei identischen Kürzeln meldet der Import die Kollision; der Super-Admin vergibt über **Zugang ergänzen** ein eindeutiges Login.

Der Import legt zunächst Kassenprofile an. Ordne diesen unter **Suite-Benutzer** vorhandene Benutzer zu; dabei wird das Bereichsrecht ergänzt und andere Freigaben bleiben erhalten. **Fehlende Suite-Zugänge anlegen** erstellt für aktive, noch nicht zugeordnete Personen normale Supabase-Auth-Benutzer mit ausschließlich `cashbook`. Der neue Benutzer verwendet zum Anmelden das Kürzel; eine stabile interne E-Mail-Adresse dient nur als technische Auth-Identität und empfängt keine Nachrichten. Fehler werden gemeldet; fehlende Geburtstage verhindern die Kontoanlage nicht. Wiederholungen verwenden dieselbe interne Identität. Vor dem Anlegen vorhandene Benutzer zuordnen, damit kein zweiter Suite-Zugang entsteht.

Der gemeinsame Login akzeptiert E-Mail oder Kürzel und Passwort. Das Kürzel wird serverseitig zur zugeordneten Auth-Identität aufgelöst; die Passwortprüfung und Sitzung stammen aus Supabase Auth. Fünf Alias-Anmeldeversuche innerhalb von 15 Minuten begrenzen weitere Versuche; erfolgreiche Passwortprüfungen setzen den Zähler zurück. Es gibt keine zweite Kassen-Sitzung und keinen Geburtstagsvergleich bei laufenden Anmeldungen. Loginantworten enthalten keine Geburtstage oder internen E-Mail-Adressen.

Die Benutzerverwaltung zeigt für verknüpfte Kassenbuchzugänge Personenname, Login-Kürzel und Kassenrolle. Technische Adressen mit `cashbook-…@suite.bsvnordstern.invalid` erscheinen nicht als Anzeigename oder E-Mail in der Oberfläche. Die Anzeige wird anhand der gespeicherten Suite-Zuordnung aus dem Vereinsverzeichnis ergänzt; Anmeldedaten und Bereichsrechte werden dadurch nicht verändert. Auch die Benutzer-Auswahl in der Kassenverwaltung nutzt Name und Login. Der Filter findet Namen, Kürzel, tatsächliche E-Mail-Adressen und Rollen. Zum endgültigen Löschen eines Benutzerzugangs wird das sichtbare Login bestätigt.

Das Suite-Bereichsrecht bestimmt den Zugriff, das zugeordnete Kassenprofil die Buchungsrolle. Benutzer mit Bereichsrecht, aber ohne Kassenprofil, können nur den Bestand und die Bewegungen lesen; sie können weder buchen noch fremde Belegbilder öffnen. Super-Admins ohne Kassenprofil können zusätzlich Belege prüfen und exportieren. Bereichsentzug, Suite-Sperre, Kassenprofil-Sperre, Personenstatus und aktuelle Mannschaftszuordnung werden bei jedem Zugriff serverseitig neu geprüft. Das Löschen eines Suite-Benutzers löst seine Profilzuordnung; bestehende Geldbewegungen bleiben erhalten.

## Auffüll-Mail

Unter **50,00 €** wird eine E-Mail an **jugendkasse@bsvnordstern.de** vorgemerkt, mit der Bitte an Wiebke, den Safe aufzufüllen. Genau 50 € lösen keine Erinnerung aus. Weitere Bewegungen unter der Grenze erzeugen keine neuen Erinnerungen, bis eine Auffüllung auf mindestens 50 € erfolgt ist.

Der Cron `bsv-cashbook-alerts` verarbeitet die Versandwarteschlange alle fünf Minuten, unabhängig von geöffneten Browsern. Fehlgeschlagene Zustellungen bleiben gespeichert und werden erneut versucht. Die Verwaltung zeigt Versandzeitpunkte und ausstehende Versuche. Der Versand nutzt den vorhandenen Resend-Schlüssel sowie `CASHBOOK_FROM`, ersatzweise `NEWSLETTER_FROM`. Ein stabiler Idempotenzschlüssel schützt Wiederholungen beim Mailanbieter im Rahmen dessen [Idempotenz-Regeln](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Daten und Installation

Anmelde-Aliase werden über das Suite-Benutzerverzeichnis aufgelöst; es werden keine zusätzlichen Leserechte auf `auth.users` vergeben. Alle Kassenbuchtabellen liegen im Schema `private`, mit RLS und ohne Browserrechte. Die öffentlichen RPC-Namen sind ausschließlich für `service_role` ausführbar; Trainer erhalten keine Supabase-Adminberechtigung. Ein Datenbank-Lock serialisiert Bestandsprüfung, Buchung und Schwellenübergang. Jede Buchung hat eine stabile Anfrage-ID für sichere Wiederholungen; eine bereits gebuchte identische Schiriquittung wird zusätzlich über ihren SHA-256-Hash erkannt.

Belegfotos und Unterschriften liegen unveränderlich im privaten Bucket `cashbook-evidence`. Die API gibt nach Berechtigungsprüfung zwei Minuten gültige Bildlinks aus. Der Ansatz folgt den [Supabase Storage-Zugriffsregeln](https://supabase.com/docs/guides/storage/security/access-control). Fehlgeschlagene Buchungen können unverknüpfte Uploads hinterlassen; es gibt bewusst keine automatische Löschung, die bestätigte Belege gefährden könnte.

Das Web-App-Manifest enthält separate PNG-Icons, den gemeinsamen Suite-Scope `/` und die Darstellung `standalone`. Die sichtbare Schaltfläche **App installieren** steht auf der Loginseite, in der Suite-Navigation und im Kassenbuch der Jugendabteilung bereit. Unterstützt der Browser die direkte Installation, öffnet sie dessen Installationsdialog. Sonst zeigt sie passende Schritte für Android, iPhone/iPad oder Desktop an. Auf dem iPhone funktioniert **Safari → Teilen → Zum Home-Bildschirm**. In der bereits als App geöffneten Suite werden die Installationsschaltflächen ausgeblendet. Die [Installationsvoraussetzungen](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) erfordern im Onlinebetrieb HTTPS. Der Service Worker speichert ausschließlich eine öffentliche Offline-Hinweisseite. Bestände, Belege und API-Antworten werden nicht offline zwischengespeichert; Buchungen benötigen Internet.

## Bereitstellung

1. Migrationen `20261009110737_cashbook.sql`, `20261009141432_cashbook_suite_identity_lookup.sql` und `20261009182055_cashbook_own_entry_changes.sql` auf die bestehende Datenbank anwenden. Die zweite Migration vermeidet direkte Auth-Tabellenzugriffe durch `service_role`; die dritte ergänzt nachvollziehbare Trainerkorrekturen und Stornos. Kontoexistenz wird durch den Fremdschlüssel und die zugehörige Auth-API geprüft. Die bisherigen Vereinsverzeichnis-Migrationen sowie `20260927214316_referee_club_roles.sql` müssen vorhanden sein; Cron, `pg_net` und der Vault-Eintrag `social_worker_cron_secret` stammen aus der vorhandenen Automatik.
2. Edge Functions `suite-auth`, `cashbook-alerts` und `social-media-admin-api` bereitstellen. Konfiguration und bestehender GitHub-Deployment-Workflow sind erweitert.
3. Supabase-Secrets prüfen: `RESEND_API_KEY`, `SOCIAL_WORKER_CRON_SECRET` passend zum Vault-Eintrag und ein verifizierter Resend-Absender in `CASHBOOK_FROM` oder `NEWSLETTER_FROM`.
4. `npm run build` ausführen und die neue Version der bestehenden Suite bereitstellen. Der Worker liefert die gemeinsame Suite, Manifest, Icons und `/suite-sw.js` aus. Es gibt keine separate Kassen-Loginseite.
5. Importliste, vorhandene Suite-Zuordnungen und Mannschaftszuordnungen prüfen, neue Suite-Benutzer anlegen, den realen Anfangsbestand erfassen und einen vollständigen Ablauf mit Kasse und Trainer kontrollieren.

Die Umsetzung verändert beim lokalen Build keine Online-Daten und veröffentlicht keine Website. Live-Migration, Deployment und echte E-Mail-Zustellung müssen bei der Aktivierung geprüft werden.

## Prüfung und lokale Vorschau

```bash
npm run check
npm run test:cashbook:db
npm run build
PREVIEW_PORT=4182 node scripts/preview-editorial.mjs
```

Die Datenbanktests starten einen isolierten PostgreSQL-17-Dockercontainer und entfernen ihn anschließend. Sie prüfen unter anderem den Import mit dem Vereinsverzeichnis, frische Suite-Berechtigungen, Profilzuordnungen, Alias-Anmeldelimits, Wiederholungen, die 50-Euro-Grenze und zwei gleichzeitige Entnahmen. Optional aktiviert `CASHBOOK_DB_ADVISORS=1 npm run test:cashbook:db` die Supabase-Advisors auf dieser Testdatenbank.

Unter `http://localhost:4182/` gibt es ausschließlich Beispieldaten. Die Links im Vorschauhinweis wechseln zwischen **Trainer (nur Kasse)**, **Kasse**, **Jugendleitung** und **Super-Admin**. **Login testen** öffnet den gemeinsamen Anmeldedialog: Trainer `mustm`, Kasse `kassw`, Jugendleitung `beisj` oder Super-Admin `admin`; Startpasswort jeweils `bsv1956`. Unter **Profil** lässt sich ein eigenes Passwort mit mindestens 10 Zeichen setzen; die lokale Vorschau merkt sich die Änderung für diesen Browser-Tab. Die Jugendleitungs-Vorschau enthält eine C1- und eine D1-Mannschaft zur Auswahl. Es werden keine echten Geldbewegungen und keine E-Mails ausgelöst.
