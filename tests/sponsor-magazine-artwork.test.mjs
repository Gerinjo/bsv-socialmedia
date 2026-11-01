import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { handleSponsorMagazineArtwork, magazineArtworkSource, sponsorArtworkPaths, magazinePngDimensions } from '../supabase/functions/_shared/sponsor-magazine-artwork.mjs';
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
const dataUrl = bytes => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
const original = {id:'graf',slug:'garten-graf',logo_original_path:'sponsors/graf/original.svg',logo_transparent_path:'sponsors/graf/transparent.png',logo_white_path:'sponsors/graf/white.png',logo_status:'approved',magazine_ad_original_path:'sponsors/graf/original.svg',magazine_ad_path:'sponsors/graf/transparent.png',magazine_ad_status:'approved'};
function fixture({failUpload=0,failSave=false,sponsor=original}={}) {
  const state=structuredClone(sponsor),uploads=[],removed=[],patches=[];
  const storage={upload:async(path,bytes,options)=>{uploads.push({path,bytes,options});return {error:uploads.length===failUpload?{message:'Upload failed'}:null};},remove:async paths=>{removed.push(...paths);return {error:null};}};
  const admin={storage:{from:bucket=>{assert.equal(bucket,'social-story-previews');return storage;}},from:table=>{
    assert.equal(table,'social_sponsors');let patch;
    const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:structuredClone(state)}),update:value=>{patch=value;return q;},single:async()=>{if(failSave)return {error:{message:'Save failed'}};patches.push(patch);Object.assign(state,patch);return {data:structuredClone(state)};}};return q;
  }};
  const parseDataUrl=(url,allowed,max)=>{const [prefix,encoded]=url.split(',');const mime=prefix.slice(5,-7);const bytes=new Uint8Array(Buffer.from(encoded,'base64'));if(!allowed.has(mime)||bytes.length>max)throw new Error('Invalid image');return {mime,bytes};};
  const call=(action,body={})=>handleSponsorMagazineArtwork({action,body:{sponsorId:'graf',...body},admin,userId:'editor',parseDataUrl,DOMParser,XMLSerializer});
  return {state,uploads,removed,patches,call};
}
const body={originalDataUrl:dataUrl(png),imageDataUrl:dataUrl(png),fileName:'Anzeige.png',width:1234,height:5678};

test('magazine uses its independently approved advertisement; pending or rejected art is never published',()=>{
  assert.equal(magazineArtworkSource({...original,logo_status:'rejected'}),original.magazine_ad_path);
  assert.equal(magazineArtworkSource({...original,magazine_ad_status:'needs_review'}),null);
  assert.equal(magazineArtworkSource({...original,magazine_ad_status:'rejected'}),null);
  assert.equal(magazineArtworkSource({...original,magazine_ad_path:null}),original.logo_transparent_path);
  assert.equal(magazineArtworkSource({...original,magazine_ad_path:null,logo_status:'rejected'}),null);
});
test('channel deletion protects shared legacy originals and the other channel',()=>{
  assert.deepEqual(sponsorArtworkPaths(original,'digital'),[original.logo_white_path]);
  assert.deepEqual(sponsorArtworkPaths(original,'magazine'),[]);
  assert.equal(sponsorArtworkPaths(original,'all').length,3);
  const separate={...original,magazine_ad_original_path:'sponsors/graf/magazine/new.svg',magazine_ad_path:'sponsors/graf/magazine/new.png'};
  assert.equal(sponsorArtworkPaths(separate,'digital').length,3);
  assert.deepEqual(sponsorArtworkPaths(separate,'magazine'),[separate.magazine_ad_original_path,separate.magazine_ad_path]);
});
test('upload retains original bytes, stages only magazine fields and requires independent approval',async()=>{
  const f=fixture();await f.call('save_sponsor_magazine_ad',body);
  assert.equal(f.state.logo_transparent_path,original.logo_transparent_path);assert.equal(f.state.logo_status,'approved');
  assert.match(f.state.magazine_ad_path,/\/magazine\/[a-f0-9-]+\/advertisement.png$/);assert.equal(f.state.magazine_ad_status,'needs_review');
  assert.deepEqual(f.uploads[0].bytes,png);assert.deepEqual(f.uploads[1].bytes,png);assert.equal(f.state.magazine_ad_metadata.width,1);
  assert.ok(Object.keys(f.patches[0]).every(key=>key.startsWith('magazine_ad_')));
  await f.call('approve_sponsor_magazine_ad');assert.equal(f.state.magazine_ad_status,'approved');assert.equal(f.state.logo_status,'approved');
});
test('failed uploads and database errors retain both previous assets and clean up only new files',async()=>{
  for(const config of [{failUpload:2},{failSave:true}]){
    const f=fixture(config);await assert.rejects(f.call('save_sponsor_magazine_ad',body),/failed/i);assert.deepEqual(f.state,original);
    assert.equal(f.removed.length,2);assert.ok(f.removed.every(path=>path.includes('/magazine/')));
  }
});
test('discarding a migrated advertisement retains shared digital files',async()=>{
  const f=fixture();await f.call('discard_sponsor_magazine_ad');assert.deepEqual(f.removed,[]);assert.equal(f.state.magazine_ad_path,null);assert.equal(f.state.logo_transparent_path,original.logo_transparent_path);
});
test('active SVGs and malformed or oversized PNG dimensions are rejected before upload',async()=>{
  const f=fixture();const active='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  await assert.rejects(f.call('save_sponsor_magazine_ad',{...body,originalDataUrl:active}),/ausführbare/);assert.equal(f.uploads.length,0);
  const oversized=png.slice();new DataView(oversized.buffer).setUint32(16,9000);assert.throws(()=>magazinePngDimensions(oversized),/Megapixel/);
  assert.throws(()=>magazinePngDimensions(new Uint8Array(60)),/gültiges PNG/);
});
