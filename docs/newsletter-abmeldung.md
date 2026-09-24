# Newsletter-Abmeldung

Der Footer neuer Suite-Newsletter führt auf `/newsletter/abmelden`. Erst **Abmeldung bestätigen** öffnet den persönlichen Abmeldelink von Resend. Danach bestätigt Resend den geänderten Abonnentenstatus; ein signierter Webhook veranlasst die deutsche Bestätigungsmail. Resend bleibt die maßgebliche Empfängerverwaltung. Die Website-Anmeldung wird in ihrem eigenen Projekt gepflegt.

## Ablauf und Vorschau

1. Der HTML-/Text-Export enthält `https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/newsletter/abmelden#{{{RESEND_UNSUBSCRIBE_URL}}}`. Resend ersetzt den Platzhalter beim Broadcast-Versand pro Empfänger.
2. Die Suite-Seite liest den persönlichen Link aus dem URL-Fragment. Er wird nicht an den Suite-Server übertragen. Beim Öffnen lädt die Seite weder den Link noch weitere externe Ressourcen. Sie benötigt keine Anmeldung und keine erneute Eingabe der E-Mail-Adresse.
3. **Abmeldung bestätigen** öffnet den HTTPS-Link von Resend. Die Seite akzeptiert ausschließlich `resend.com` und dessen Subdomains. **Newsletter behalten** führt zur Vereinswebsite, ohne den Abmeldelink aufzurufen.
4. Nach erfolgter Abmeldung erhält `newsletter-unsubscribe-webhook` das Resend-Ereignis `contact.updated` mit `unsubscribed: true` für einen Kontakt des Segments **Nordstern Post**.
5. Nach Prüfung der Signatur, des Segments und des aktuellen Resend-Status sendet die Funktion eine sachliche E-Mail: **Nordstern Post: Deine Abmeldung ist bestätigt**. Sie enthält keine Werbung und keinen erneuten Anmeldeaufruf.

Unter **Redaktion → Newsletter → Abmeldung & Bestätigungsmail ansehen** ist der vollständige Ablauf gefahrlos demonstrierbar. `?vorschau=1` simuliert die Bestätigung und zeigt die Mail; es gibt dabei keine Abmeldung und keinen Versand. Der Abmeldelink einer E-Mail-Vorschau verwendet ebenfalls diese Demonstration. Exportierte Versanddateien verwenden dagegen den individuellen Resend-Platzhalter. In der lokalen Vorschau: `http://localhost:4197/newsletter/abmelden?vorschau=1`.

Der in Mailprogrammen separat angebotene Abmeldeknopf (List-Unsubscribe) bleibt bei Resend. Eine dort erfolgte globale Abmeldung löst dieselbe Bestätigungsmail aus. Der hier ergänzte Bestätigungsschritt gilt für den Link im Newsletter-Inhalt. Bereits versendete Newsletter und die historischen Archivdateien werden nicht verändert.

## Bereitstellung

Am 24.09.2026 wurden die Migration und die Edge Function im Suite-Projekt bereitgestellt, die benötigten Secrets gesetzt und der Resend-Webhook `d63c213c-221f-4502-90c7-c028396c40c1` für `contact.updated` aktiviert. Der Live-Endpunkt nahm einen korrekt signierten, wirkungslosen Prüfaufruf mit HTTP 200 an und wies einen unsignierten Aufruf mit HTTP 400 ab. Bei der Freigabe wurden keine Abonnenten geändert und keine E-Mails verschickt.

Produktionsadresse der Bestätigungsseite: `https://bsv-story-automatik.jerome-ernsberger.chatgpt.site/newsletter/abmelden`. Die folgende Liste dokumentiert die Einrichtung und kann bei einer erneuten Bereitstellung verwendet werden.

1. Migration `supabase/migrations/20260924150101_newsletter_unsubscribe_receipts.sql` im Suite-Projekt anwenden.
2. Die Funktion `newsletter-unsubscribe-webhook` bereitstellen. `verify_jwt=false` ist erforderlich, da Resend mit einer eigenen Svix-Signatur authentifiziert. Die Signatur wird vor jedem Datenbankzugriff geprüft. `index.ts` pinnt `@supabase/server@1.4.1` und `svix@2.5.0`; `deno.lock` liegt bei der Funktion.
3. In Resend einen Webhook für **contact.updated** auf `https://maejihwjzxkmthjavgnx.supabase.co/functions/v1/newsletter-unsubscribe-webhook` einrichten.
4. Die folgenden Werte ausschließlich als Supabase Edge Secrets setzen:

| Secret | Bedeutung |
| --- | --- |
| `RESEND_API_KEY` | Schlüssel mit Zugriff auf Kontakte, Segmente und E-Mail-Versand |
| `RESEND_NEWSLETTER_WEBHOOK_SECRET` | Signatur-Secret dieses Webhooks (`whsec_…`) |
| `NEWSLETTER_FROM` | Verifizierter Absender; Standard `BSV Nordstern Radolfzell <info@bsvnordstern.de>` |
| `NEWSLETTER_RESEND_SEGMENT_ID` | Standard `76a53fca-4c76-40a7-8c56-404806f88364` für Nordstern Post |
| `NEWSLETTER_UNSUBSCRIBE_EMAIL_ENABLED` | Erst nach Konfiguration ausdrücklich `true` setzen |

5. Den Suite-Build mit der Bestätigungsseite veröffentlichen. Erst anschließend neue Exporte dieses Builds verwenden.
6. Mit einem ausdrücklich dafür vorgesehenen Testkontakt einen echten Broadcast einschließlich Linkersetzung und Abmeldung prüfen. Das bloße Öffnen der Suite-Seite darf den Kontakt nicht ändern; nach Bestätigung muss Resend `unsubscribed: true` melden und genau eine Bestätigungsmail senden. Dieser Live-Test wurde nicht durchgeführt.

Der Dienst bezieht sich auf den bisherigen Nordstern-Post-Broadcast ohne Topic. Ein künftiger Wechsel auf Topic-spezifische Abmeldungen braucht zusätzlich deren Statusereignisse; ein Topic-Opt-out ist nicht mit `unsubscribed: true` gleichzusetzen. Die Website-Abmeldung per Entfernung aus dem Segment besitzt einen eigenen Ablauf und darf nicht gleichzeitig eine zweite Bestätigung für dieselbe globale Abmeldung versenden.

## Wiederholungen und Fehler

`newsletter_unsubscribe_receipts` speichert nur Kontakt-ID, Status, Zeitpunkte, eine Benachrichtigungs-ID und die Versand-ID. E-Mail-Adressen, persönliche Abmeldelinks und vollständige Webhook-Inhalte werden dort nicht gespeichert. RLS und explizite Rechte begrenzen den Zugriff auf die Service-Rolle.

Ein atomarer Claim und eine zweiminütige Sperre verhindern gleichzeitige Bearbeitung. Wiederholte `unsubscribed: true`-Meldungen versenden keine weiteren Bestätigungen. Ein späteres, neueres `unsubscribed: false`-Ereignis erlaubt eine neue Bestätigung bei erneuter Abmeldung; verspätete ältere Ereignisse werden ignoriert. Vor dem Versand wird der aktuelle Kontakt nochmals bei Resend gelesen. Gelöschte oder inzwischen wieder abonnierte Kontakte erhalten keine verspätete Abmeldebestätigung.

Bei einem temporären Fehler antwortet der Webhook mit 503; Resend wiederholt die Zustellung. Jeder Versandversuch derselben Benachrichtigung verwendet denselben Idempotency-Key. Nach 23 Stunden ohne eindeutig gespeicherten Abschluss wird `needs_review` gesetzt und weiterhin ein Fehler gemeldet. Damit wird ein möglicherweise bereits erfolgter Versand nach Ablauf von Resends 24-Stunden-Idempotenzfenster nicht wiederholt. In diesem Fall den Empfang/Versand im Resend-Protokoll prüfen, bevor ein Vorgang manuell erneut freigegeben wird. Die Abmeldung selbst bleibt wirksam, auch wenn die Bestätigungsmail verzögert ist.

## Verifikation

- 235 Node-Tests erfolgreich, einschließlich Linkvalidierung, Export/Vorschau, Signatur-Grenze, Empfängerauswahl, Duplikaten, Wiederholungen und Providerfehlern.
- Die Svix-Prüfung wurde zusätzlich mit echten lokal signierten Testnachrichten auf Manipulation und veraltete Zeitstempel geprüft. Deno-Typprüfung erfolgreich.
- Migration und `supabase/tests/newsletter_unsubscribe_receipts.sql` in isoliertem PostgreSQL 17 geprüft: Rechte, Sperren, wiederholte Ereignisse, erneute Abmeldung und Ablauf des Idempotenzfensters. Security Advisor ohne Befund.
- Browserprüfung von Bestätigungsseite, Mobilansicht, ungefährlicher Vorschau und Maildarstellung. Der Provider-Aufruf wurde abgefangen: kein Aufruf beim Öffnen, erst nach Bestätigung. Keine echten Kontaktdaten oder Mails verwendet.

Grundlagen: [Resend-Abmeldungen](https://resend.com/docs/dashboard/audiences/managing-unsubscribe-list), [contact.updated](https://resend.com/docs/webhooks/contacts/updated), [Webhook-Signaturen](https://resend.com/docs/webhooks/verify-webhooks-requests), [Wiederholungen](https://resend.com/docs/webhooks/retries-and-replays), [Idempotency-Keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
