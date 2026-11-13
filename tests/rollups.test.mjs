import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { storeMetrics } from '../server/ingestion.mjs';
import { expireMetrics, initializeRollups, readDailyApi } from '../server/rollups.mjs';
import { percentile, statusDistribution } from '../server/core.mjs';

function point(id, timestamp, status, bounds, counts) {
  const count = counts.reduce((sum,n) => sum+n, 0);
  return {id,timestamp,status,count,path:'/payments/:id',type:'api',source:'server',
    service:'payments',metric:'http.server.request.duration',errors:status>=400 ? count : 0,
    buckets:bounds.map((bound,index) => ({bound,count:counts[index]}))};
}

test('daily aggregate merges accepted points once and survives expiry of raw records', async () => {
  const service = await createApp({seed:false,databaseUrl:process.env.CURVE_TEST_DATABASE_URL});
  try {
    const {db} = service;
    const project = {id:'rollups',key_hash:'fixture-key'};
    await db.query(
      "INSERT INTO projects(id,name,domain,network,owner_id,key_hash) VALUES ($1,'Rollups','rollup.example','testnet','demo-tenant',$2)",
      [project.id,project.key_hash],
    );
    const one = point('first','2026-01-01T01:00:00Z',200,[100,250,null],[1,3,0]);
    const two = point('second','2026-01-01T06:00:00Z',200,[100,250,null],[2,0,0]);
    const three = point('third','2026-01-01T10:00:00Z',503,[25,250,null],[0,3,1]);
    const late = point('late','2026-01-02T09:00:00Z',503,[25,250,null],[1,1,0]);
    assert.deepEqual(await storeMetrics(db,project,{records:[one,two,three,three],rejected:0}),
      {accepted:3,duplicate:1});
    assert.deepEqual(await storeMetrics(db,project,{records:[one,late],rejected:0}),
      {accepted:1,duplicate:1});

    const firstDay = await readDailyApi(db,project.id,'2026-01-01','2026-01-01');
    assert.equal(firstDay.length,2);
    assert.deepEqual(statusDistribution(firstDay),[{status:200,count:6},{status:503,count:4}]);
    assert.equal(percentile(firstDay,0.5),250);
    assert.equal(percentile(firstDay,0.95),null);
    assert.deepEqual(firstDay.find(row=>row.status===200).buckets,
      [{bound:100,count:3},{bound:250,count:3},{bound:null,count:0}]);

    assert.deepEqual(await expireMetrics(db,new Date('2026-01-15T12:00:00Z')),{raw:4,daily:0});
    assert.deepEqual(await readDailyApi(db,project.id,'2026-01-01','2026-01-01'),firstDay);
    assert.deepEqual(await expireMetrics(db,new Date('2028-01-02T12:00:00Z')),{raw:0,daily:2});
    const remaining = await readDailyApi(db,project.id,'2026-01-01','2026-01-03');
    assert.deepEqual(remaining.map(row=>[row.day,row.count]),[['2026-01-02',2]]);
  } finally {
    await service.close();
  }
});

test('one-time backfill preserves retained API points and excludes fixtures', async () => {
  const service = await createApp({seed:false});
  try {
    const {db} = service;
    const timestamp = new Date().toISOString();
    const day = timestamp.slice(0,10);
    for (const [id,demo] of [['legacy',false],['fixture',true]]) {
      await db.query("INSERT INTO projects(id,name,domain,network,owner_id,is_demo) VALUES($1,$1,'test.example','testnet','demo-tenant',$2)",[id,demo]);
      await db.query('INSERT INTO records(id,project_id,ts,data) VALUES ($1,$2,$3,$4)',
        [id,id,timestamp,JSON.stringify(point(id,timestamp,200,[250,null],[2,0]))]);
    }
    await db.query("DELETE FROM data_migrations WHERE name='api_daily_v1'");
    await initializeRollups(db);
    await initializeRollups(db);
    assert.deepEqual((await readDailyApi(db,'legacy',day,day)).map(row=>row.count),[2]);
    assert.deepEqual(await readDailyApi(db,'fixture',day,day),[]);
  } finally {
    await service.close();
  }
});
