import {isJointClub,crestClubSuggestions,crestDownloadName} from '../src/club-crests.mjs';
export function createClubCrestTools({document:doc,getClubs,api,prepareCrest,preparedCrests,reload}) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const downloadIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
  const importIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M4 14v7h16v-7"/><path d="M4 8V3h3M17 3h3v5"/></svg>';
  function dataImageBlob(url) {
    const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
    if (!match) throw new Error('Die Bilddatei hat kein unterstütztes Format.');
    const binary = atob(match[2]), bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:match[1]});
  }
  function downloadHtml(club,variant,{local = false,url = ''} = {}) {
    return `<button type="button" class="ghost crest-download crest-icon-button" data-crest-download="${variant}" data-club-id="${escape(club.id)}" ${local ? 'data-local-crest' : `data-crest-url="${escape(url)}"`} aria-label="${variant === 'original' ? 'Originalwappen' : 'Transparentes Wappen'} von ${escape(club.name)} herunterladen" title="${variant === 'original' ? 'Original' : 'Transparentes Wappen'} herunterladen">${downloadIcon}</button>`;
  }
  function sourceHtml(club) {
    return `<div class="wide crest-source-row"><label>Quellenlink<input name="sourceUrl" type="url" value="${escape(club.crest_source_url || '')}" placeholder="https://verein.de/wappen.png"></label><button type="button" class="ghost crest-use-source crest-icon-button" title="Bild vom Quellenlink als Original übernehmen" aria-label="Bild vom Quellenlink als Original für ${escape(club.name)} übernehmen">${importIcon}</button></div>`;
  }
  function reuseHtml(club) {
    if (!isJointClub(club)) return '';
    const id = 'crest-club-'+club.id;
    const matches = crestClubSuggestions(club,getClubs()).filter(item=>item.score>0).length;
    return `<div class="wide crest-club-picker"><strong>Spielgemeinschaft erkannt</strong><p class="small">Vorhandenes Vereinswappen übernehmen: Original und Freistellung werden gemeinsam kopiert.${matches ? ' Passende Vereine werden zuerst vorgeschlagen.' : ''}</p><label for="${escape(id)}">Verein mit vorhandenem Wappen suchen</label><input id="${escape(id)}" class="crest-club-search" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${escape(id)}-list" autocomplete="off" placeholder="z. B. Denkingen"><div id="${escape(id)}-list" class="crest-club-options" role="listbox" aria-label="Vereine mit vorhandenem Wappen" hidden></div></div>`;
  }
  function status(message) {doc.querySelector('#crestStatus').textContent=message;}
  async function prepare(form,file) {
    const meta = form.querySelector('.crestLocalMeta');
    const request = String(Number(form.dataset.crestRequest || 0)+1);form.dataset.crestRequest=request;
    meta.textContent='Freistellung wird berechnet …';
    try {
      const prepared=await prepareCrest(file);
      if (form.dataset.crestRequest !== request || !form.isConnected) return false;
      preparedCrests.set(form.dataset.id,prepared);form.querySelector('.crestFile').required=false;
      form.querySelector('.localOriginal').src=prepared.originalDataUrl;form.querySelector('.localTransparent').src=prepared.transparentDataUrl;
      form.querySelector('.crest-local-preview').classList.remove('hidden');
      const info=prepared.processing;
      meta.textContent=(info.method==='source-alpha'?'Transparenz war bereits vorhanden.':'Nur der mit dem Rand verbundene Hintergrund wurde entfernt.')+' Sicherheit: '+Math.round(info.confidence*100)+' %. Bitte das Wappen auf dem Schachbrett prüfen.';
      return true;
    } catch(error) {
      if (form.dataset.crestRequest === request) {preparedCrests.delete(form.dataset.id);form.querySelector('.crestFile').required=true;form.querySelector('.crest-local-preview').classList.add('hidden');meta.textContent=error.message;}
      return false;
    }
  }
  function wire(root = doc.querySelector('#crestList')) {
    root.querySelectorAll('[data-crest-download]').forEach(button=>button.onclick=async()=>{
      const club=getClubs().find(club=>club.id===button.dataset.clubId);if(!club)return;
      const variant=button.dataset.crestDownload;
      const url=button.hasAttribute('data-local-crest') ? preparedCrests.get(club.id)?.[variant==='original'?'originalDataUrl':'transparentDataUrl'] : button.dataset.crestUrl;
      if(!url)return;
      button.disabled=true;
      try {
        let blob;
        if(url.startsWith('data:'))blob=dataImageBlob(url);
        else {const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Die Bilddatei konnte nicht geladen werden. Bitte neu laden und erneut versuchen.');blob=await response.blob();}
        const link=doc.createElement('a');const objectUrl=URL.createObjectURL(blob);
        const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg'})[blob.type];
        link.href=objectUrl;link.download=crestDownloadName(club,variant,url).replace(/\.[^.]+$/,match=>ext?'.'+ext:match);doc.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
      } catch(error) {status('Download fehlgeschlagen: '+error.message);}finally{button.disabled=false;}
    });
    root.querySelectorAll('.crest-use-source').forEach(button=>button.onclick=async()=>{
      const form=button.closest('.crestForm');const sourceUrl=form.elements.sourceUrl.value.trim();if(!sourceUrl){status('Bitte zuerst einen Quellenlink eingeben.');form.elements.sourceUrl.focus();return;}
      const controls=[...form.querySelectorAll('button,input')];const disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
      try {
        status('Wappen vom Quellenlink wird geladen …');
        const {image}=await api('POST',{action:'fetch_club_crest_source',clubId:form.dataset.id,sourceUrl});
        const file=new File([dataImageBlob(image.dataUrl)],'wappen',{type:image.mime});
        if(await prepare(form,file)) {form.elements.sourceUrl.value=image.sourceUrl || sourceUrl;status('Bild als Original übernommen und Freistellung erstellt. Bitte vergleichen und „Vorschlag speichern“ verwenden.');}
        else status('Das Bild konnte nicht verarbeitet werden. Bitte den Hinweis am Wappen prüfen.');
      } catch(error) {status('Bild konnte nicht übernommen werden: '+error.message);}finally{controls.forEach((control,index)=>control.disabled=disabled[index]);}
    });
    root.querySelectorAll('.crest-club-search').forEach(input=>{
      const form=input.closest('.crestForm');const club=getClubs().find(club=>club.id===form.dataset.id);const list=doc.getElementById(input.getAttribute('aria-controls'));
      let matches=[],active=-1,busy=false;
      const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
      const highlight=()=>{[...list.children].forEach((option,index)=>option.classList.toggle('active',index===active));if(active>=0){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}};
      const open=()=>{
        if(busy)return;
        matches=crestClubSuggestions(club,getClubs(),input.value).slice(0,40);active=-1;
        list.innerHTML=matches.map(({club:candidate,score},index)=>`<div id="${escape(input.id)}-option-${index}" role="option" aria-selected="false" data-crest-option="${index}"><img src="${escape(candidate.crest_transparent_url)}" alt=""><span><strong>${escape(candidate.name)}</strong><small>${score>0?'Passender Vereinsname · ':''}${candidate.crest_status==='approved'?'Freigegeben':'Noch zu prüfen'}</small></span></div>`).join('')||'<p class="small">Kein Verein mit beiden Wappendateien gefunden.</p>';
        list.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
      };
      const choose=async index=>{
        const candidate=matches[index]?.club;if(!candidate||busy)return;busy=true;close();input.value=candidate.name;
        const controls=[...form.querySelectorAll('button,input')],disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
        try {status('Original und Freistellung von '+candidate.name+' werden übernommen …');await api('POST',{action:'reuse_club_crest',clubId:club.id,sourceClubId:candidate.id});preparedCrests.delete(club.id);await reload();status('Original und transparentes Wappen von '+candidate.name+' übernommen.'+(candidate.crest_status==='approved'?' Die vorhandene Freigabe wurde übernommen.':' Bitte noch prüfen und freigeben.'));}
        catch(error){status('Wappen konnte nicht übernommen werden: '+error.message);input.value='';}
        finally{busy=false;controls.forEach((control,index)=>control.disabled=disabled[index]);}
      };
      input.onfocus=open;input.onclick=()=>{if(list.hidden)open();};input.oninput=open;
      input.onkeydown=event=>{
        if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();}
        else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();if(list.hidden)open();active=matches.length?(active<0?(event.key==='ArrowDown'?0:matches.length-1):(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length):-1;highlight();}
        else if(event.key==='Enter'){event.preventDefault();if(!list.hidden&&active>=0)choose(active);}
        else if(event.key==='Tab')close();
      };
      list.onmousedown=event=>event.preventDefault();list.onclick=event=>{const option=event.target.closest('[data-crest-option]');if(option)choose(Number(option.dataset.crestOption));};input.onblur=close;
    });
  }
  return {downloadHtml,sourceHtml,reuseHtml,wire,prepare};
}
