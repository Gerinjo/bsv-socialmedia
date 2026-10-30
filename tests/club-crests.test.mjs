import test from 'node:test';
import assert from 'node:assert/strict';
import {isJointClub,crestClubSuggestions,crestDownloadName} from '../src/club-crests.mjs';
import {crestSourceImageUrl,fetchClubCrestImage,handleClubCrestTools} from '../supabase/functions/_shared/club-crest-tools.mjs';
const partner=(id,name,extra={})=>({id,name,crest_status:'approved',crest_original_url:'https://example.org/'+id+'.jpg',crest_transparent_url:'https://example.org/'+id+'.png',...extra});

test('joint clubs offer the available constituent clubs, rank matching names and support aliases and umlauts',()=>{
 const club={id:'joint',name:'SG Aach-Linz/Denkingen'};
 const clubs=[partner('other','SV Unbeteiligt'),partner('denkingen','SV Denkingen'),partner('aach','TSV Aach-Linz'),partner('missing','FC Denkingen',{crest_transparent_url:null}),partner('rejected','SV Denkingen Alt',{crest_status:'rejected'}),partner('joint',club.name)];
 for(const name of ['SG Aach-Linz/Denkingen','JSG Hegau','SGM Beispiel','Spielgemeinschaft Nord']) assert.ok(isJointClub({name}),name);
 assert.ok(!isJointClub({name:'SV Denkingen'}));
 const result=crestClubSuggestions(club,clubs);
 assert.deepEqual(result.map(item=>item.club.id),['aach','denkingen','other']);
 assert.deepEqual(crestClubSuggestions(club,clubs,'DENK').map(item=>item.club.id),['denkingen']);
 assert.equal(crestClubSuggestions({id:'y',name:'SG Liggeringen/Gütt.'},[partner('g','SV Güttingen')])[0].score,125);
 assert.equal(crestClubSuggestions({id:'y',name:'SG Moos / Bankholzen'},[partner('b','SC Bankh.-Moos')],'bankh')[0].club.id,'b');
 assert.equal(crestDownloadName({name:'SG Öhningen / Moos'},'original','https://example.org/wappen.svg?token=x'),'sg-ohningen-moos-wappen-original.svg');
 assert.equal(crestDownloadName({name:'SV Denkingen'},'transparent'),'sv-denkingen-wappen-transparent.png');
});
const png=Uint8Array.from([137,80,78,71,13,10,26,10,...Array(24).fill(0)]);
test('source import resolves official club pages and preserves actual image bytes, with bounded redirects and body size',async()=>{
 const page='https://www.fussball.de/verein/example/-/id/00ES8GN9CG00007IVV0AG08LVUPGND5I';
 assert.equal(crestSourceImageUrl(page).href,'https://www.fussball.de/export.media/-/action/getLogo/id/00ES8GN9CG00007IVV0AG08LVUPGND5I');
 const visited=[];
 const image=await fetchClubCrestImage(page,{fetcher:async(url,options)=>{visited.push(url.href);assert.equal(options.redirect,'manual');return new Response(png,{headers:{'content-type':'application/octet-stream'}});}});
 assert.equal(image.mime,'image/png');assert.equal(image.dataUrl,'data:image/png;base64,'+Buffer.from(png).toString('base64'));
 assert.equal(visited.length,1);
 await assert.rejects(()=>fetchClubCrestImage(page,{fetcher:async()=>new Response('<html>Page</html>')}),/kein unterstütztes Bild/);
 await assert.rejects(()=>fetchClubCrestImage(page,{fetcher:async()=>new Response(png,{headers:{'content-length':String(6*1024*1024)}})}),/höchstens 5 MB/);
 await assert.rejects(()=>fetchClubCrestImage(page,{fetcher:async()=>new Response(null,{status:302,headers:{location:page}})}),/Weiterleitungsschleife/);
 const publicImage=await fetchClubCrestImage('https://verein.example/wappen.png',{resolveDns:async(_host,type)=>type==='A'?['93.184.216.34']:[],fetcher:async()=>new Response(png)});
 assert.equal(publicImage.mime,'image/png');
});
test('source import never requests private addresses or unsafe redirects',async()=>{
 let requests=0;
 const fetcher=async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/secret'}});};
 for(const url of ['http://example.org/x','file:///etc/passwd','https://user:pass@example.org/x','https://127.0.0.1/x','https://169.254.169.254/latest','https://[::1]/x','https://2130706433/x','https://localhost/x','https://www.fussball.de:8443/x']) {
  await assert.rejects(()=>fetchClubCrestImage(url,{fetcher}));
 }
 assert.equal(requests,0);
 await assert.rejects(()=>fetchClubCrestImage('https://rebind.example/x',{fetcher,resolveDns:async()=>['10.0.0.1']}),/öffentlich erreichbaren/);assert.equal(requests,0);
 await assert.rejects(()=>fetchClubCrestImage('https://www.fussball.de/image.png',{fetcher}),/nicht öffentlich/);assert.equal(requests,1);
});
function crestDatabase({sourceStatus='approved',failCopy=0,stale=false}={}) {
 const target={id:'sg',slug:'sg-aach-linz-denkingen',name:'SG Aach-Linz/Denkingen',updated_at:'before',crest_original_path:'old/original.png'};
 const source={id:'sv',name:'SV Denkingen',crest_status:sourceStatus,crest_original_path:'source/original.svg',crest_transparent_path:'source/transparent.png',crest_source_url:'https://example.org/logo.svg',transparency_confidence:1,transparency_metadata:{reviewed:true}};
 const calls=[];let copied=0;
 const db={from:()=>{const call={};const q=new Proxy({},{get:(_t,key)=>key==='then'?(resolve)=>resolve({data:call.update?(stale?null:{...target,...call.update}):call.id==='sv'?source:target,error:null}):(...args)=>{if(key==='eq'){if(args[0]==='id')call.id=args[1];calls.push(['eq',...args]);}if(key==='update'){call.update=args[0];calls.push(['update',args[0]]);}return q;}});return q;},storage:{from:bucket=>({copy:async(from,to)=>{calls.push(['copy',bucket,from,to]);copied++;return {error:copied===failCopy?{message:'failure'}:null};},remove:async paths=>{calls.push(['remove',paths]);return {error:null};}})}};
 return {db,calls,target,source};
}
test('selecting a club copies original and transparency independently, preserves approval and guards concurrent target edits',async()=>{
 const {db,calls,source}=crestDatabase();
 const result=await handleClubCrestTools(db,'actor',{action:'reuse_club_crest',clubId:'sg',sourceClubId:'sv'},{uuid:()=> 'unique'});
 assert.equal(result.club.crest_status,'approved');assert.equal(result.club.crest_original_path,'club-crests/sg-aach-linz-denkingen/unique/original.svg');
 assert.equal(result.club.crest_transparent_path,'club-crests/sg-aach-linz-denkingen/unique/transparent.png');
 assert.equal(result.club.transparency_metadata.copiedFromClubId,'sv');assert.equal(result.club.transparency_metadata.copiedBy,'actor');
 assert.equal(source.crest_original_path,'source/original.svg');assert.equal(calls.filter(call=>call[0]==='copy').length,2);assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='updated_at'&&call[2]==='before'));
 const review=crestDatabase({sourceStatus:'needs_review'});assert.equal((await handleClubCrestTools(review.db,'actor',{action:'reuse_club_crest',clubId:'sg',sourceClubId:'sv'})).club.crest_status,'needs_review');
 for(const config of [{failCopy:2},{stale:true}]) {
  const broken=crestDatabase(config);await assert.rejects(()=>handleClubCrestTools(broken.db,'actor',{action:'reuse_club_crest',clubId:'sg',sourceClubId:'sv'},{uuid:()=> 'failed'}));
  const cleaned=broken.calls.find(call=>call[0]==='remove')[1];assert.equal(cleaned.length,config.failCopy?1:2);assert.ok(cleaned.every(path=>path.includes('/failed/')));
 }
 const rejected=crestDatabase({sourceStatus:'rejected'});await assert.rejects(()=>handleClubCrestTools(rejected.db,'actor',{action:'reuse_club_crest',clubId:'sg',sourceClubId:'sv'}));assert.equal(rejected.calls.filter(call=>call[0]==='copy').length,0);
});
