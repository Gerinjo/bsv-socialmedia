export function createBrandPreview(root) {
  let saved,colors,theme;
  const snowRoot=document.createElement('div');root.querySelector('[data-brand-preview="homepage"]').append(snowRoot);const snow=createSeasonalSnow(snowRoot);
  const stage=document.createElement('div'),large=root.querySelector('#brandPreviewLarge'),largeSnowRoot=document.createElement('div');stage.className='brand-preview-stage';large.before(stage);stage.append(large,largeSnowRoot);const largeSnow=createSeasonalSnow(largeSnowRoot);
  const url=svg=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  const download=(name,body,type)=>{const link=document.createElement('a'),href=URL.createObjectURL(new Blob([body],{type}));link.href=href;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);};
  const palettes=root.querySelector('#brandPalettes');
  palettes.innerHTML=SUITE_BRAND_PALETTES.map(palette=>{
    const ribbon=suiteBrandRibbon(palette.colors),swatches=ribbon.length?ribbon:[palette.colors.background,palette.colors.panel,palette.colors.primary,palette.colors.accent,palette.colors.muted,palette.colors.surface];
    return `<button type="button" class="brand-palette secondary" data-brand-palette="${palette.key}" aria-pressed="false"><span class="brand-palette-swatches" aria-hidden="true">${swatches.map(color=>`<span style="background:${color}"></span>`).join('')}</span><strong>${palette.label.replace('Vereinsjubiläum','Vereins&shy;jubiläum')}</strong><small>${palette.description}</small><span class="brand-palette-check" aria-hidden="true">✓</span></button>`;
  }).join('');
  const syncColors=()=>{for(const input of root.querySelectorAll('[data-brand-color]'))input.value=colors[input.dataset.brandColor];};
  for(const button of palettes.querySelectorAll('[data-brand-palette]'))button.onclick=()=>{const palette=SUITE_BRAND_PALETTES.find(item=>item.key===button.dataset.brandPalette);colors={...palette.colors};syncColors();render();};
  function render() {
    snow.setTheme(theme);
    for(const item of BRAND_PREVIEWS){const image=root.querySelector(`[data-brand-preview="${item.key}"] img`);image.src=url(brandPreviewSvg(item.key,colors,theme));}
    for(const input of root.querySelectorAll('[name="bsvTheme"]')){input.checked=input.value===theme;const art=input.parentElement.querySelector('.brand-theme-art');art.style.backgroundColor=colors.panel;art.innerHTML=brandThemeSvg(input.value,colors);}
    const palette=suiteBrandPalette(colors);
    for(const button of palettes.querySelectorAll('[data-brand-palette]'))button.setAttribute('aria-pressed',String(button.dataset.brandPalette===palette?.key));
    root.querySelector('#brandPaletteStatus').textContent=palette?`Ausgewählt: ${palette.label}`:'Individuelles Farbschema';
    const dirty=JSON.stringify(colors)!==JSON.stringify(saved.colors)||theme!==saved.theme;
    root.querySelector('#brandDraftStatus').textContent=dirty?'Vorschau deiner Änderungen · noch nicht gespeichert':'Vorschau des gespeicherten BSV-Standards';
    root.querySelector('#brandRevert').disabled=!dirty;
    root.querySelector('#brandSave').classList.toggle('brand-save-dirty',dirty);
    root.querySelector('#brandSave').textContent=dirty?'BSV-Standard speichern · geändert':'BSV-Standard speichern';
  }
  root.querySelector('#bsvStandardForm').addEventListener('input',event=>{
    if(event.target.matches('[data-brand-color]'))colors={...colors,[event.target.dataset.brandColor]:event.target.value};
    if(event.target.name==='bsvTheme')theme=suiteBrandTheme(event.target.value);
    render();
  });
  root.querySelector('#brandRevert').onclick=()=>{colors={...saved.colors};theme=saved.theme;for(const input of root.querySelectorAll('[data-brand-color]'))input.value=colors[input.dataset.brandColor];render();};
  root.querySelector('#brandLetterDownload').onclick=()=>download('bsv-nordstern-briefvorlage.html',brandLetterHtml(colors,theme),'text/html;charset=utf-8');
  const dialog=root.querySelector('#brandPreviewDialog');let selected='homepage';
  for(const button of root.querySelectorAll('[data-brand-preview]'))button.onclick=()=>{selected=button.dataset.brandPreview;root.querySelector('#brandPreviewTitle').textContent=BRAND_PREVIEWS.find(item=>item.key===selected).label+' · Beispielvorschau';root.querySelector('#brandPreviewLarge').src=url(brandPreviewSvg(selected,colors,theme));dialog.showModal();largeSnow.setTheme(selected==='homepage'?theme:'football');};
  root.querySelector('#brandPreviewClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>largeSnow.setTheme('football'));
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
