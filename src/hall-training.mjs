export const HALL_TRAINING_DATES=['2026-11-07','2026-11-21','2026-11-28','2026-12-05','2026-12-12','2026-12-19','2027-01-17','2027-01-24','2027-01-31'];
export function hallTime(minutes){return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}
export function hallMinutes(value){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))throw new Error('Bitte eine gültige Uhrzeit eingeben.');
 const [hours,minutes]=value.split(':').map(Number);return hours*60+minutes;
}
export function validateHallDay(body){
 const date=String(body.date||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Bitte ein gültiges Datum auswählen.');
 const startMinute=hallMinutes(body.start),endMinute=hallMinutes(body.end),blockMinutes=Number(body.blockMinutes);
 if(!Number.isInteger(blockMinutes)||blockMinutes<15||blockMinutes>720||endMinute<=startMinute||(endMinute-startMinute)%blockMinutes!==0)throw new Error('Die Blocklänge muss zwischen 15 und 720 Minuten liegen und den Zeitraum vollständig aufteilen.');
 if(body.dayId&&!/^[a-f\d-]{36}$/i.test(body.dayId))throw new Error('Ungültiger Trainingstag.');
 if(body.dayId&&(!Number.isSafeInteger(body.version)||body.version<1))throw new Error('Bitte den Trainingstag neu laden.');
 return {dayId:body.dayId||null,version:body.version||0,date,startMinute,endMinute,blockMinutes};
}
