import assert from 'node:assert/strict';
import test from 'node:test';
import {createSponsorEditState,sponsorEditIsDirty,sponsorEditHasImage,persistSponsorEdits,sponsorContractDefaults} from '../src/sponsor-editor.mjs';
const partner={id:'graf',name:'Garten Graf',active:true,sort_order:100,automatic_renewal:true,logo_transparent_path:'sponsors/digital.png',logo_white_path:'sponsors/white.png',logo_status:'approved',magazine_ad_path:'sponsors/print.png',magazine_ad_status:'approved'};
const digital={originalDataUrl:'original',transparentDataUrl:'digital',whiteDataUrl:'white'};
const magazine={originalDataUrl:'banner-original',imageDataUrl:'banner'};
function fixture(failAction) {
  const state=createSponsorEditState(partner),calls=[];
  let fail=failAction;
  const api=async(method,body)=>{
    assert.equal(method,'POST');calls.push(body);
    if(body.action===fail){fail=null;throw new Error('Connection failed');}
    if(body.action==='save_sponsor_logo')return {sponsor:{logo_transparent_path:'sponsors/new/digital.png',logo_white_path:'sponsors/new/white.png',logo_status:'needs_review'}};
    if(body.action==='save_sponsor_magazine_ad')return {sponsor:{magazine_ad_path:'sponsors/new/banner.png',magazine_ad_status:'needs_review'}};
    return {ok:true};
  };
  return {state,calls,api};
}
test('new sponsor defaults use the club date, an open end and automatic renewal',()=>{
  assert.deepEqual(sponsorContractDefaults(new Date('2026-11-01T23:30:00Z')),{contractStartDate:'2026-11-02',contractEndDate:'',automaticRenewal:true,active:true});
  assert.equal(sponsorContractDefaults(new Date('2026-07-01T22:30:00Z')).contractStartDate,'2026-07-02');
});
test('editing metadata, activity or either image makes the shared save action dirty',()=>{
  const {state}=fixture();assert.equal(Boolean(sponsorEditIsDirty(state)),false);
  state.values.name='Geändert';assert.equal(Boolean(sponsorEditIsDirty(state)),true);state.values.name=partner.name;
  state.values.active=false;assert.equal(Boolean(sponsorEditIsDirty(state)),true);state.values.active=true;
  state.magazine.pending=true;assert.equal(Boolean(sponsorEditIsDirty(state)),true);state.magazine.pending=false;
  state.digital.discard=true;assert.equal(Boolean(sponsorEditIsDirty(state)),true);
});
test('one approval saves metadata and both images before releasing them',async()=>{
  const {state,calls,api}=fixture();state.values.name='Graf Gartenbau';state.digital.prepared=digital;state.magazine.prepared=magazine;
  await persistSponsorEdits(state,{api,approve:true});
  assert.deepEqual(calls.map(call=>call.action),['save_sponsor','save_sponsor_logo','save_sponsor_magazine_ad','approve_sponsor_logo','approve_sponsor_magazine_ad']);
  assert.equal(Boolean(sponsorEditIsDirty(state)),false);assert.equal(state.sponsor.logo_status,'approved');assert.equal(state.sponsor.magazine_ad_status,'approved');
});
test('saving keeps both newly uploaded images pending until the shared approval',async()=>{
  const {state,calls,api}=fixture();state.digital.prepared=digital;state.magazine.prepared=magazine;
  await persistSponsorEdits(state,{api});assert.deepEqual(calls.map(call=>call.action),['save_sponsor_logo','save_sponsor_magazine_ad']);
  assert.equal(state.sponsor.logo_status,'needs_review');assert.equal(state.sponsor.magazine_ad_status,'needs_review');
});
test('a failed second upload retains the draft and retries only its unfinished step',async()=>{
  const {state,calls,api}=fixture('save_sponsor_magazine_ad');state.values.active=false;state.digital.prepared=digital;state.magazine.prepared=magazine;
  await assert.rejects(persistSponsorEdits(state,{api}),/Connection/);
  assert.equal(state.digital.prepared,null);assert.deepEqual(state.magazine.prepared,magazine);assert.equal(Boolean(sponsorEditIsDirty(state)),true);
  await persistSponsorEdits(state,{api});assert.deepEqual(calls.map(call=>call.action),['save_sponsor','save_sponsor_logo','save_sponsor_magazine_ad','save_sponsor_magazine_ad']);
  assert.equal(Boolean(sponsorEditIsDirty(state)),false);
});
test('a failed approval is recoverable without uploading or saving accepted changes again',async()=>{
  const {state,calls,api}=fixture('approve_sponsor_magazine_ad');state.digital.prepared=digital;state.magazine.prepared=magazine;
  await assert.rejects(persistSponsorEdits(state,{api,approve:true}),/Connection/);
  const accepted=calls.length;await persistSponsorEdits(state,{api,approve:true});assert.deepEqual(calls.slice(accepted).map(call=>call.action),['approve_sponsor_magazine_ad']);
});
test('discarding the digital image leaves the magazine image and its approval intact',async()=>{
  const {state,calls,api}=fixture();state.digital.discard=true;await persistSponsorEdits(state,{api});
  assert.deepEqual(calls.map(call=>call.action),['discard_sponsor_logo']);assert.equal(sponsorEditHasImage(state,'digital'),false);assert.equal(sponsorEditHasImage(state,'magazine'),true);assert.equal(state.sponsor.magazine_ad_status,'approved');
});
