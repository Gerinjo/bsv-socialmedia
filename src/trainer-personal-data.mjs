import {contractValidIban} from './trainer-contracts.mjs';

export const TRAINER_PERSONAL_FIELDS=['email','phone','mobile','street','postcode','city','birthDate','notes'];
export function validateTrainerPersonalDetails(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Bitte die privaten Trainerdaten prüfen.');
 const limits={email:254,phone:50,mobile:50,street:160,postcode:20,city:100,birthDate:10,notes:3000},result={};
 for(const key of TRAINER_PERSONAL_FIELDS){const s=value[key]??'';if(typeof s!=='string'||s.length>limits[key]||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)||key!=='notes'&&/[\r\n]/.test(s))throw new Error('Bitte die privaten Trainerdaten prüfen und Eingaben kürzen.');result[key]=s.trim();}
 result.email=result.email.toLowerCase();if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
 if([result.phone,result.mobile].some(s=>s&&!/^[+\d ()/.-]{3,50}$/.test(s)))throw new Error('Bitte gültige Telefonnummern eingeben.');
 if(result.birthDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate)||Number.isNaN(Date.parse(result.birthDate))||new Date(result.birthDate).toISOString().slice(0,10)!==result.birthDate||result.birthDate>new Date().toISOString().slice(0,10)||Number(result.birthDate.slice(0,4))<1900))throw new Error('Bitte ein gültiges Geburtsdatum eingeben.');
 result.bank={};for(const [key,max] of Object.entries({holder:160,iban:42,name:160,bic:11})){const s=value.bank?.[key]??'';if(typeof s!=='string'||s.length>max||/[\u0000-\u001f]/.test(s))throw new Error('Bitte die Bankverbindung prüfen.');result.bank[key]=s.trim();}
 result.bank.iban=result.bank.iban.replace(/[\s-]/g,'').toUpperCase();result.bank.bic=result.bank.bic.replace(/\s/g,'').toUpperCase();
 if(result.bank.iban&&!contractValidIban(result.bank.iban))throw new Error('Bitte eine gültige IBAN eingeben.');
 if(result.bank.bic&&!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(result.bank.bic))throw new Error('Bitte eine gültige BIC mit 8 oder 11 Zeichen eingeben.');return result;
}
