import {createSponsorEditState,sponsorEditIsDirty,sponsorEditHasImage,persistSponsorEdits,sponsorToday} from '../src/sponsor-editor.mjs';

export function createSponsorEditor({document,api,esc,show,runBusy,prepareSponsorLogo,prepareMagazineArtwork,prepareWhite,contractStatus,reload}) {
  const states = new Map();
  const statusLabels = {missing:'Kein Bild',needs_review:'Freigabe ausstehend',approved:'Freigegeben',rejected:'Nicht freigegeben'};
  const stateFor = sponsor => {
    if (!states.has(sponsor.id)) states.set(sponsor.id,createSponsorEditState(sponsor));
    return states.get(sponsor.id);
  };
  function imagePanel(state,channel) {
    const digital = channel === 'digital';
    const title = digital ? 'Firmenlogo' : 'Heftanzeige';
    return `<section class="sponsor-upload-panel" data-channel="${channel}" aria-label="${title}">
      <div class="sponsor-upload-heading"><div><h4>${title}</h4><p>${digital?'Für Homepage und Social Media':'Fertige Anzeige für das Stadionheft'}</p></div><span class="sponsor-image-status"></span></div>
      <div class="sponsor-upload-image"><img alt="${title} von ${esc(state.values.name)}"><span class="sponsor-image-empty">Kein Bild ausgewählt</span></div>
      <div class="sponsor-image-tools"><span class="sponsor-image-filename"></span><button type="button" class="ghost sponsorDiscard" aria-label="${title} verwerfen">Verwerfen</button></div>
      <label class="sponsor-upload-label">${title} hochladen<input type="file" class="${digital?'sponsorFile':'sponsorMagazineFile'}" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"></label>
      <span class="small">PNG, JPG, WebP oder SVG · maximal 5 MB</span>
      ${digital?`<label class="sponsor-processing-label">Verarbeitung für neue Dateien<select class="sponsorLogoMode"><option value="preserve" ${state.mode==='preserve'?'selected':''}>Farben und Hintergrund beibehalten</option><option value="auto" ${state.mode==='auto'?'selected':''}>Neutralen Hintergrund entfernen</option></select></label>`:'<p class="small">Die Anzeige bleibt mit Text, Farben und Hintergrund erhalten.</p>'}
      <p class="sponsor-image-message small" role="status" aria-live="polite"></p>
    </section>`;
  }
  function html(sponsor,expanded=false) {
    const state = stateFor(sponsor),v=state.values,contract=contractStatus(state.sponsor);
    const input=(name,label,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(v[name])}" ${extra}></label>`;
    return `<details class="sponsor-card" data-sponsor-id="${esc(sponsor.id)}" ${(expanded||sponsorEditIsDirty(state))?'open':''}>
      <summary><div class="crest-head"><div><h3>${esc(v.name)}</h3><div class="small">${esc([v.instagramHandle,v.websiteUrl,v.active?'Aktiv':'Inaktiv'].filter(Boolean).join(' · '))}</div><span class="sponsor-contract-state ${contract.expired?'expired':''}">${esc(contract.label)}</span></div><span class="crest-state ${esc(state.sponsor.logo_status)}">${esc(statusLabels[state.sponsor.logo_status]||'Kein Bild')}</span></div></summary>
      <div class="sponsor-card-body"><form class="sponsorForm sponsor-editor-form" data-id="${esc(sponsor.id)}">
        <fieldset class="sponsor-editor-fields"><legend class="visually-hidden">Werbepartner bearbeiten</legend><div class="fields sponsor-metadata-fields">
          ${input('name','Name','text','maxlength="120" required')}${input('sortOrder','Sortierung','number','min="0" max="32767" required')}
          ${input('websiteUrl','Website','url')}${input('instagramHandle','Instagram')}
          ${input('contractStartDate','Vertragsbeginn','date')}${input('contractEndDate','Vertragsende','date')}
          <label class="wide permission-option"><input name="automaticRenewal" type="checkbox" ${v.automaticRenewal?'checked':''}> Automatische Verlängerung · Ende offen</label>
          ${input('sourceUrl','Quelle des Firmenlogos (optional)','url')}
        </div><div class="sponsor-upload-grid">${imagePanel(state,'digital')}${imagePanel(state,'magazine')}</div></fieldset>
        <div class="sponsor-editor-actions"><p class="sponsor-save-notice" role="status" aria-live="polite"></p>
          <div class="sponsor-secondary-actions"><button type="button" class="secondary toggleSponsorActive"></button><button type="button" class="danger deleteSponsor">Löschen</button></div>
          <div class="sponsor-primary-actions"><button type="submit" class="secondary sponsorSave">Speichern</button><button type="button" class="sponsorApprove">Freigeben</button></div>
        </div></form></div></details>`;
  }
  function wireForm(form) {
    const state=states.get(form.dataset.id);
    const save=form.querySelector('.sponsorSave'),approve=form.querySelector('.sponsorApprove');
    const toggle=form.querySelector('.toggleSponsorActive'),fields=form.querySelector('fieldset');
    const hasPending=()=>['digital','magazine'].some(channel=>state[channel].pending||state[channel].error);
    function syncImage(channel) {
      const draft=state[channel],digital=channel==='digital',panel=form.querySelector(`[data-channel="${channel}"]`);
      const image=panel.querySelector('img');
      const url=draft.discard?'':draft.prepared?(digital?draft.prepared.transparentDataUrl:draft.prepared.imageDataUrl):draft.preview||(digital?(state.sponsor.logo_original_url||state.sponsor.logo_transparent_url||state.sponsor.logo_white_url):state.sponsor.magazine_ad_url)||'';
      image.hidden=!url;panel.querySelector('.sponsor-image-empty').hidden=Boolean(url);
      if(url&&image.getAttribute('src')!==url)image.src=url;
      if(!url)image.removeAttribute('src');
      panel.querySelector('.sponsor-upload-image').classList.toggle('is-white-variant',Boolean(digital&&url===state.sponsor.logo_white_url&&!state.sponsor.logo_original_url&&!state.sponsor.logo_transparent_url));
      if(!draft.file&&!draft.pending)panel.querySelector('input[type=file]').value='';
      const status=digital?state.sponsor.logo_status:state.sponsor.magazine_ad_status;
      panel.querySelector('.sponsor-image-status').textContent=draft.discard?'Wird verworfen':draft.prepared?'Ungespeichert':statusLabels[status]||'Kein Bild';
      panel.querySelector('.sponsor-image-filename').textContent=draft.file?.name||'';
      panel.querySelector('.sponsorDiscard').disabled=state.busy||!(url||draft.file||draft.pending);
      const message=panel.querySelector('.sponsor-image-message');message.classList.toggle('error',Boolean(draft.error));
      message.textContent=draft.error||(draft.pending?'Bild wird vorbereitet …':draft.discard?'Das Bild wird beim Speichern verworfen.':draft.prepared?(digital?'Firmenlogo vorbereitet.':`${draft.prepared.width} × ${draft.prepared.height} Pixel · unverändert vorbereitet.`):(!digital&&!url?'Ohne eigene Heftanzeige wird das freigegebene Firmenlogo als Ersatz verwendet.':''));
    }
    function sync() {
      if(!form.isConnected)return;
      const dirty=Boolean(sponsorEditIsDirty(state));
      fields.disabled=state.busy;toggle.disabled=state.busy;form.querySelector('.deleteSponsor').disabled=state.busy;
      form.elements.contractEndDate.disabled=state.values.automaticRenewal;
      form.elements.contractEndDate.min=state.values.contractStartDate;
      save.classList.toggle('sponsor-save-dirty',dirty);save.disabled=state.busy||hasPending()||!dirty;
      save.setAttribute('aria-label',dirty?'Speichern · ungespeicherte Änderungen':'Speichern');
      const imageChannels=['digital','magazine'].filter(channel=>sponsorEditHasImage(state,channel));
      const pendingApproval=imageChannels.some(channel=>state[channel].prepared||state.sponsor[channel==='digital'?'logo_status':'magazine_ad_status']!=='approved');
      approve.disabled=state.busy||hasPending()||!imageChannels.length||(!dirty&&!pendingApproval);
      toggle.textContent=state.values.active?'Deaktivieren':'Aktivieren';
      form.querySelector('.sponsor-save-notice').textContent=state.busy?'Änderungen werden übernommen …':hasPending()?'Bitte die Bildvorbereitung abschließen.':dirty?'Ungespeicherte Änderungen':'';
      for(const channel of ['digital','magazine'])syncImage(channel);
    }
    state.notify=sync;
    function readMetadata() {
      const values={...state.values};
      for(const name of ['name','sortOrder','websiteUrl','instagramHandle','sourceUrl','contractStartDate','contractEndDate'])values[name]=form.elements[name].value;
      values.automaticRenewal=form.elements.automaticRenewal.checked;
      state.values=values;
    }
    form.addEventListener('input',event=>{if(event.target.name){readMetadata();sync();}});
    form.elements.automaticRenewal.onchange=()=>{
      if(form.elements.automaticRenewal.checked)form.elements.contractEndDate.value='';
      readMetadata();sync();
    };
    toggle.onclick=()=>{state.values.active=!state.values.active;sync();};
    async function prepareFile(channel,file) {
      const draft=state[channel],revision=++draft.revision;
      Object.assign(draft,{file,prepared:null,pending:true,error:'',discard:false});state.notify?.();
      try {
        const prepared=channel==='digital'?await prepareSponsorLogo(file,state.mode):await prepareMagazineArtwork(file);
        if(draft.revision!==revision)return;
        if(prepared.processing?.safetyBlocked)throw new Error('Die Hintergrundentfernung würde das Logo beschädigen. Bitte Farben und Hintergrund beibehalten.');
        draft.prepared=prepared;
      } catch(error) {if(draft.revision===revision)draft.error=error.message;}
      finally {if(draft.revision===revision){draft.pending=false;state.notify?.();}}
    }
    for(const channel of ['digital','magazine']) {
      const panel=form.querySelector(`[data-channel="${channel}"]`),input=panel.querySelector('input[type=file]');
      input.onchange=()=>{const file=input.files?.[0];if(file)prepareFile(channel,file);};
      panel.querySelector('.sponsorDiscard').onclick=()=>{
        const draft=state[channel];draft.revision++;
        const persisted=channel==='digital'?Boolean(state.sponsor.logo_original_path||state.sponsor.logo_transparent_path||state.sponsor.logo_white_path||state.sponsor.logo_original_url||state.sponsor.logo_transparent_url||state.sponsor.logo_white_url):Boolean(state.sponsor.magazine_ad_path||state.sponsor.magazine_ad_url);
        Object.assign(draft,{file:null,prepared:null,pending:false,error:'',discard:persisted,preview:null});input.value='';sync();
      };
    }
    form.querySelector('.sponsorLogoMode').onchange=event=>{state.mode=event.target.value;if(state.digital.file)prepareFile('digital',state.digital.file);};
    async function persist(shouldApprove) {
      readMetadata();
      const end=form.elements.contractEndDate;
      end.setCustomValidity(state.values.active&&!state.values.automaticRenewal&&state.values.contractEndDate&&state.values.contractEndDate<sponsorToday()?'Für einen aktiven Partner darf das Vertragsende nicht in der Vergangenheit liegen.':'');
      if(state.busy||hasPending()||!form.reportValidity())return;
      if(!shouldApprove&&!sponsorEditIsDirty(state))return;
      const button=shouldApprove?approve:save;
      state.busy=true;sync();
      await runBusy(button,{busyText:shouldApprove?'Gibt frei …':'Speichert …',pendingText:shouldApprove?'Änderungen werden gespeichert und Bilder freigegeben …':'Änderungen werden gespeichert …',successText:shouldApprove?'Gespeichert und freigegeben.':'Gespeichert.',errorText:shouldApprove?'Freigeben fehlgeschlagen: ':'Speichern fehlgeschlagen: '},async()=>{
        try {
          await persistSponsorEdits(state,{api,approve:shouldApprove,prepareWhite,onCommit:()=>state.notify?.()});
          states.delete(form.dataset.id);
          try {await reload(form.dataset.id,state.values.name);} catch(error) {states.set(form.dataset.id,state);throw error;}
        } finally {state.busy=false;state.notify?.();}
      });
      state.notify?.();
    }
    form.onsubmit=event=>{event.preventDefault();persist(false);};
    approve.onclick=()=>persist(true);
    form.querySelector('.deleteSponsor').onclick=async()=>{
      if(state.busy||!globalThis.confirm(`„${state.values.name}“ wirklich löschen? Alle Bilder und Zuordnungen dieses Partners werden gelöscht.`))return;
      state.busy=true;sync();
      await runBusy(form.querySelector('.deleteSponsor'),{busyText:'Löscht …',pendingText:'Werbepartner wird gelöscht …',successText:'Gelöscht.',errorText:'Löschen fehlgeschlagen: '},async()=>{
        try {await api('POST',{action:'delete_sponsor',sponsorId:form.dataset.id});states.delete(form.dataset.id);await reload();}
        finally {state.busy=false;state.notify?.();}
      });state.notify?.();
    };
    sync();
  }
  return {html,wire:()=>document.querySelectorAll('.sponsor-editor-form').forEach(wireForm),clear:()=>states.clear()};
}
