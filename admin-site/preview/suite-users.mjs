import {SUITE_ROLE_SEEDS,suiteMemberRights,validateSuitePerson} from '/suite-access.mjs';
import {suiteBrandTheme} from '/brand-themes.mjs';
import {suiteBrandColors,SUITE_BRAND_DEFAULT} from '/suite-brand.mjs';
const key='bsv-suite-users-preview-v1';
const ids={mustm:'20000000-0000-4000-8000-000000000001',kassw:'20000000-0000-4000-8000-000000000002',beisj:'20000000-0000-4000-8000-000000000003',admin:'local-preview-admin',editorial:'local-preview-editorial'};
let data;try{data=JSON.parse(localStorage.getItem(key)||'null')}catch{}
data||={roles:structuredClone(SUITE_ROLE_SEEDS),brand:structuredClone(SUITE_BRAND_DEFAULT),members:[['mustm','Max','Mustermann','trainer'],['kassw','Wiebke','Beispiel','cashier'],['beisj','Julia','Beispiel','youth-leadership'],['admin','Anna','Administration','admin'],['editorial','Erika','Redaktion','user']].map(([username,first_name,last_name,suite_role_key])=>({user_id:ids[username],username,first_name,last_name,suite_role_key,role:suite_role_key==='admin'?'admin':'sm-team',email:`${username}@example.test`,is_active:true,is_blocked:false,extra_access_areas:username==='editorial'?['editorial','referees']:[],created_at:'2026-10-09T14:16:00Z'}))};
const save=()=>localStorage.setItem(key,JSON.stringify(data));
export function previewSuiteMembers(){return data.members.map(member=>({...member,display_name:member.first_name+' '+member.last_name,role_label:data.roles.find(r=>r.key===member.suite_role_key)?.label,access_areas:suiteMemberRights(member,data.roles).effective}));}
export function previewSuiteProfile(persona){const member=previewSuiteMembers().find(member=>member.username===persona);if(!member||!member.is_active||member.is_blocked)throw new Error('Dieser Zugang ist deaktiviert oder gesperrt.');const rights=suiteMemberRights(member,data.roles);return {userId:member.user_id,email:member.email,firstName:member.first_name,lastName:member.last_name,name:member.display_name,username:member.username,role:member.role,roleKey:member.suite_role_key,roleLabel:member.role_label,accessAreas:rights.effective,roleAreas:rights.inherited,extraAreas:rights.extra,birthDate:'1980-02-14',createdAt:member.created_at,teams:persona==='mustm'||persona==='beisj'?[{name:'U15 C1-Junioren (Beispiel)'}]:[]};}
export function previewSuiteRoles(){return structuredClone(data.roles)}
export function previewSuiteBrand(){return {color_scheme:structuredClone(data.brand),theme_key:data.theme||'football'}}
export async function previewSuiteMutation(body,persona){
 const self=previewSuiteProfile(persona);if(self.role!=='admin')throw new Error('Nur Super-Admins verwalten Benutzer und Rollen.');
 if(body.action==='save_suite_role'){const role=data.roles.find(role=>role.key===body.key);if(!role||role.protected||body.accessAreas.includes('user_management'))throw new Error('Diese Rolle ist geschützt.');role.access_areas=body.accessAreas;}
 else if(body.action==='save_suite_member'||body.action==='create_team_member'){
  const person=validateSuitePerson(body);if(body.userId===self.userId)throw new Error('Der eigene Zugang ist geschützt.');
  if(data.members.some(m=>m.username===person.username&&m.user_id!==person.userId))throw new Error('Dieses Login ist bereits vergeben.');
  let member=data.members.find(m=>m.user_id===person.userId);
  if(!member){if(body.action!=='create_team_member')throw new Error('Benutzer nicht gefunden.');member={user_id:crypto.randomUUID(),email:body.email||'',created_at:new Date().toISOString(),is_active:body.isActive!==false,is_blocked:false};data.members.push(member);}
  Object.assign(member,{first_name:person.firstName,last_name:person.lastName,username:person.username,suite_role_key:person.roleKey,role:person.roleKey==='admin'?'admin':'sm-team',extra_access_areas:person.extraAreas});
 } else if(body.action==='bulk_suite_users'){
  if(!body.userIds.length||body.userIds.includes(self.userId))throw new Error('Ungültige Auswahl.');
  if(body.operation==='delete')data.members=data.members.filter(member=>!body.userIds.includes(member.user_id));
  else for(const member of data.members.filter(member=>body.userIds.includes(member.user_id))){member.is_active=['activate','unblock'].includes(body.operation);member.is_blocked=body.operation==='block';}
 }else throw new Error('Unbekannte Benutzeraktion.');
 save();return {ok:true};
}
export function previewSetBrand(colorScheme,themeKey='football'){data.brand=suiteBrandColors(colorScheme);data.theme=suiteBrandTheme(themeKey);save();return {ok:true}}
