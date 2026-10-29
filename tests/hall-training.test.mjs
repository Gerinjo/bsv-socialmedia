import test from 'node:test';
import assert from 'node:assert/strict';
import {hallTime,hallMinutes,validateHallDay,HALL_TRAINING_DATES} from '../src/hall-training.mjs';
import {handleHallTraining} from '../supabase/functions/_shared/hall-training.mjs';
test('hall dates span the requested winter and time parsing rejects invalid or incomplete blocks',()=>{
 assert.equal(HALL_TRAINING_DATES.length,9);assert.equal(HALL_TRAINING_DATES[0],'2026-11-07');assert.equal(HALL_TRAINING_DATES.at(-1),'2027-01-31');
 assert.equal(hallTime(480),'08:00');assert.equal(hallMinutes('20:00'),1200);
 const body={date:'2026-11-07',start:'08:00',end:'20:00',blockMinutes:60};
 assert.deepEqual(validateHallDay(body),{date:body.date,dayId:null,version:0,startMinute:480,endMinute:1200,blockMinutes:60});
 for(const change of [{date:'2026-02-30'},{start:'24:00'},{start:'8:00'},{end:'07:00'},{blockMinutes:50},{blockMinutes:0},{blockMinutes:15.5}])assert.throws(()=>validateHallDay({...body,...change}));
});
test('server forwards the verified actor separately and respects database conflict/permission status',async()=>{
 const db={rpc:async(name,args)=>{assert.equal(name,'hall_training_request');assert.equal(args.actor,'verified');assert.equal(args.payload.action,'book');return {data:{error:'Bereits gebucht',status:409}};}};
 await assert.rejects(()=>handleHallTraining(db,'verified',{action:'hall_book',actor:'forged'}),error=>error.status===409);
 await assert.rejects(()=>handleHallTraining(db,'verified',{action:'hall_unknown'}),/Unbekannte/);
});
