# Stadionheft-Export

Die Edge Function `stadium-magazine-feed` versorgt das separate Projekt `bsv-stadionheft` mit freigegebenen Stadionheft-Anzeigen. Änderungen an der Sponsorenverwaltung oder ihrer Oberfläche waren dafür nicht erforderlich.

GET `/functions/v1/stadium-magazine-feed?date=YYYY-MM-DD` liefert Version, Heftdatum, Abrufzeit und Anzeigen. Erforderlich sind ein gültiges JWT im Authorization-Header (Gateway) und ein Publishable-Key im apikey-Header (`@supabase/server`, Auth-Modus `publishable`). Ohne Zugangsdaten wird die Anfrage abgewiesen. Andere Methoden und ungültige Datumsangaben werden abgelehnt.

Auswahl: Sponsor aktiv, Motivstatus `approved`, `logo_transparent_path` vorhanden, Laufzeit am angefragten Erscheinungstag gültig und mindestens eine Zuordnung vom Typ `stadionheft`. Ausgegeben werden nur ID, Slug, Name, Website, temporärer Motivlink, Aktualisierungsdatum sowie zugehörige Stadionheft-Formate und Zielgruppen. Vertragsdaten, Preise, Kontaktdaten, interne Notizen und andere Sponsorzuordnungen bleiben außerhalb der Antwort.

Die Motivlinks sind 15 Minuten gültig. Der Heft-Build lädt sie sofort herunter und speichert feste Bildversionen. `verify_jwt` bleibt aktiviert; Tabellen-RLS und Storage-Zugriffsregeln werden nicht geändert.
