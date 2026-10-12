import {SUITE_AREA_LABELS} from './suite-access.mjs';
export const SUITE_ACTIVITY_CATEGORIES={auth:'Anmeldung',cashbook:'Kassenbuch',trainer_management:'Trainerverwaltung',user_management:'Benutzerverwaltung'};
export const SUITE_ACTIVITY_EVENTS={login:'Angemeldet',session_opened:'Bestehende Sitzung geöffnet',cashbook_deposit:'Geld in den Safe eingezahlt',cashbook_withdrawal:'Geld aus dem Safe entnommen',cashbook_advance:'Geld vorgestreckt',cashbook_corrected:'Buchung korrigiert',cashbook_cancelled:'Buchung storniert',cashbook_transferred:'Überweisung bestätigt',cashbook_received:'Geldeingang bestätigt',trainer_created:'Trainer angelegt',trainer_updated:'Trainerdaten geändert',trainer_photo:'Trainerfoto geändert',trainer_team:'Mannschaftszuordnung geändert',trainer_deleted:'Trainer gelöscht',trainer_activated:'Trainer aktiviert',trainer_passive:'Trainer passiv geschaltet',trainer_onboarding:'Trainer-Onboarding übernommen',role_updated:'Rollenrechte geändert',user_created:'Benutzer angelegt',user_updated:'Personendaten / Rechte gespeichert',user_delete_prepared:'Benutzer zur Löschung gesperrt',user_deleted:'Benutzer gelöscht',user_activated:'Benutzer aktiviert',user_deactivated:'Benutzer deaktiviert',user_blocked:'Benutzer gesperrt',user_unblocked:'Benutzer entsperrt'};
export function suiteActivityMoney(cents){return Number.isFinite(cents)?new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100):'–';}
export function suiteActivityDetails(entry){
 const m=entry.metadata||{},parts=[];
 if(m.subjectName)parts.push(m.subjectName+(m.subjectLogin?' ('+m.subjectLogin+')':''));
 if(m.teamName)parts.push(m.teamName);
 if(m.bookingSequence)parts.push('Buchung #'+m.bookingSequence);
 if(Number.isFinite(m.previousAmountCents))parts.push('Vorher: '+suiteActivityMoney(m.previousAmountCents));
 if(Number.isFinite(m.balanceAfterCents))parts.push('Safe danach: '+suiteActivityMoney(m.balanceAfterCents));
 if(entry.event==='cashbook_advance')parts.push('Privat bezahlt · Safe-Bestand unverändert');
 if(Array.isArray(m.accessAreas))parts.push('Rechte: '+(m.accessAreas.map(area=>SUITE_AREA_LABELS[area]||area).join(', ')||'Keine'));
 return parts;
}
