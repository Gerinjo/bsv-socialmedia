// One viewer for existing photos and dynamically rendered/uploaded previews.
function createSuitePhotoPreview({window,document,styleText=''}) {
  const existing=document.getElementById('suitePhotoDialog');
  if(existing)return;
  if(styleText){const style=document.createElement('style');style.textContent=styleText;document.head.append(style);}
  const selector='img[data-suite-photo],img.trainer-avatar,img.trainer-team-thumb,.trainer-team-photo-preview img,.employee-portrait img,.employee-photo-preview img,#personPreview img,img.birthday-photo,img#edTeamPhotoPreview,.ed-gallery-image img,.editorial-person-photo img,.sports-team-photo img,.team-photo-spread img,.newsletter-portrait img';
  const dialog=document.createElement('dialog');
  dialog.id='suitePhotoDialog';
  dialog.setAttribute('aria-labelledby','suitePhotoTitle');
  dialog.innerHTML='<header class="suite-photo-header"><div><p>Bildvorschau</p><h2 id="suitePhotoTitle"></h2></div><button type="button" class="suite-photo-close" aria-label="Bildvorschau schließen" autofocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="suite-photo-stage"><img alt="" hidden><p class="suite-photo-status" role="status"></p></div>';
  document.body.append(dialog);
  const image=dialog.querySelector('img'),status=dialog.querySelector('[role=status]'),closeButton=dialog.querySelector('button');
  let opener=null,previousOverflow='',outsideStart=false;
  const label=photo=>photo.alt.trim()||'Personen- oder Mannschaftsbild';
  function enhance(node){
    if(node.nodeType!==1)return;
    const photos=[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)];
    for(const photo of photos){
      if(photo.closest('button,a'))continue;
      photo.setAttribute('role','button');photo.tabIndex=0;
      photo.setAttribute('aria-haspopup','dialog');photo.setAttribute('aria-controls',dialog.id);
      photo.setAttribute('aria-label',label(photo)+' groß ansehen');
      photo.title='Bild vergrößern';photo.classList.add('suite-photo-trigger');
    }
  }
  function open(photo){
    const src=photo.dataset.photoFull||photo.currentSrc||photo.getAttribute('src');
    if(!src||photo.hidden||photo.closest('[hidden]'))return;
    opener=photo;
    dialog.style.removeProperty('--suite-photo-ratio');
    dialog.querySelector('h2').textContent=label(photo);
    image.hidden=true;image.alt=label(photo);
    status.hidden=false;status.textContent='Bild wird geladen …';
    dialog.setAttribute('aria-busy','true');
    image.onload=()=>{dialog.style.setProperty('--suite-photo-ratio',String(image.naturalWidth/image.naturalHeight));image.hidden=false;status.hidden=true;dialog.removeAttribute('aria-busy');};
    image.onerror=()=>{image.hidden=true;status.textContent='Das Bild konnte nicht geladen werden.';dialog.removeAttribute('aria-busy');};
    image.src=src;
    previousOverflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow='hidden';
    dialog.showModal();closeButton.focus({preventScroll:true});
  }
  function activate(event){
    if(dialog.open||!(event.target instanceof window.Element))return;
    const photo=event.target.closest(selector);
    if(!photo||photo.closest('button,a'))return;
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    if(event.type==='click'&&(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey))return;
    event.preventDefault();event.stopPropagation();open(photo);
  }
  function keydown(event){
    if(dialog.open){if(['Escape','ArrowLeft','ArrowRight'].includes(event.key))event.stopPropagation();return;}
    activate(event);
  }
  function outside(event){const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;}
  closeButton.onclick=()=>dialog.close();
  dialog.addEventListener('pointerdown',event=>{outsideStart=event.target===dialog&&outside(event);});
  dialog.addEventListener('click',event=>{if(outsideStart&&event.target===dialog&&outside(event))dialog.close();outsideStart=false;});
  dialog.addEventListener('close',()=>{
    image.onload=image.onerror=null;image.removeAttribute('src');image.hidden=true;
    dialog.removeAttribute('aria-busy');
    document.documentElement.style.overflow=previousOverflow;
    if(opener?.isConnected)opener.focus({preventScroll:true});opener=null;
  });
  enhance(document.body);
  const observer=new window.MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')enhance(record.target);
      else for(const node of record.addedNodes)enhance(node);
    }
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','alt','data-suite-photo']});
  document.addEventListener('click',activate,true);
  document.addEventListener('keydown',keydown,true);
  return {dialog,destroy(){if(dialog.open)dialog.close();observer.disconnect();document.removeEventListener('click',activate,true);document.removeEventListener('keydown',keydown,true);dialog.remove();}};
}

// Private editorial browser previews use the same viewer inside their frame.
function suitePhotoPreviewHtml(html){
  const script='('+createSuitePhotoPreview.toString()+')({window,document,styleText:'+JSON.stringify(SUITE_PHOTO_PREVIEW_CSS)+'});';
  return html.replace('</body>','<script>'+script.replaceAll('</script','<\\/script')+'</script></body>');
}
