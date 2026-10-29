function createHallTrainingWorkspace(root,{request}){
 let data=null,busy=false,sequence=0,view='bookings',showPast=false,trainerChoice='',teamChoice='';
 const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dateLabel=value=>new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'Europe/Berlin'}).format(new Date(value+'T12:00:00Z'));
 const trainerKey=t=>t.personId?'person:'+t.personId:'user:'+t.userId;
 function status(message,error=false){const node=root.querySelector('[data-hall-status]');if(node){node.textContent=message;node.classList.toggle('error',error);node.setAttribute('role',error?'alert':'status');}}
 function render(){
  if(!data.teams.some(t=>t.id===teamChoice))teamChoice=data.teams.length===1?data.teams[0].id:'';
  const days=data.days.filter(d=>showPast||d.slots.some(s=>!s.past));
  root.innerHTML=`<div class="hall-toolbar"><div><h3>BSZ</h3><p class="muted">Berufsschulzentrum · Zeiten in Europe/Berlin</p></div><button class="secondary" type="button" data-hall-refresh>Aktualisieren</button></div>
   <div class="hall-tabs" aria-label="Hallentraining-Ansicht"><button type="button" class="${view==='bookings'?'':'secondary'}" data-hall-view="bookings" aria-pressed="${view==='bookings'}">Buchungen</button>${data.admin?`<button type="button" class="${view==='admin'?'':'secondary'}" data-hall-view="admin" aria-pressed="${view==='admin'}">Administration</button>`:''}</div>
   <p data-hall-status role="status" aria-live="polite"></p>
   ${view==='admin'&&data.admin?`<div class="hall-toolbar"><p>Trainingstage, Start, Ende und Blocklänge verwalten.</p><button type="button" data-hall-add>Trainingstag hinzufügen</button></div><p class="muted">Gebuchte Tage können erst nach Freigabe der Buchungen geändert oder gelöscht werden.</p>`:`<p>Wähle einen freien Zeitblock für dein Training. Eigene Buchungen kannst du wieder freigeben.</p>${data.admin?`<label class="hall-trainer">Buchen für<select data-hall-trainer><option value="">Mich selbst</option>${data.trainers.map(t=>`<option value="${e(trainerKey(t))}" ${trainerChoice===trainerKey(t)?'selected':''}>${e(t.name)}</option>`).join('')}</select></label>`:''}`}
   ${view==='bookings'?`<label class="hall-trainer">Mannschaft<select data-hall-team ${data.teams.length?'':'disabled'}><option value="">Mannschaft auswählen</option>${data.teams.map(t=>`<option value="${e(t.id)}" ${teamChoice===t.id?'selected':''}>${e(t.name)}</option>`).join('')}</select></label>${data.teams.length?'':'<p class="muted">Deinem Zugang ist noch keine Mannschaft zugeordnet. Bitte wende dich an die Administration.</p>'}`:''}
   <label class="hall-history"><input type="checkbox" data-hall-past ${showPast?'checked':''}> Vergangene Trainingstage anzeigen</label>
   <div class="hall-days">${days.map(day=>`<article class="hall-day"><div class="hall-day-heading"><div><h4>${e(dateLabel(day.date))}</h4><p>${hallTime(day.startMinute)}–${hallTime(day.endMinute)} Uhr · ${day.blockMinutes} Minuten pro Block</p></div>${view==='admin'?`<div class="hall-actions"><button type="button" class="secondary" data-hall-edit="${day.id}">Bearbeiten</button><button type="button" class="secondary" data-hall-delete="${day.id}">Tag löschen</button></div>`:''}</div>
   ${view==='admin'?`<p class="muted">${day.slots.filter(s=>s.bookingId).length} von ${day.slots.length} Blöcken gebucht</p>`:`<div class="hall-slots">${day.slots.map(slot=>`<div class="hall-slot ${slot.own?'hall-own':''} ${slot.past?'hall-past':''}"><strong>${hallTime(slot.startMinute)}–${hallTime(slot.endMinute)}</strong><span>${slot.bookingId?`${e(slot.teamName||'Mannschaft nicht hinterlegt')}${slot.own?' <small>Deine Buchung</small>':''}<button type="button" class="hall-details-link" data-hall-details="${slot.bookingId}" data-day="${day.id}" aria-label="Buchungsdetails für ${e(slot.teamName||'diesen Zeitblock')}">Details</button>`:slot.past?'Vergangen':'<span class="hall-free">Frei</span>'}</span>${slot.bookingId&&(slot.own||data.admin)?`<button type="button" class="secondary" data-hall-release="${slot.bookingId}" data-day="${day.id}">Freigeben</button>`:!slot.bookingId&&!slot.past?`<button type="button" data-hall-book="${slot.startMinute}" data-day="${day.id}" ${data.teams.length?'':'disabled'}>Buchen</button>`:`<span class="muted">${slot.bookingId?'Belegt':'–'}</span>`}</div>`).join('')}</div>`}</article>`).join('')||'<p class="muted">Keine Trainingstage vorhanden.</p>'}</div><dialog class="hall-dialog" data-hall-day-dialog><form data-hall-form><h3 data-hall-form-title>Trainingstag</h3><input name="dayId" type="hidden"><input name="version" type="hidden" value="0"><label>Datum<input name="date" type="date" required></label><div class="hall-form-times"><label>Start<input name="start" type="time" value="08:00" required></label><label>Ende<input name="end" type="time" value="20:00" required></label></div><label>Blocklänge in Minuten<input name="blockMinutes" type="number" min="15" max="720" value="120" required></label><p class="muted">Die Blocklänge muss den Zeitraum vollständig aufteilen.</p><p data-hall-form-status role="alert"></p><div class="hall-actions"><button type="button" class="secondary" data-hall-close>Abbrechen</button><button type="submit">Speichern</button></div></form></dialog><dialog class="hall-dialog" data-hall-details-dialog aria-labelledby="hallBookingDetailsTitle"><h3 id="hallBookingDetailsTitle">Buchungsdetails</h3><dl data-hall-details-content></dl><button type="button" class="secondary" data-hall-details-close>Schließen</button></dialog>`;
  root.querySelector('[data-hall-refresh]').onclick=()=>open();
  root.querySelectorAll('[data-hall-view]').forEach(b=>b.onclick=()=>{view=b.dataset.hallView;render();});
  root.querySelector('[data-hall-past]').onchange=event=>{showPast=event.target.checked;render();};
  const select=root.querySelector('[data-hall-trainer]');if(select)select.onchange=()=>{trainerChoice=select.value;const trainer=data.trainers.find(t=>trainerKey(t)===trainerChoice);teamChoice=trainer?.teams?.length===1?trainer.teams[0].id:'';render();};
  root.querySelector('[data-hall-team]')?.addEventListener('change',event=>{teamChoice=event.target.value;});
  root.querySelectorAll('[data-hall-book]').forEach(b=>b.onclick=()=>{
   const day=data.days.find(d=>d.id===b.dataset.day),slot=day.slots.find(s=>s.startMinute===Number(b.dataset.hallBook));
   const trainer=data.trainers.find(t=>trainerKey(t)===trainerChoice);
   const team=data.teams.find(t=>t.id===teamChoice);if(!team){status('Bitte eine Mannschaft auswählen.',true);return;}
   if(!window.confirm(`${dateLabel(day.date)}, ${hallTime(slot.startMinute)}–${hallTime(slot.endMinute)} Uhr für ${team.name}${trainer?' (Trainer: '+trainer.name+')':''} buchen?`))return;
   mutate({action:'book',dayId:day.id,version:day.version,startMinute:slot.startMinute,teamId:team.id,...(trainer?{trainerPersonId:trainer.personId,trainerUserId:trainer.userId}:{})},'Zeitblock gebucht.');
  });
  root.querySelectorAll('[data-hall-release]').forEach(b=>b.onclick=()=>{if(window.confirm('Diese Buchung freigeben? Der Zeitblock wird anschließend wieder buchbar.'))mutate({action:'release',dayId:b.dataset.day,bookingId:b.dataset.hallRelease},'Buchung freigegeben.');});
  root.querySelectorAll('[data-hall-delete]').forEach(b=>b.onclick=()=>{const day=data.days.find(d=>d.id===b.dataset.hallDelete);if(window.confirm(`Trainingstag ${dateLabel(day.date)} löschen?`))mutate({action:'delete_day',dayId:day.id,version:day.version},'Trainingstag gelöscht.');});
  const detailsDialog=root.querySelector('[data-hall-details-dialog]');
  root.querySelector('[data-hall-details-close]').onclick=()=>detailsDialog.close();
  root.querySelectorAll('[data-hall-details]').forEach(button=>button.onclick=()=>{
   const day=data.days.find(d=>d.id===button.dataset.day),slot=day.slots.find(s=>s.bookingId===button.dataset.hallDetails);
   root.querySelector('[data-hall-details-content]').innerHTML=`<dt>Mannschaft</dt><dd>${e(slot.teamName||'Mannschaft nicht hinterlegt')}</dd><dt>Trainer</dt><dd>${e(slot.trainerName)}</dd><dt>Datum</dt><dd>${e(dateLabel(day.date))}</dd><dt>Uhrzeit</dt><dd>${hallTime(slot.startMinute)}–${hallTime(slot.endMinute)} Uhr</dd>`;detailsDialog.showModal();
  });
  const dialog=root.querySelector('[data-hall-day-dialog]'),form=root.querySelector('[data-hall-form]');
  function edit(day){form.reset();form.elements.dayId.value=day?.id||'';form.elements.version.value=day?.version||0;if(day){form.elements.date.value=day.date;form.elements.start.value=hallTime(day.startMinute);form.elements.end.value=hallTime(day.endMinute);form.elements.blockMinutes.value=day.blockMinutes;}root.querySelector('[data-hall-form-title]').textContent=day?'Trainingstag bearbeiten':'Trainingstag hinzufügen';dialog.showModal();}
  root.querySelectorAll('[data-hall-edit]').forEach(b=>b.onclick=()=>edit(data.days.find(d=>d.id===b.dataset.hallEdit)));
  const add=root.querySelector('[data-hall-add]');if(add)add.onclick=()=>edit();
  root.querySelector('[data-hall-close]').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   const body={action:'save_day',...Object.fromEntries(new FormData(form)),version:Number(form.elements.version.value)};
   try{validateHallDay(body);}catch(error){root.querySelector('[data-hall-form-status]').textContent=error.message;return;}
   await mutate(body,'Trainingstag gespeichert.',true);
  };
 }
 async function fetchData(){const current=++sequence;const next=await request({action:'list'});if(current!==sequence)return false;data=next;if(!data.admin)view='bookings';render();return true;}
 async function mutate(body,message,inDialog=false){
  if(busy)return;busy=true;const current=sequence;
  const controls=[...root.querySelectorAll('button,input,select')].filter(node=>!node.disabled);controls.forEach(node=>node.disabled=true);
  try{await request(body);if(current!==sequence)return;await fetchData();status(message);}
  catch(error){if(current!==sequence)return;if(error.status===409&&!inDialog){try{await fetchData();}catch{} }const node=inDialog?root.querySelector('[data-hall-form-status]'):null;if(node)node.textContent=error.message;else status(error.message,true);}
  finally{busy=false;controls.filter(node=>node.isConnected).forEach(node=>node.disabled=false);}
 }
 async function open(){if(busy)return;root.innerHTML='<p role="status">Hallentraining wird geladen …</p>';try{await fetchData();}catch(error){root.innerHTML='<p class="status error" role="alert">'+e(error.message)+'</p><button type="button" data-hall-retry>Erneut versuchen</button>';root.querySelector('[data-hall-retry]').onclick=open;}}
 return {open,clear(){sequence++;data=null;trainerChoice='';teamChoice='';view='bookings';root.innerHTML='';}};
}
