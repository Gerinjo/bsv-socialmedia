// Dependencies and fonts are supplied by Node (preview/tests) or the Edge API.
export async function renderTrainerContractPdf(pages,{PDFDocument,fontkit,rgb,regularBytes,boldBytes},{number='Entwurf',templateVersion,draft=false,layout,layoutOnly=false,signatures=[]}={}){
 if(layout){layout.signatures=[];layout.fields=[];}
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const regular=await pdf.embedFont(regularBytes,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true});
 pdf.setTitle('BSV Nordstern · Trainervertrag · '+number);pdf.setAuthor('BSV Nordstern e.V. Radolfzell');pdf.setLanguage('de-DE');
 const ink=rgb(.10,.19,.15),green=rgb(.08,.34,.23),muted=rgb(.37,.43,.40);let page,y;
 // Avoid repeatedly shaping complete lines: Edge requests have a bounded CPU budget.
 const widthCache=new Map();
 const measured=(text,font,size)=>{let cache=widthCache.get(font);if(!cache){cache=new Map();widthCache.set(font,cache);}const key=size+'|'+text;if(!cache.has(key))cache.set(key,font.widthOfTextAtSize(text,size));return cache.get(key);};
 const wrap=(text,font,size,width)=>{const lines=[],space=measured(' ',font,size);for(const paragraph of String(text).split('\n')){let line='',lineWidth=0;for(const word of paragraph.split(/\s+/)){if(!word)continue;const wordWidth=measured(word,font,size);if(line&&lineWidth+space+wordWidth>width){lines.push(line);line='';lineWidth=0;}if(wordWidth>width){let segment='';for(const c of word){if(measured(segment+c,font,size)>width){lines.push(segment);segment='';}segment+=c;}line=segment;lineWidth=measured(segment,font,size);}else{lineWidth+=(line?space:0)+wordWidth;line+=(line?' ':'')+word;}}lines.push(line);}return lines;};
 const start=title=>{page=pdf.addPage([595.28,841.89]);if(layoutOnly){page.drawText=()=>{};page.drawLine=()=>{};page.drawRectangle=()=>{};}page.drawRectangle({x:42,y:791,width:511,height:4,color:green});page.drawText('BSV NORDSTERN',{x:42,y:811,font:bold,size:14,color:green});page.drawText('RADOLFZELL · SEIT 1956',{x:350,y:814,font:regular,size:8,color:muted});y=764;for(const line of wrap(title,bold,17,510)){page.drawText(line,{x:42,y,font:bold,size:17,color:ink});y-=23;}y-=12;};
 for(const section of pages){start(section.title);for(const block of section.blocks){
  if(block.kind==='ink'){if(y-90<49)start(section.title+' · Fortsetzung');for(const stroke of block.strokes)for(let i=1;i<stroke.length;i++)page.drawLine({start:{x:42+stroke[i-1][0]*400,y:y-stroke[i-1][1]*75},end:{x:42+stroke[i][0]*400,y:y-stroke[i][1]*75},thickness:1.2,color:ink});y-=95;continue;}
  const font=block.kind==='h'?bold:regular,size=block.kind==='h'?11:9.5,lineHeight=block.kind==='h'?16:13;
  const text=block.kind==='field'?block.label+': '+block.text:block.text;
  const lines=wrap(text,font,size,block.kind==='check'?486:510),height=block.kind==='signature'?58:lines.length*lineHeight+(block.kind==='h'?10:block.kind==='field'?9:9);
  if(y-height<49)start(section.title+' · Fortsetzung');
  if(block.kind==='signature'){y-=29;if(layout&&block.part)layout.signatures.push({part:block.part,page:pdf.getPageCount()-1,y});page.drawLine({start:{x:42,y},end:{x:535,y},thickness:.5,color:muted});const signed=signatures.find(s=>s.part===block.part);if(signed&&!layoutOnly)drawContractSignature(page,signed,y,regular,ink);y-=15;for(const line of wrap(block.text,regular,8,510)){page.drawText(line,{x:42,y,font:regular,size:8,color:muted});y-=11;}y-=4;}
  else{if(layout&&block.key)layout.fields.push({key:block.key,label:block.label,page:pdf.getPageCount()-1,y,lines:lines.length});if(block.kind==='check'){page.drawRectangle({x:43,y:y-2,width:8,height:8,borderWidth:.6,borderColor:ink});if(block.checked){page.drawLine({start:{x:44,y:y-1},end:{x:50,y:y+5},thickness:1,color:ink});page.drawLine({start:{x:44,y:y+5},end:{x:50,y:y-1},thickness:1,color:ink});}}for(const line of lines){page.drawText(line,{x:block.kind==='check'?60:42,y,font,size,color:block.kind==='h'?green:ink});y-=lineHeight;}y-=block.kind==='h'?10:9;}
  if(layout&&block.signatureAfter)layout.signatures.push({part:block.signatureAfter,page:y-70>=49?pdf.getPageCount()-1:null,y:y-32,extra:true});
 }}
 const all=pdf.getPages();if(layout)layout.pageCount=all.length;if(layoutOnly)return new Uint8Array();all.forEach((p,i)=>{p.drawLine({start:{x:42,y:39},end:{x:553,y:39},thickness:.5,color:muted});p.drawText(`${number} · Vorlage ${templateVersion||''} · ${i+1}/${all.length}`,{x:42,y:25,font:regular,size:7,color:muted});if(draft)p.drawText('ENTWURF · NOCH NICHT FREIGEGEBEN',{x:220,y:51,font:bold,size:9,color:rgb(.65,.25,.18),opacity:.75});});
 if(layout)layout.pageCount=all.length;
 return pdf.save();
}

// Annotate the verified issued PDF; never replace its original page contents or
// its archived bytes/hash. Positions come from the same versioned layout, so
// long names and page breaks do not move signatures onto unrelated text.
export async function annotateTrainerContractPdf(base,pages,signatures,deps,options={}){
 if(options.templateVersion!=='2026-11-03.1')throw new Error('Diese Vertragsvorlage benötigt eine eigene Zuordnung der Unterschriftsfelder. Bitte die Originalfassung verwenden.');
 const {PDFDocument,fontkit,rgb,regularBytes}=deps,layout={};
 const pdf=await PDFDocument.load(base,{updateMetadata:false});
 await renderTrainerContractPdf(pages,deps,{...options,layout,layoutOnly:true});
 // Earlier issues of this same template included all three blank payout forms.
 // Measure that known complete packet as well, retaining every original page.
 if(pdf.getPageCount()!==layout.pageCount&&options.legacyAppendix?.length)await renderTrainerContractPdf([...pages,...options.legacyAppendix],deps,{...options,layout,layoutOnly:true});
 if(pdf.getPageCount()!==layout.pageCount)throw new Error('Die Vertragsseiten passen nicht zur freigegebenen Vorlage. Bitte die Originalfassung prüfen.');
 pdf.registerFontkit(fontkit);const font=await pdf.embedFont(regularBytes,{subset:true}),ink=rgb(.1,.19,.15),muted=rgb(.37,.43,.4);
 for(const s of signatures){const anchor=layout.signatures.find(a=>a.part===s.part);if(!anchor)continue;
  let page=anchor.page===null?null:pdf.getPage(anchor.page),lineY=anchor.y;
  if(!page){page=pdf.addPage([595.28,841.89]);lineY=570;page.drawText('Freibetragserklärung · §§ 5 und 6',{x:42,y:775,font,size:16,color:ink});page.drawText(options.number||'Trainervertrag',{x:42,y:747,font,size:10,color:ink});page.drawText('Persönliche Unterschrift zur Erklärung im zugehörigen Vertrag.',{x:42,y:721,font,size:10,color:ink});page.drawText('Die erfassten Jahresbeträge stehen im Unterschriftsnachweis im Anhang.',{x:42,y:699,font,size:10,color:ink});}
  if(anchor.extra){page.drawLine({start:{x:42,y:lineY},end:{x:535,y:lineY},thickness:.5,color:muted});page.drawText('Ort / Datum · Persönliche Unterschrift zur Freibetragserklärung (§§ 5 und 6)',{x:42,y:lineY-15,font,size:8,color:muted});}
  drawContractSignature(page,s,lineY,font,ink);
  if(s.part==='allowance')for(const field of layout.fields.filter(f=>f.key.startsWith('allowance_'))){const amount=s.values[field.key.slice(10)];if(!Number.isSafeInteger(amount)||field.lines!==1)throw new Error('Die Freibetragsangaben passen nicht zur freigegebenen Vorlage.');const target=pdf.getPage(field.page),text=field.label+': '+new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount/100);target.drawRectangle({x:41,y:field.y-3,width:512,height:15,color:rgb(1,1,1)});target.drawText(text,{x:42,y:field.y,font,size:9.5,color:ink});}
 }
 if(options.guardianConfirmed){const a=layout.signatures.find(a=>a.part==='guardian');if(a)pdf.getPage(a.page).drawText('Unterschriebene Elternzustimmung: siehe beigefügtes PDF.',{x:42,y:a.y+10,font,size:8,color:ink});}
 return pdf.save();
}

function drawContractSignature(page,s,lineY,font,ink){
  // Keep the natural 700:170 canvas aspect ratio and crop blank canvas margins.
  const points=s.strokes.flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),scale=Math.min(210/Math.max((right-left)*700,1),25/Math.max((bottom-top)*170,1));
  for(const stroke of s.strokes)page.drawSvgPath(stroke.map((p,i)=>(i?'L':'M')+' '+(p[0]-left)*700*scale+' '+(p[1]-top)*170*scale).join(' '),{x:315,y:lineY+3+(bottom-top)*170*scale,borderWidth:1.1,borderColor:ink});
  const fit=(text,width)=>{let size=8;while(font.widthOfTextAtSize(text,size)>width&&size>5)size-=.25;return size;};
  const name=s.signer_name||'',stamp=s.place+' · '+new Date(s.signed_at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'});
  page.drawText(name,{x:42,y:lineY+17,font,size:fit(name,260),color:ink});page.drawText(stamp,{x:42,y:lineY+5,font,size:fit(stamp,260),color:ink});
}
