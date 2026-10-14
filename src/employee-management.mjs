export const EMPLOYEE_GROUPS=[
 {key:'executive',label:'Geschäftsvorstandschaft',description:'Geschäftsführender Vorstand · § 13 der Satzung'},
 {key:'board',label:'Vorstandschaft',description:'Erweiterter Vorstand und weitere Vereinsaufgaben · § 14 der Satzung'},
 {key:'trainers',label:'Trainer',description:'Personendaten und Trainerrollen'},
 {key:'teams',label:'Mannschaften',description:'Trainerteams, Mannschaftsbilder und Kontakte'},
 {key:'youth',label:'Jugendausschuss',description:'Jugendleitung und Vertretung der Vereinsjugend · § 17 der Satzung'},
 {key:'supporters',label:'Förderverein',description:'Vorstandschaft und Unterstützer des Fördervereins'},
];
export const EMPLOYEE_PHOTO_BUCKET='employee-portraits';
const uuid=value=>/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value||'');
export function validateEmployeeAssignment(body){
 const id=body.assignmentId||null,version=Number(body.version),groupKey=body.groupKey,roleLabel=String(body.roleLabel||'').trim(),personId=body.personId||null;
 if(id&&!uuid(id)||!Number.isSafeInteger(version)||version<(id?1:0)||!EMPLOYEE_GROUPS.some(g=>g.key===groupKey&&!['trainers','teams'].includes(g.key))||!roleLabel||roleLabel.length>100||personId&&!uuid(personId))throw new Error('Bitte Personenkreis, Rolle und Person prüfen.');
 const firstName=String(body.firstName||'').trim(),lastName=String(body.lastName||'').trim();
 if(!personId&&(firstName||lastName)&&(!firstName||!lastName||firstName.length>80||lastName.length>100))throw new Error('Bitte Vor- und Nachname eingeben.');
 return {assignmentId:id,version,groupKey,roleLabel,personId,firstName,lastName};
}
export function validateEmployeePhoto(body){
 if(!uuid(body.personId)||!/^role-[a-f\d-]{36}$/i.test(body.roleKey||'')||!Number.isSafeInteger(body.version)||body.version<1)throw new Error('Bitte eine gespeicherte Rolle auswählen und neu laden.');
 return {personId:body.personId,roleKey:body.roleKey,version:body.version};
}
export function validateEmployeeContact(body){
 const personId=body.personId,version=Number(body.version),contactSource=body.contactSource;
 const email=String(body.email||'').trim().toLowerCase(),phone=String(body.phone||'').trim(),mobile=String(body.mobile||'').trim();
 if(!uuid(personId)||!Number.isSafeInteger(version)||version<0||!['employee','trainer'].includes(contactSource)||email.length>254||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||[phone,mobile].some(v=>v&&(!/^[+\d ()/.-]{3,50}$/.test(v))))throw new Error('Bitte E-Mail-Adresse und Telefonnummern prüfen.');
 return {personId,version,contactSource,email,phone,mobile,publicPhone:body.publicPhone===true};
}
