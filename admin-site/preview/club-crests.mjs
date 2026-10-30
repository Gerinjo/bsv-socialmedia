// Local examples only. The two sample clubs deliberately use the Suite crest as a placeholder.
const key='bsv-preview-club-crests-v1';
function load() {
  const saved=localStorage.getItem(key);if(saved)return JSON.parse(saved);
  return [
    {id:'demo-sg',slug:'sg-aach-linz-denkingen',name:'SG Aach-Linz/Denkingen',crest_status:'missing',crest_source_url:'https://www.fussball.de/export.media/-/action/getLogo/id/00ES8GN9CG00007IVV0AG08LVUPGND5I',aliases:[]},
    {id:'demo-denkingen',slug:'sv-denkingen',name:'SV Denkingen',crest_status:'approved',crest_source_url:'https://example.org/denkingen.png',crest_original_url:location.origin+'/preview-club-crest.png',crest_transparent_url:location.origin+'/preview-club-crest.png',aliases:[]},
    {id:'demo-other-crest',slug:'sc-beispiel',name:'SC Beispiel',crest_status:'approved',crest_source_url:'https://example.org/beispiel.png',crest_original_url:location.origin+'/preview-club-crest.png',crest_transparent_url:location.origin+'/preview-club-crest.png',aliases:[]},
  ];
}
export function previewClubCrests(){return structuredClone(load());}
export async function previewClubCrestAction(body) {
  const clubs=load(),club=clubs.find(club=>club.id===body.clubId);if(!club)throw new Error('Verein nicht gefunden.');
  if(body.action==='fetch_club_crest_source') {
    const response=await fetch('/preview-club-crest.png');const blob=await response.blob();
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    return {image:{dataUrl,mime:'image/png',sourceUrl:body.sourceUrl}};
  }
  if(body.action==='reuse_club_crest') {
    const source=clubs.find(club=>club.id===body.sourceClubId);if(!source?.crest_original_url||!source?.crest_transparent_url)throw new Error('Beide Wappendateien benötigt.');
    Object.assign(club,{crest_original_url:source.crest_original_url,crest_transparent_url:source.crest_transparent_url,crest_status:source.crest_status,crest_source_url:source.crest_source_url});
  } else if(body.action==='save_club_crest') {
    Object.assign(club,{crest_original_url:body.originalDataUrl,crest_transparent_url:body.transparentDataUrl,crest_status:'needs_review',crest_source_url:body.sourceUrl,transparency_confidence:body.processing.confidence});
  } else if(body.action==='approve_club_crest')club.crest_status='approved';
  else if(body.action==='reject_club_crest')club.crest_status='rejected';
  else if(body.action==='discard_club_crest')Object.assign(club,{crest_original_url:null,crest_transparent_url:null,crest_status:'missing'});
  else throw new Error('Unbekannte Wappen-Aktion.');
  localStorage.setItem(key,JSON.stringify(clubs));return {ok:true,club};
}
