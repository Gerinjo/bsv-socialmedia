export function createBrandPreview(root) {
  let saved,colors,theme;
  const url=svg=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  const download=(name,body,type)=>{const link=document.createElement('a'),href=URL.createObjectURL(new Blob([body],{type}));link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);};
  function render() {
    for(const item of BRAND_PREVIEWS){const image=root.querySelector(`[data-brand-preview="${item.key}"] img`);image.src=url(brandPreviewSvg(item.key,colors,theme));}
    for(const input of root.querySelectorAll('[name="bsvTheme"]')){input.checked=input.value===theme;const art=input.parentElement.querySelector('.brand-theme-art');art.style.backgroundColor=colors.panel;art.innerHTML=brandThemeSvg(input.value,colors);}
    const dirty=JSON.stringify(colors)!==JSON.stringify(saved.colors)||theme!==saved.theme;
    root.querySelector('#brandDraftStatus').textContent=dirty?'Vorschau deiner Änderungen · noch nicht gespeichert':'Vorschau des gespeicherten BSV-Standards';
    root.querySelector('#brandRevert').disabled=!dirty;
  }
  root.querySelector('#bsvStandardForm').addEventListener('input',event=>{
    if(event.target.matches('[data-brand-color]'))colors={...colors,[event.target.dataset.brandColor]:event.target.value};
    if(event.target.name==='bsvTheme')theme=suiteBrandTheme(event.target.value);
    render();
  });
  root.querySelector('#brandRevert').onclick=()=>{colors={...saved.colors};theme=saved.theme;for(const input of root.querySelectorAll('[data-brand-color]'))input.value=colors[input.dataset.brandColor];render();};
  root.querySelector('#brandLetterDownload').onclick=()=>download('bsv-nordstern-briefvorlage.html',brandLetterHtml(colors,theme),'text/html;charset=utf-8');
  const dialog=root.querySelector('#brandPreviewDialog');let selected='homepage';
  for(const button of root.querySelectorAll('[data-brand-preview]'))button.onclick=()=>{selected=button.dataset.brandPreview;root.querySelector('#brandPreviewTitle').textContent=BRAND_PREVIEWS.find(item=>item.key===selected).label+' · Beispielvorschau';root.querySelector('#brandPreviewLarge').src=url(brandPreviewSvg(selected,colors,theme));dialog.showModal();};
  root.querySelector('#brandPreviewClose').onclick=()=>dialog.close();
  root.querySelector('#brandPreviewDownload').onclick=()=>download(`bsv-nordstern-${selected}-${theme}.svg`,brandPreviewSvg(selected,colors,theme),'image/svg+xml');
  return {
    setSaved(value,key='football') {
      const next={colors:suiteBrandColors(value),theme:suiteBrandTheme(key)};
      if(JSON.stringify(saved)===JSON.stringify(next))return;
      saved=next;colors={...next.colors};theme=next.theme;
      root.querySelector('#bsvStandardColors').innerHTML=teamColorInputs(colors,'data-brand-color');
      root.querySelector('#brandThemes').innerHTML=BSV_THEMES.map(item=>`<label class="brand-theme"><input type="radio" name="bsvTheme" value="${item.key}"><span class="brand-theme-art">${brandThemeSvg(item.key)}</span><strong>${item.label}</strong><small>${item.description}</small></label>`).join('');
      render();
    },
    value:()=>({colorScheme:{...colors},themeKey:theme}),
  };
}
