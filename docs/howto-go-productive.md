# How-to: Social Media Builder produktiv schalten

Stand: 18. August 2026

Diese Anleitung beschreibt den kontrollierten Wechsel vom Vorschau- in den Produktivbetrieb. Produktiv bedeutet hier: Freigegebene oder planmäßig fällige Inhalte werden nicht nur als Vorschau erzeugt, sondern über die Meta Graph API im Instagram-Konto des BSV Nordstern veröffentlicht.

> **Aktueller Status:** `INSTAGRAM_TEST_MODE` bleibt bis zum gezielten Live-Test `true`. Spiel-, Geburtstags- und freie Storys verwenden den Instagram-Medientyp `STORIES`; Feed-Beiträge und Carousels verwenden die Feed-Schnittstelle. Die Graph-API-Version ist zentral konfigurierbar und verwendet standardmäßig `v26.0`. Vor dem Produktivbetrieb fehlt nur noch der echte API-Test mit `bsv.testaccount`.

## 1. Gewünschte Veröffentlichungsarten

| Inhalt | Instagram-Ziel | Freigabe |
| --- | --- | --- |
| Spielankündigung | Story | automatisch 24 Stunden vor Anpfiff |
| Aufstellung | Story | nur mit freigegebener Aufstellung, 30 Minuten vor Anpfiff |
| Ergebnis | Story | nach dem Speichern des Ergebnisses |
| Geburtstag | Story | automatisch, aber nur mit vorhandenem Personenbild |
| Spielbericht | Feed-Beitrag oder Carousel | immer manuell freigeben |
| Freier Beitrag | Feed-Beitrag oder Carousel | immer manuell freigeben |

## 2. Technische Voraussetzungen vor dem ersten Live-Test

Diese Punkte müssen im Code abgeschlossen und getestet sein:

- [x] Eigener Publisher für Instagram Stories mit dem dafür vorgesehenen Meta-Medientyp.
- [x] Spielankündigung, Aufstellung, Ergebnis und Geburtstag verwenden durchgehend den Story-Publisher.
- [x] Spielbericht und freie Beiträge verwenden weiterhin Feed-Bilder oder Carousels.
- [x] Unterstützte Meta-Graph-API-Version zentral konfigurieren; Standard ist `v26.0`.
- [x] Status eines Mediencontainers vor `media_publish` prüfen und vorübergehende Fehler mit begrenzten Wiederholungen behandeln.
- [x] Im Social Media Builder den aktuellen Betriebsmodus deutlich als **Testbetrieb** oder **Produktivbetrieb** anzeigen.
- [x] Einen kontrollierten Verbindungstest für Instagram-Konto-ID, Token und Kontotyp bereitstellen.
- [x] Fehler von Meta mit Zeitpunkt, Job und verständlicher Fehlermeldung speichern und anzeigen.
- [x] Sicherstellen, dass die von Meta abgerufenen Bild-URLs von außen erreichbar und lange genug gültig sind; frisch gerenderte Medien erhalten eine sieben Tage gültige URL.
- [x] Publisher-Pfade für Einzelbild, Story und Carousel sowie das sichere Status-Polling automatisiert testen.

Erst wenn diese Liste vollständig erledigt ist, darf der eigentliche Live-Test beginnen.

## 3. Instagram und Meta vorbereiten

Die aktuelle Integration verwendet die Instagram API mit Facebook Login. Dafür werden benötigt:

1. Das BSV-Instagram-Konto ist ein **Business-Konto**. Creator- oder Privatkonten reichen für das automatische Veröffentlichen von Storys nicht aus.
2. Das Instagram-Business-Konto ist mit der richtigen Facebook-Seite verbunden.
3. Im [Meta for Developers Dashboard](https://developers.facebook.com/apps/) existiert eine Meta-App, vorzugsweise vom Typ Business.
4. Der Benutzer, der den Token erzeugt, darf die verbundene Facebook-Seite und das Instagram-Konto verwalten.
5. Die App beziehungsweise der Token besitzt mindestens diese Berechtigungen:

   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`

6. Für Konten, die nicht von den Rollen der Meta-App verwaltet werden, ist gegebenenfalls Advanced Access beziehungsweise eine Meta App Review erforderlich. Für ein eigenes, in der App hinterlegtes BSV-Konto kann je nach Meta-Konfiguration Standard Access ausreichen.

Die offiziellen Voraussetzungen und Beispiele stehen in der [Instagram-API-Dokumentation von Meta](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00).

### Testkonto `bsv.testaccount`

Für dieses Projekt muss `bsv.testaccount` vor dem ersten Test so vorbereitet sein:

1. Das Konto ist in Instagram als **Business-Konto** eingerichtet. Für Story-Publishing reicht ein privates Konto nicht; für diesen Test sollte auch kein Creator-Konto verwendet werden.
2. `bsv.testaccount` ist mit einer eigenen Facebook-Seite verbunden. Die Verknüpfung erfolgt in Instagram unter **Profil bearbeiten → Öffentliche Unternehmensinformationen → Seite**.
3. Der Facebook-Benutzer, der den Token erzeugt, hat Zugriff auf diese Seite und verwaltet `bsv.testaccount`.
4. Dieser Benutzer ist in der Meta-App als Administrator, Entwickler oder Tester hinterlegt und hat die Einladung angenommen. Für einen Test im Entwicklungsmodus müssen sowohl App-Rolle als auch Zugriff auf das professionelle Instagram-Konto vorhanden sein.
5. Der erzeugte Token enthält `pages_show_list`, `pages_read_engagement`, `instagram_basic` und `instagram_content_publish`.

Der Benutzername `bsv.testaccount` wird nicht als Secret eingetragen. Er dient nur dazu, bei der Kontoabfrage zu kontrollieren, dass wirklich das richtige Konto ausgewählt wurde.

## 4. Instagram-Konto-ID und Token ermitteln

Für die bestehende Facebook-Login-Integration wird zunächst ein User Access Token mit den erforderlichen Berechtigungen erzeugt. Anschließend können die verwalteten Seiten samt Instagram-Verknüpfung abgefragt werden:

```text
GET https://graph.facebook.com/<API-VERSION>/me/accounts
    ?fields=name,access_token,tasks,instagram_business_account{id,username}
    &access_token=<USER-ACCESS-TOKEN>
```

In der mit `bsv.testaccount` verbundenen Facebook-Seite werden zwei Werte benötigt:

- `instagram_business_account.username` muss exakt `bsv.testaccount` sein.
- `instagram_business_account.id` ist die numerische `INSTAGRAM_ACCOUNT_ID`.
- `access_token` der verbundenen Seite ist die Grundlage für `INSTAGRAM_ACCESS_TOKEN`.

Die Konto-ID ist eine numerische ID und **nicht** der Instagram-Benutzername. Token niemals in Chat, Screenshots, Git, Frontendcode oder Dokumentationen einfügen. Wenn ein Token nicht mehr sicher ist, muss er bei Meta widerrufen und ersetzt werden.

Vor dem Eintragen in Supabase den Token mit einem harmlosen Lesezugriff prüfen. Dabei müssen das richtige Instagram-Konto und die benötigten Berechtigungen zurückgegeben werden.

## 5. Supabase-Secrets setzen

Pfad im Dashboard:

**Supabase-Projekt `maejihwjzxkmthjavgnx` → Edge Functions → Secrets**

| Name | Wert im Test | Wert im Produktivbetrieb |
| --- | --- | --- |
| `INSTAGRAM_ACCOUNT_ID` | numerische ID von `bsv.testaccount` | ID des BSV-Instagram-Business-Kontos |
| `INSTAGRAM_ACCESS_TOKEN` | Seiten-Token der mit `bsv.testaccount` verbundenen Facebook-Seite | gültiger Seiten-Token des BSV-Kontos |
| `INSTAGRAM_TEST_MODE` | `true` | erst nach erfolgreichem Test `false` |
| `META_GRAPH_API_VERSION` | optional `v26.0` | optional `v26.0`; nur nach Prüfung ändern |
| `STORY_RENDER_ENDPOINT` | vorhandenen Wert beibehalten | vorhandenen Wert beibehalten |
| `STORY_RENDER_SECRET` | vorhandenen Wert beibehalten | vorhandenen Wert beibehalten |
| `SOCIAL_WORKER_CRON_SECRET` | vorhandenen Wert beibehalten | vorhandenen Wert beibehalten |

Supabase zeigt nach dem Speichern nur noch einen SHA-256-Digest, nicht den ursprünglichen Secret-Wert. Das ist normal. Secrets stehen Edge Functions nach dem Speichern sofort zur Verfügung; allein deshalb ist kein erneutes Deployment erforderlich. Siehe [Supabase: Environment Variables](https://supabase.com/docs/guides/functions/secrets).

Nach dem Speichern im Social Media Builder unter **Administration → Instagram** den erwarteten Namen `bsv.testaccount` eintragen und **Verbindung sicher prüfen** wählen. Der Test veröffentlicht nichts und zeigt niemals den Token an. Erfolgreich ist er nur, wenn Konto-ID, Benutzername und Kontotyp `BUSINESS` zusammenpassen.

## 6. Warteschlange vor jedem Umschalten prüfen

Der Worker läuft alle fünf Minuten. Sobald `INSTAGRAM_TEST_MODE=false` ist, können alle fälligen Jobs mit Status `pending` veröffentlicht werden. Deshalb muss vor dem Umschalten die Warteschlange geprüft werden.

Diese Abfrage ist rein lesend:

```sql
select queue, status, due_now, future
from (
  select
    'story'::text as queue,
    status,
    count(*) filter (where due_at <= now())::integer as due_now,
    count(*) filter (where due_at > now())::integer as future
  from public.social_story_jobs
  group by status

  union all

  select
    'post',
    status,
    count(*) filter (where due_at <= now())::integer,
    count(*) filter (where due_at > now())::integer
  from public.social_post_jobs
  group by status

  union all

  select
    'birthday',
    status,
    count(*) filter (where due_at <= now())::integer,
    count(*) filter (where due_at > now())::integer
  from public.social_birthday_jobs
  group by status

  union all

  select
    'independent_story',
    status,
    count(*) filter (where due_at <= now())::integer,
    count(*) filter (where due_at > now())::integer
  from public.social_independent_story_jobs
  group by status
) as queues
order by queue, status;
```

Vor dem Go-live:

- [ ] Es gibt keine unerwarteten fälligen `pending`-Jobs.
- [ ] Alle zukünftigen Spiele gehören tatsächlich in den Produktivbetrieb.
- [ ] Abgesagte oder Testspiele sind deaktiviert oder korrekt markiert.
- [ ] Geburtstage enthalten ein freigegebenes Bild und das richtige Datum.
- [ ] Bereits fertige Vorschauen wurden visuell kontrolliert.
- [ ] Nicht benötigte Testdaten wurden entfernt.

`preview_ready` wird nicht allein durch das Umschalten nachträglich veröffentlicht. Relevant sind vor allem fällige oder künftig fällig werdende Jobs mit Status `pending`.

## 7. Kontrollierter Test mit einem Meta-Testkonto

Der erste echte API-Test erfolgt mit `bsv.testaccount`, nicht mit dem öffentlichen BSV-Konto.

1. `bsv.testaccount` als Instagram-Business-Konto vorbereiten und mit einer Facebook-Seite verbinden.
2. Mit der oben beschriebenen Abfrage prüfen, dass `username` exakt `bsv.testaccount` ist.
3. Numerische Testkonto-ID und den zugehörigen Seiten-Token in Supabase eintragen. Token nicht im Browsercode, Git oder Chat speichern.
4. Unter **Administration → Instagram** den sicheren Verbindungstest erfolgreich ausführen.
5. Kontrollieren, dass der Social Media Builder **Testmodus** anzeigt.
6. Zuerst eine einzelne **freie Story** vorbereiten.
7. Den automatischen Worker-Cron vor dem Umschalten vorübergehend im Supabase-Dashboard deaktivieren, damit kein anderer Job dazwischenläuft.
8. Direkt vor dem Test nochmals prüfen, dass kein anderer `pending`-Job fällig ist.
9. `INSTAGRAM_TEST_MODE=false` setzen und ausschließlich den vorgesehenen Testjob ausführen.
10. Bei Instagram kontrollieren:

   - Story erscheint als Story, nicht im Feed.
   - Seitenverhältnis und Sicherheitszonen stimmen.
   - Carousel-Reihenfolge stimmt.
   - Bildqualität ist ausreichend.
   - Caption und Hashtag stimmen.
   - In der Datenbank steht der Job auf `published` und besitzt eine externe Beitrags-ID.

11. Sofort wieder `INSTAGRAM_TEST_MODE=true` setzen.
12. Worker-Cron wieder aktivieren.
13. Edge-Function-Logs und gespeicherte Jobfehler kontrollieren.

Der Test ist erst erfolgreich, wenn Story, Einzelbild und Carousel jeweils mindestens einmal korrekt veröffentlicht wurden.

## 8. Produktiv schalten

Nach erfolgreichem Test:

1. `INSTAGRAM_TEST_MODE` bleibt zunächst `true`.
2. `INSTAGRAM_ACCOUNT_ID` auf die ID des echten BSV-Kontos ändern.
3. `INSTAGRAM_ACCESS_TOKEN` auf den geprüften Token des echten BSV-Kontos ändern.
4. Verbindungstest im Social Media Builder durchführen.
5. Warteschlange und nächste Veröffentlichungszeiten erneut kontrollieren.
6. Verantwortliche Person im Social-Media-Team über Zeitpunkt und erste automatische Veröffentlichung informieren.
7. `INSTAGRAM_TEST_MODE=false` setzen.
8. Innerhalb der nächsten fünf Minuten Worker-Logs und Jobstatus beobachten.
9. Die erste Veröffentlichung direkt in Instagram prüfen.
10. Nach 24 Stunden kontrollieren, ob Fehler, Wiederholungen oder unerwartete Veröffentlichungen aufgetreten sind.

Nur der exakte Secret-Wert `false` aktiviert die Veröffentlichung. Fehlende, leere oder andere Werte müssen weiterhin als Testbetrieb behandelt werden.

## 9. Rückfallplan und Not-Aus

Bei einem Fehler gilt folgende Reihenfolge:

1. Sofort `INSTAGRAM_TEST_MODE=true` setzen. Das ist der zentrale Not-Aus-Schalter für weitere Instagram-Veröffentlichungen.
2. Bei Bedarf zusätzlich den Cron-Job `bsv-social-worker` im Supabase-Dashboard deaktivieren.
3. Betroffenen Job und Edge-Function-Logs prüfen.
4. Falsch veröffentlichte Inhalte manuell in Instagram entfernen.
5. Bei Verdacht auf einen kompromittierten Token den Token bei Meta widerrufen und in Supabase ersetzen.
6. Erst nach einem erneuten Test mit Testkonto wieder produktiv schalten.

Ein fehlgeschlagener Job darf höchstens begrenzt automatisch wiederholt werden. Er muss anschließend sichtbar auf `failed` stehen und darf nicht endlos erneut veröffentlichen.

## 10. Regelmäßige Betriebskontrollen

Mindestens monatlich und nach jeder größeren Änderung:

- Meta-Token und Berechtigungen prüfen.
- Unterstützte Graph-API-Version und Meta-Änderungen kontrollieren.
- Supabase Edge-Function-Logs auf Fehler prüfen.
- Cron-Jobs und ihre Zeitpläne prüfen.
- Offene Jobs mit `failed`, `needs_input` oder lange laufendem `rendering` prüfen.
- Lokale Bildauslese nach Browser- oder Tesseract-Aktualisierungen stichprobenartig prüfen.
- Supabase-Nutzung, Storage und ausgehenden Traffic kontrollieren.
- Zugang ausscheidender Mitglieder des Social-Media-Teams deaktivieren.
- Secrets bei Verdacht auf Offenlegung sofort rotieren.

## 11. Abnahmeprotokoll

Vor dem endgültigen Go-live sollten diese Angaben dokumentiert werden:

```text
Datum:
Verantwortliche Person:
Meta-App:
Instagram-Konto-ID (nur ID, kein Token):
Verwendete Graph-API-Version:
Story-Test erfolgreich:
Einzelbild-Test erfolgreich:
Carousel-Test erfolgreich:
Warteschlange geprüft:
Worker-Logs geprüft:
Not-Aus getestet:
Produktivschaltung freigegeben durch:
```

Keine Token, API-Schlüssel oder Supabase-Secret-Keys in das Abnahmeprotokoll eintragen.

## Referenzen

- [Meta: Instagram API](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)
- [Meta: Graph-API-Changelog](https://developers.facebook.com/docs/graph-api/changelog/)
- [Meta: Instagram-Konto mit einer Facebook-Seite verbinden](https://www.facebook.com/help/570895513091465)
- [Supabase: Edge-Function-Secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase: Edge Functions planen](https://supabase.com/docs/guides/functions/schedule-functions)
- [Technische Architektur](automation-architecture.md)
- [Corporate Design](corporate-design.md)
