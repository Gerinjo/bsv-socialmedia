function createSuiteUsers({document:doc,request,getState,reload,notify}) {
 const selected=new Set(),drafts=new Map();let busy=false;
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const table=doc.querySelector('#teamMembersList'),footer=doc.querySelector('#memberActions');
 const dialog=doc.querySelector('#suiteMemberDialog'),form=doc.querySelector('#suiteMemberForm');
 const state=()=>getState();
 const icons={active:'<path d="m5 12 4 4L19 6"/>',inactive:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m9 9 6 6m0-6-6 6"/>',person:'<circle cx="9" cy="7" r="3"/><path d="M3 19v-2a6 6 0 0 1 10-4m2 3 5-5 2 2-5 5-3 1z"/>',save:'<path d="M5 3h12l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8"/>'};
 const icon=key=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg>`;
 const roleOptions=key=>state().roles.map(role=>`<option value="${esc(role.key)}" ${key===role.key?'selected':''}>${esc(role.label)}</option>`).join('');
 function snapshot(member){return {userId:member.user_id,firstName:member.first_name||'',lastName:member.last_name||'',username:member.username||suiteMemberPresentation(member).login,roleKey:member.suite_role_key||'user',extraAreas:[...(member.extra_access_areas||[])]};}
 function permissions(member,roleKey=member.suite_role_key){return suiteMemberRights({...member,suite_role_key:roleKey},state().roles);}
 function rightsCell(member,area,self){
  const rights=permissions(member),base=rights.inherited.includes(area),extra=rights.extra.includes(area);
  return `<td class="member-right-cell"><input type="checkbox" data-extra-area="${area}" ${base||extra?'checked':''} ${base||self?'disabled':''} title="${base?'Von der Rolle vorgegeben':'Persönliches Zusatzrecht'}" aria-label="${esc(SUITE_AREA_LABELS[area])} für ${esc(suiteMemberPresentation(member).name)}"></td>`;
 }
 function updateFooter(){
  const count=selected.size;doc.querySelector('#memberSelectedCount').textContent=count?`${count} ausgewählt`:'Keine Auswahl';
  footer.querySelectorAll('[data-member-bulk]').forEach(button=>button.disabled=busy||!count);
  doc.querySelector('#memberCreate').disabled=busy;
 }
 function visibleMembers(){
  const query=doc.querySelector('#memberSearch').value.trim().toLocaleLowerCase('de');
  return state().members.filter(member=>{const info=suiteMemberPresentation(member);return [info.name,info.login,info.email,info.role,member.is_blocked?'gesperrt':member.is_active?'aktiv':'deaktiviert'].join(' ').toLocaleLowerCase('de').includes(query);}).sort((a,b)=>suiteMemberPresentation(a).name.localeCompare(suiteMemberPresentation(b).name,'de'));
 }
 function render(){
  if(state().userRole!=='admin'){table.replaceChildren();footer.classList.add('hidden');return;}
  footer.classList.remove('hidden');
  const ids=new Set(state().members.map(m=>m.user_id));for(const id of selected)if(!ids.has(id))selected.delete(id);
  const members=visibleMembers(),areas=SUITE_AREAS.filter(area=>area!=='user_management');
  table.innerHTML=`<div class="member-table-scroll"><table class="suite-members-table suite-user-table"><caption class="visually-hidden">Benutzer, Rollen und Bereichsrechte</caption><thead><tr><th><input id="memberSelectAll" type="checkbox" aria-label="Alle sichtbaren Benutzer auswählen"></th><th class="member-status-cell"><span class="visually-hidden">Status</span></th><th>Vor- und Nachname / Login</th><th>Rolle</th>${areas.map(area=>`<th class="member-right-cell">${esc(SUITE_AREA_LABELS[area])}</th>`).join('')}<th class="member-tools-cell"><span class="visually-hidden">Bearbeiten und Speichern</span></th></tr></thead><tbody>${members.map(saved=>{
   const draft=drafts.get(saved.user_id),member=draft?{...saved,suite_role_key:draft.roleKey,extra_access_areas:draft.extraAreas}:saved;
   const info=suiteMemberPresentation(saved),self=member.user_id===state().userId;
   const active=member.is_active&&!member.is_blocked,status=member.is_blocked?'gesperrt':active?'aktiv':'inaktiv';
   return `<tr data-member-id="${esc(member.user_id)}"><td><input type="checkbox" class="member-select" ${selected.has(member.user_id)?'checked':''} ${self?'disabled':''} aria-label="${esc(info.name)} auswählen"></td><td class="member-status-cell"><span class="member-state-icon ${active?'is-active':'is-inactive'}" role="img" title="${esc(status)}" aria-label="${esc(info.name)}: ${esc(status)}">${icon(active?'active':'inactive')}</span></td><th scope="row"><strong>${esc(info.name)}</strong><small>Login: ${esc(info.login)}</small>${info.email?`<small>${esc(info.email)}</small>`:''}${!member.first_name&&!member.last_name?'<small>Sammelkonto · Name nicht hinterlegt</small>':''}${self?'<small>Dein Zugang</small>':''}</th><td><select class="member-role" ${self?'disabled':''} aria-label="Rolle für ${esc(info.name)}">${roleOptions(member.suite_role_key)}</select></td>${areas.map(area=>rightsCell(member,area,self)).join('')}<td class="member-tools-cell"><div class="member-row-tools"><button type="button" class="secondary member-icon-button member-edit" title="Personendaten bearbeiten" aria-label="Personendaten für ${esc(info.name)} bearbeiten" ${self?'disabled':''}>${icon('person')}</button><button type="button" class="secondary member-icon-button member-save" title="Änderungen speichern" aria-label="Änderungen für ${esc(info.name)} speichern" ${!draft||self?'disabled':''}>${icon('save')}</button></div></td></tr>`;
  }).join('')||`<tr><td colspan="${areas.length+5}">Keine Benutzer passen zum Filter.</td></tr>`}</tbody></table></div>`;
  table.querySelectorAll('[data-member-id]').forEach(row=>{
   const id=row.dataset.memberId,saved=state().members.find(m=>m.user_id===id);
   row.querySelector('.member-select').onchange=e=>{if(e.target.checked)selected.add(id);else selected.delete(id);syncSelectAll();updateFooter();};
   row.querySelector('.member-role').onchange=e=>{const draft=drafts.get(id)||snapshot(saved);draft.roleKey=e.target.value;drafts.set(id,draft);render();};
   row.querySelectorAll('[data-extra-area]').forEach(input=>input.onchange=()=>{const draft=drafts.get(id)||snapshot(saved);draft.extraAreas=[...row.querySelectorAll('[data-extra-area]:checked:not(:disabled)')].map(i=>i.dataset.extraArea);drafts.set(id,draft);row.querySelector('.member-save').disabled=false;});
   row.querySelector('.member-edit').onclick=()=>openMember(saved);
   row.querySelector('.member-save').onclick=async()=>{try{await request({action:'save_suite_member',...(drafts.get(id)||snapshot(saved))});drafts.delete(id);await reload();notify('Benutzerrechte gespeichert.');}catch(error){notify(error.message,true);}};
  });
  doc.querySelector('#memberSelectAll').onchange=e=>{for(const member of visibleMembers())if(member.user_id!==state().userId){if(e.target.checked)selected.add(member.user_id);else selected.delete(member.user_id);}render();};
  syncSelectAll();updateFooter();renderRoles();
 }
 function syncSelectAll(){const eligible=visibleMembers().filter(m=>m.user_id!==state().userId),count=eligible.filter(m=>selected.has(m.user_id)).length;const input=doc.querySelector('#memberSelectAll');if(input){input.checked=eligible.length>0&&count===eligible.length;input.indeterminate=count>0&&count<eligible.length;input.disabled=eligible.length===0;}}
 function renderRoles(){
  const mount=doc.querySelector('#suiteRolesTable');
  mount.innerHTML=`<div class="member-table-scroll"><table class="suite-members-table"><thead><tr><th>Rolle</th>${SUITE_AREAS.map(area=>`<th>${esc(SUITE_AREA_LABELS[area])}</th>`).join('')}<th>Speichern</th></tr></thead><tbody>${state().roles.map(role=>`<tr data-role-key="${esc(role.key)}"><th scope="row">${esc(role.label)}${role.protected?'<small>Systemrolle · geschützt</small>':''}</th>${SUITE_AREAS.map(area=>`<td class="member-right-cell"><input type="checkbox" data-role-area="${area}" ${role.access_areas.includes(area)?'checked':''} ${role.protected||area==='user_management'?'disabled':''} aria-label="${esc(SUITE_AREA_LABELS[area])} für Rolle ${esc(role.label)}"></td>`).join('')}<td><button type="button" class="secondary" ${role.protected?'disabled':''}>Speichern</button></td></tr>`).join('')}</tbody></table></div>`;
  mount.querySelectorAll('[data-role-key]').forEach(row=>row.querySelector('button').onclick=async()=>{const button=row.querySelector('button');button.disabled=true;try{await request({action:'save_suite_role',key:row.dataset.roleKey,accessAreas:[...row.querySelectorAll('[data-role-area]:checked')].map(input=>input.dataset.roleArea)});await reload();notify('Rollenrechte gespeichert. Alle zugeordneten Benutzer sind aktualisiert.');}catch(error){notify(error.message,true);button.disabled=false;}});
 }
 function renderDialogRights(){
  const role=state().roles.find(role=>role.key===form.elements.roleKey.value),inherited=role?.access_areas||[];
  const current=new Set([...doc.querySelectorAll('#memberExtraRights input:checked')].map(i=>i.value));
  doc.querySelector('#memberExtraRights').innerHTML=SUITE_AREAS.filter(area=>area!=='user_management').map(area=>`<label class="permission-option"><input type="checkbox" value="${area}" ${inherited.includes(area)||current.has(area)?'checked':''} ${inherited.includes(area)?'disabled':''}>${esc(SUITE_AREA_LABELS[area])}${inherited.includes(area)?' · Rolle':''}</label>`).join('');
 }
 function openMember(member){
  form.reset();form.dataset.userId=member?.user_id||'';doc.querySelector('#suiteMemberDialogTitle').textContent=member?'Personendaten bearbeiten':'Benutzer anlegen';
  const data=member?snapshot(member):{roleKey:'trainer',firstName:'',lastName:'',username:''};
  for(const key of ['firstName','lastName','username'])form.elements[key].value=data[key];
  form.elements.roleKey.innerHTML=roleOptions(data.roleKey);form.elements.email.value=member?suiteMemberPresentation(member).email:'';form.elements.email.disabled=!!member;
  doc.querySelector('#memberCreateOptions').classList.toggle('hidden',!!member);
  doc.querySelector('#memberExtraRights').replaceChildren();renderDialogRights();
  if(member)doc.querySelectorAll('#memberExtraRights input:not(:disabled)').forEach(input=>input.checked=data.extraAreas.includes(input.value));
  doc.querySelector('#suiteMemberDialogMessage').textContent='';dialog.showModal();
 }
 form.elements.roleKey.onchange=renderDialogRights;
 const suggestLogin=()=>{if(!form.dataset.userId&&!form.elements.username.dataset.edited)form.elements.username.value=cashbookUsername(form.elements.firstName.value+' '+form.elements.lastName.value);};
 form.elements.firstName.oninput=suggestLogin;form.elements.lastName.oninput=suggestLogin;form.elements.username.oninput=()=>form.elements.username.dataset.edited='true';
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{const body={...Object.fromEntries(new FormData(form)),extraAreas:[...doc.querySelectorAll('#memberExtraRights input:checked:not(:disabled)')].map(input=>input.value),isActive:form.elements.isActive.checked};if(form.dataset.userId){body.action='save_suite_member';body.userId=form.dataset.userId;}else body.action='create_team_member';await request(body);if(body.userId)drafts.delete(body.userId);dialog.close();await reload();notify('Benutzer gespeichert.');}catch(error){doc.querySelector('#suiteMemberDialogMessage').textContent=error.message;}finally{button.disabled=false;}};
 doc.querySelector('#closeSuiteMember').onclick=()=>dialog.close();doc.querySelector('#memberCreate').onclick=()=>{delete form.elements.username.dataset.edited;openMember();};
 footer.querySelectorAll('[data-member-bulk]').forEach(button=>button.onclick=async()=>{
  const ids=[...selected],operation=button.dataset.memberBulk;const names=state().members.filter(m=>selected.has(m.user_id)).map(m=>suiteMemberPresentation(m).name).join(', ');
  if(!ids.length||busy)return;
  if(operation==='delete'){if(window.prompt(`Diese ${ids.length} Zugänge endgültig löschen? Kassenbuchbelege bleiben erhalten.\n${names}\n\nZum Bestätigen LÖSCHEN eingeben:`)!=='LÖSCHEN')return;}
  else if(!window.confirm(`${button.textContent.trim()} für ${ids.length} ausgewählte Benutzer?\n${names}`))return;
  busy=true;updateFooter();
  try{const result=await request({action:'bulk_suite_users',operation,userIds:ids});const failed=(result.results||[]).filter(r=>!r.ok);selected.clear();failed.forEach(r=>selected.add(r.userId));await reload();notify(failed.length?`${failed.length} Aktionen fehlgeschlagen: ${failed.map(r=>r.error).join('; ')}`:'Benutzeraktion abgeschlossen.',!!failed.length);}catch(error){notify(error.message,true);}finally{busy=false;updateFooter();}
 });
 doc.querySelector('#memberSearch').oninput=render;
 return {render};
}
