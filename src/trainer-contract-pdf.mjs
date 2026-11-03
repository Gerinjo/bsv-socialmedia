// Dependencies and fonts are supplied by Node (preview/tests) or the Edge API.
export async function renderTrainerContractPdf(pages,{PDFDocument,fontkit,rgb,regularBytes,boldBytes},{number='Entwurf',templateVersion,draft=false}={}){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const regular=await pdf.embedFont(regularBytes,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true});
 pdf.setTitle('BSV Nordstern · Trainervertrag · '+number);pdf.setAuthor('BSV Nordstern e.V. Radolfzell');pdf.setLanguage('de-DE');
 const ink=rgb(.10,.19,.15),green=rgb(.08,.34,.23),muted=rgb(.37,.43,.40);let page,y;
 // Avoid repeatedly shaping complete lines: Edge requests have a bounded CPU budget.
 const widthCache=new Map();
 const measured=(text,font,size)=>{let cache=widthCache.get(font);if(!cache){cache=new Map();widthCache.set(font,cache);}const key=size+'|'+text;if(!cache.has(key))cache.set(key,font.widthOfTextAtSize(text,size));return cache.get(key);};
 const wrap=(text,font,size,width)=>{const lines=[],space=measured(' ',font,size);for(const paragraph of String(text).split('\n')){let line='',lineWidth=0;for(const word of paragraph.split(/\s+/)){if(!word)continue;const wordWidth=measured(word,font,size);if(line&&lineWidth+space+wordWidth>width){lines.push(line);line='';lineWidth=0;}if(wordWidth>width){let segment='';for(const c of word){if(measured(segment+c,font,size)>width){lines.push(segment);segment='';}segment+=c;}line=segment;lineWidth=measured(segment,font,size);}else{lineWidth+=(line?space:0)+wordWidth;line+=(line?' ':'')+word;}}lines.push(line);}return lines;};
 const start=title=>{page=pdf.addPage([595.28,841.89]);page.drawRectangle({x:42,y:791,width:511,height:4,color:green});page.drawText('BSV NORDSTERN',{x:42,y:811,font:bold,size:14,color:green});page.drawText('RADOLFZELL · SEIT 1956',{x:350,y:814,font:regular,size:8,color:muted});y=764;for(const line of wrap(title,bold,17,510)){page.drawText(line,{x:42,y,font:bold,size:17,color:ink});y-=23;}y-=12;};
 for(const section of pages){start(section.title);for(const block of section.blocks){
  if(block.kind==='ink'){if(y-90<49)start(section.title+' · Fortsetzung');for(const stroke of block.strokes)for(let i=1;i<stroke.length;i++)page.drawLine({start:{x:42+stroke[i-1][0]*400,y:y-stroke[i-1][1]*75},end:{x:42+stroke[i][0]*400,y:y-stroke[i][1]*75},thickness:1.2,color:ink});y-=95;continue;}
  const font=block.kind==='h'?bold:regular,size=block.kind==='h'?11:9.5,lineHeight=block.kind==='h'?16:13;
  const text=block.kind==='field'?block.label+': '+block.text:block.text;
  const lines=wrap(text,font,size,block.kind==='check'?486:510),height=block.kind==='signature'?58:lines.length*lineHeight+(block.kind==='h'?10:block.kind==='field'?9:9);
  if(y-height<49)start(section.title+' · Fortsetzung');
  if(block.kind==='signature'){y-=29;page.drawLine({start:{x:42,y},end:{x:535,y},thickness:.5,color:muted});y-=15;for(const line of wrap(block.text,regular,8,510)){page.drawText(line,{x:42,y,font:regular,size:8,color:muted});y-=11;}y-=4;}
  else{if(block.kind==='check'){page.drawRectangle({x:43,y:y-2,width:8,height:8,borderWidth:.6,borderColor:ink});if(block.checked){page.drawLine({start:{x:44,y:y-1},end:{x:50,y:y+5},thickness:1,color:ink});page.drawLine({start:{x:44,y:y+5},end:{x:50,y:y-1},thickness:1,color:ink});}}for(const line of lines){page.drawText(line,{x:block.kind==='check'?60:42,y,font,size,color:block.kind==='h'?green:ink});y-=lineHeight;}y-=block.kind==='h'?10:9;}
 }}
 const all=pdf.getPages();all.forEach((p,i)=>{p.drawLine({start:{x:42,y:39},end:{x:553,y:39},thickness:.5,color:muted});p.drawText(`${number} · Vorlage ${templateVersion||''} · ${i+1}/${all.length}`,{x:42,y:25,font:regular,size:7,color:muted});if(draft)p.drawText('ENTWURF · NOCH NICHT FREIGEGEBEN',{x:220,y:51,font:bold,size:9,color:rgb(.65,.25,.18),opacity:.75});});
 return pdf.save();
}
