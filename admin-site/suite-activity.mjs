function createSuiteActivity({root,request}){
 let entries=[],nextCursor=null,sequence=0,initialized=false,busy=false;
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const date=new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'medium',timeZone:'Europe/Berlin'});
 root.innerHTML=`<div class="list-heading"><h3>Aktivitätsprotokoll</h3><button type="button" class="secondary" data-activity-refresh>Aktualisieren</button></div>
 <p class="small">Wer hat wann etwas gemacht? Anmeldungen, Kassenbuchbewegungen, Traineränderungen und Benutzeraktionen. Alle Zeiten: Deutschland.</p>
 <form class="activity-filters"><label>Benutzer<select name="userId"><option value="">Alle Benutzer</option></select></label><label>Bereich<select name="category"><option value="">Alle Bereiche</option>${Object.entries(SUITE_ACTIVITY_CATEGORIES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>Von<input name="from" type="date"></label><label>Bis einschließlich<input name="until" type="date"></label><div class="activity-filter-actions"><button type="submit">Anzeigen</button><button type="reset" class="secondary">Zurücksetzen</button></div></form>
 <p class="activity-status small" role="status" aria-live="polite"></p><div class="activity-table-wrap"></div><footer class="activity-footer"><span class="small" data-activity-count></span><button type="button" class="secondary hidden" data-activity-more>Weitere laden</button></footer>
 <p class="small activity-note">Anmeldungen werden seit Einführung dieses Protokolls erfasst. Bereits vorhandene Kassenbuch- und Trainerprotokolle sind übernommen. Automatische Sitzungsverlängerungen erzeugen keine zusätzliche Anmeldung.</p>`;
 const form=root.querySelector('form'),status=root.querySelector('.activity-status'),table=root.querySelector('.activity-table-wrap'),more=root.querySelector('[data-activity-more]');
 const filters=()=>Object.fromEntries(new FormData(form));
 let appliedFilters={};
 function render(){
  table.innerHTML=entries.length?`<table class="activity-table"><caption class="visually-hidden">Aktivitäten, neueste zuerst</caption><thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Aktion</th><th>Details</th><th>Betrag</th></tr></thead><tbody>${entries.map(entry=>`<tr><td data-label="Zeitpunkt"><time datetime="${esc(entry.occurredAt)}">${esc(date.format(new Date(entry.occurredAt)))}</time></td><td data-label="Benutzer"><strong>${esc(entry.actorName)}</strong>${entry.actorLogin?`<small>${esc(entry.actorLogin)}</small>`:''}</td><td data-label="Aktion"><strong>${esc(SUITE_ACTIVITY_EVENTS[entry.event]||'Aktion ausgeführt')}</strong><small>${esc(SUITE_ACTIVITY_CATEGORIES[entry.category]||entry.category)}</small></td><td data-label="Details">${suiteActivityDetails(entry).map(detail=>`<span>${esc(detail)}</span>`).join('')||'–'}</td><td data-label="Betrag" class="activity-amount">${esc(suiteActivityMoney(entry.metadata?.amountCents))}</td></tr>`).join('')}</tbody></table>`:'<p class="empty">Keine Aktivitäten für diese Auswahl vorhanden.</p>';
  more.classList.toggle('hidden',!nextCursor);root.querySelector('[data-activity-count]').textContent=entries.length?entries.length+' Einträge angezeigt':'';
 }
 function setBusy(value){busy=value;root.setAttribute('aria-busy',String(value));for(const field of form.elements)field.disabled=value;more.disabled=value;root.querySelector('[data-activity-refresh]').disabled=value;}
 async function load(append=false){
  if(append&&(busy||!nextCursor))return;
  if(!append&&!form.reportValidity())return;
  const current=++sequence;
  if(!append){appliedFilters=filters();entries=[];nextCursor=null;table.replaceChildren();more.classList.add('hidden');root.querySelector('[data-activity-count]').textContent='';}
  setBusy(true);status.className='activity-status small';status.textContent='Aktivitäten werden geladen …';
  try{
   const data=await request({...appliedFilters,cursor:append?nextCursor:null});if(current!==sequence)return;
   entries=append?[...entries,...data.entries]:data.entries;nextCursor=data.nextCursor;
   const selected=form.elements.userId.value;const userSelect=form.elements.userId;
   userSelect.innerHTML='<option value="">Alle Benutzer</option>'+data.people.map(person=>`<option value="${esc(person.id)}">${esc(person.name)}${person.login?' · '+esc(person.login):''}</option>`).join('')+'<option value="system">Automatisch / nicht zugeordnet</option>';
   userSelect.value=selected;initialized=true;status.textContent='';render();
  }catch(error){if(current!==sequence)return;status.className='activity-status error';status.textContent=error.message||'Das Protokoll konnte nicht geladen werden. Bitte erneut versuchen.';}
  finally{if(current===sequence)setBusy(false);}
 }
 form.onsubmit=event=>{event.preventDefault();load();};
 form.onreset=event=>{event.preventDefault();for(const field of form.elements)if(field.name)field.value='';load();};
 root.querySelector('[data-activity-refresh]').onclick=()=>load();more.onclick=()=>load(true);
 return {open:({force=true}={})=>busy?Promise.resolve():!initialized||force?load():Promise.resolve(),clear(){sequence++;initialized=false;entries=[];nextCursor=null;for(const field of form.elements)if(field.name)field.value='';table.replaceChildren();}};
}
