import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateEditorial } from '../src/stadium-magazine/editorial-layout.mjs';
const measure = page => (page.continuation ? 40 : 160) + page.blocks.reduce((height, block) => height + (block.type === 'paragraph' ? block.text.length : 1700), 0);
test('layout preserves prose and bookings while packing up to three ads per page', () => {
  const body = 'Ein ausführlicher Bericht über unser Vereinsleben. '.repeat(110);
  const ads = ['1/2','1/3','1/6','1/4','1'].map((format, id) => ({id:String(id),format}));
  const pages = paginateEditorial([{id:'report',blocks:[{type:'paragraph',text:body}]}],ads,measure);
  assert.equal(pages.flatMap(p=>p.blocks).map(b=>b.text).join(''),body);
  assert.equal(pages.flatMap(p=>p.adSlots).length,6);
  assert.ok(pages.some(p=>!p.advertising&&p.adSlots.length));
  assert.ok(pages.every(p=>p.adSlots.length<=3));
  assert.ok(pages.filter(p=>!p.advertising).slice(1).every(p=>p.continuation));
  for(const page of pages.filter(p=>p.adSlots.length&&!p.advertising)) assert.ok(page.measuredHeight < page.adSlots[0].frame[1] * 1040*841.89/595.276);
});
test('oversized tables stay complete and do not collide with ads; empty editions still retain ads', () => {
  const block={type:'sports-overview',text:'All rows'};
  const pages=paginateEditorial([{id:'table',blocks:[block]}],[{id:'ad',format:'1/2'}],measure);
  assert.deepEqual(pages.find(p=>p.id==='table').blocks,[block]);
  assert.equal(pages.find(p=>p.id==='table').paged,false);
  assert.equal(pages.find(p=>p.id==='table').adSlots.length,0);
  assert.equal(paginateEditorial([],[{id:'ad',format:'1'}],measure).length,1);
});

test('short contributions share pages and remain individually addressable',()=>{
 const articles=Array.from({length:6},(_,i)=>({id:'a'+i,title:'Article '+i,blocks:[{type:'paragraph',text:'A short article. '.repeat(3)}]}));
 const pages=paginateEditorial(articles,[],measure);
 assert.equal(pages.length,1);
 assert.equal(pages[0].segments.length,6);
 assert.deepEqual(pages[0].articleIds,articles.map(a=>a.id));
 assert.equal(pages[0].blocks.map(b=>b.text).join(''),articles.flatMap(a=>a.blocks).map(b=>b.text).join(''));
});
test('reserved senior comparison pages remain complete and free of advertisements',()=>{
 const page={id:'senior',articleIds:['first','second'],fullPage:true,blocks:[{type:'senior-sports-grid',teams:[{text:'First table'},{text:'Second table'}]}]};
 const pages=paginateEditorial([page],[{id:'ad',format:'1/2'}],()=>700);
 const sports=pages.find(p=>p.id==='senior');
 assert.deepEqual(sports.blocks,page.blocks);assert.deepEqual(sports.articleIds,page.articleIds);assert.equal(sports.adSlots.length,0);
});
test('a photo opener stays directly before its team section when advertising pages are distributed',()=>{
 const input=[{id:'photo',teamPhotoPage:true,fullPage:true,keepWithNext:true,blocks:[{type:'team-photo-spread'}]},
 {id:'coaches',keepTogether:true,blocks:[{type:'coach-grid'}]},
 {id:'sports',fullPage:true,blocks:[{type:'senior-sports-grid'}]}];
 const pages=paginateEditorial(input,Array.from({length:5},(_,id)=>({id:'ad'+id,format:'1'})),()=>600);
 const index=pages.findIndex(page=>page.id==='photo');assert.equal(pages[index+1].id,'coaches');assert.equal(pages[index].adSlots.length,0);
 assert.equal(pages.filter(page=>page.advertising).length,5);
});
