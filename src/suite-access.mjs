export const SUITE_AREAS=['social_media','social_media_admin','sponsoring','editorial','referees','corporate_identity','club_crests','trainer_management','trainer_compensation','trainer_contracts','hall_training','resources','cashbook','user_management'];
export const SUITE_AREA_LABELS={social_media:'Social Media',social_media_admin:'Social Media · Administration',sponsoring:'Sponsoring',editorial:'Stadionheft & Newsletter',stadium:'Stadionheft',newsletter:'Newsletter',referees:'Schiedsrichter',corporate_identity:'Corporate Identity',club_crests:'Vereinswappen',trainer_management:'Mitarbeiter',trainer_compensation:'Trainergehälter',trainer_contracts:'Trainerverträge',resources:'Ressourcenverwaltung',hall_training:'Hallentraining',cashbook:'Kassenbuch',user_management:'Benutzerverwaltung'};
export function suitePermissionArea(area){return ['stadium','newsletter'].includes(area)?'editorial':area;}
// Count sidebar functions, with Social Media administration inside its parent.
export function suiteNavigationAreas(areas=[]){
 const allowed=new Set(areas.filter(area=>SUITE_AREAS.includes(area)));
 return ['corporate_identity','sponsoring','social_media','editorial','club_crests','trainer_management','trainer_compensation','trainer_contracts','hall_training','resources','referees','cashbook','user_management']
  .map(area=>area==='social_media'&&!allowed.has(area)&&allowed.has('social_media_admin')?'social_media_admin':area)
  .filter(area=>allowed.has(area))
  .flatMap(area=>area==='editorial'?['stadium','newsletter']:[area]);
}
export function suiteStartArea(areas=[],requested=''){
 const navigation=suiteNavigationAreas(areas);
 if(!navigation.length)return '';
 if(requested==='editorial')requested='stadium';
 const permission=suitePermissionArea(requested);
 if(SUITE_AREAS.includes(permission)&&areas.includes(permission))return requested;
 if(requested==='social_media'&&areas.includes('social_media_admin'))return 'social_media_admin';
 return navigation.length===1?navigation[0]:'welcome';
}
export const SUITE_ROLE_SEEDS=[
 {key:'admin',label:'Super-Admin',access_areas:[...SUITE_AREAS],protected:true},
 {key:'user',label:'Benutzer',access_areas:['social_media']},
 {key:'trainer',label:'Trainer',access_areas:['hall_training','resources']},
 {key:'cashier',label:'Kasse',access_areas:['cashbook']},
 {key:'youth-leadership',label:'Jugendleitung',access_areas:['cashbook','trainer_management','hall_training','resources']},
 {key:'referee-admin',label:'Schiedsrichteradmin',access_areas:['referees']},
 {key:'sponsoring',label:'Sponsorenverwaltung',access_areas:['sponsoring']},
];
export function suiteMemberRights(member,roles){
 const role=roles.find(role=>role.key===member.suite_role_key);
 const inherited=role?.key==='admin'?[...SUITE_AREAS]:(role?.access_areas||[]);
 const extra=(member.extra_access_areas||[]).filter(area=>SUITE_AREAS.includes(area)&&area!=='user_management'&&!inherited.includes(area));
 return {inherited,extra,effective:[...new Set([...inherited,...extra])]};
}
export function validateSuitePerson(body,{allowShared=false}={}){
 const firstName=String(body.firstName||'').trim(),lastName=String(body.lastName||'').trim(),username=String(body.username||'').trim().toLowerCase();
 if(((!firstName||!lastName)&&!(allowShared&&!firstName&&!lastName))||firstName.length>80||lastName.length>100||!/^[a-z]{2,30}$/.test(username))throw new Error('Bitte Vorname, Nachname und ein Login aus 2 bis 30 Buchstaben eingeben.');
 return {...body,firstName,lastName,username};
}
