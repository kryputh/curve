import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializeWebRollups,captureWebDay,readDailyWeb} from '../server/web-rollups.mjs';
import {runWebMaintenance,startWebMaintenance} from '../server/web-maintenance.mjs';

test('maintenance bounds backlog and retries yesterday after catch-up',async()=>{
 const db=new PGlite();
 try {
  await db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,umami_website_id TEXT,is_demo BOOLEAN,created_at TIMESTAMPTZ); INSERT INTO projects VALUES('p','w',false,'2026-01-01');");
  await initializeWebRollups(db);
  const days=[];
  const fetchDay=async(_id,start)=>{days.push(start.slice(0,10));return {status:'connected',data:{pageviews:1,visitors:1,visits:1,bounces:0,totalDuration:2}};};
  const options={now:Date.parse('2026-01-04'),maxDays:2,fetchDay};
  assert.equal((await runWebMaintenance(db,options)).remaining,1);
  assert.deepEqual(days,['2026-01-03','2026-01-02']);
  await runWebMaintenance(db,options);
  await runWebMaintenance(db,options);
  assert.deepEqual(days,['2026-01-03','2026-01-02','2026-01-01','2026-01-03','2026-01-03']);
  const report=await readDailyWeb(db,'p','2026-01-01','2026-01-03');
  assert.equal(report.visits,3); assert.equal(report.avgDuration,2);
 }finally{await db.close();}
});

test('failing tenant cannot consume another tenant budget and stop drains fetch',async()=>{
 const db=new PGlite();
 try {
  await db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,umami_website_id TEXT,is_demo BOOLEAN,created_at TIMESTAMPTZ); INSERT INTO projects VALUES('a','bad',false,'2026-01-01'),('b','good',false,'2026-01-01');");
  await initializeWebRollups(db);
  const data={pageviews:1,visitors:1,visits:1,bounces:0,totalDuration:2};
  const options={now:Date.parse('2026-01-05'),maxDays:2};
  const calls=[];
  const result=await runWebMaintenance(db,{...options,fetchDay:async id=>{calls.push(id);return id==='bad'?{status:'unavailable'}:{status:'connected',data};}});
  assert.deepEqual(new Set(calls),new Set(['bad','good']));assert.equal(result.captured,1);assert.equal(result.failed,1);
  let release,entered;
  const waiting=new Promise(r=>entered=r);
  const gate=new Promise(r=>release=r);
  const stop=startWebMaintenance(db,{...options,maxDays:1,fetchDay:async()=>{entered();await gate;return {status:'connected',data};}});
  await waiting;
  let stopped=false;
  const stopping=stop().then(()=>{stopped=true;});
  await new Promise(r=>setImmediate(r));assert.equal(stopped,false);
  release();await stopping;assert.equal(stopped,true);
 }finally{await db.close();}
});

test('daily snapshots replace retries, preserve outages, and disclose non-additive visitors and gaps',async()=>{
  const db=new PGlite();
  try {
    await db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES('p');");
    await initializeWebRollups(db);
    const project={id:'p',umami_website_id:'w'};
    let count=5;
    const fetchDay=async(id,start,end)=>{assert.equal(id,'w');assert.equal(start,'2026-01-01T00:00:00.000Z');assert.equal(end,'2026-01-01T23:59:59.999Z');return {status:'connected',data:{pageviews:count,visitors:2,visits:3,bounces:1,totalDuration:12}};};
    await captureWebDay(db,project,'2026-01-01',{fetchDay});
    count=7;
    await captureWebDay(db,project,'2026-01-01',{fetchDay});
    await captureWebDay(db,project,'2026-01-01',{fetchDay:async()=>({status:'unavailable',data:null})});
    const result=await readDailyWeb(db,'p','2026-01-01','2026-01-02');
    assert.equal(result.pageviews,7);
    assert.equal(result.visitorDays,2);
    assert.equal(result.uniqueVisitors,null);
    assert.deepEqual(result.missingDays,['2026-01-02']);
    assert.equal(result.status,'incomplete');
    await assert.rejects(captureWebDay(db,project,'2026-01-01',{fetchDay,now:Date.parse('2026-01-01T12:00:00Z')}));
  } finally {await db.close();}
});

