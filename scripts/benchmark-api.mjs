import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server/app.mjs';

assert.ok(process.env.CURVE_TEST_DATABASE_URL, 'Set CURVE_TEST_DATABASE_URL to a disposable PostgreSQL database.');
const projectCount = 50;
const pointsPerBatch = 12;
const batchesPerProject = 24;
const requestsPerPoint = 70;
const day = new Date();
day.setUTCHours(0,0,0,0);
day.setUTCDate(day.getUTCDate()-1);
const dayLabel = day.toISOString().slice(0,10);
const expected = projectCount * pointsPerBatch * batchesPerProject * requestsPerPoint;
const {app,db,close} = await createApp({databaseUrl:process.env.CURVE_TEST_DATABASE_URL,seed:false});
const server = app.listen(0,'127.0.0.1');
await once(server,'listening');
const endpoint = `http://127.0.0.1:${server.address().port}/api/otlp/v1/metrics`;
const projects = [];
const durations = [];

function exportBatch(hour) {
  const dataPoints = Array.from({length:pointsPerBatch}, (_,index) => {
    const time = BigInt(day.getTime() + (hour*60+index*5+1)*60_000)*1_000_000n;
    return {
      startTimeUnixNano:String(time-60_000_000_000n), timeUnixNano:String(time),
      count:String(requestsPerPoint), sum:9, explicitBounds:[0.1,0.25,0.5], bucketCounts:['35','30','5','0'],
      attributes:[
        {key:'http.route',value:{stringValue:`/payments/${index+1000}`}},
        {key:'http.response.status_code',value:{intValue:index===0 ? '503' : '200'}},
      ],
    };
  });
  return JSON.stringify({resourceMetrics:[{
    resource:{attributes:[{key:'service.name',value:{stringValue:'benchmark-payments'}}]},
    scopeMetrics:[{metrics:[{
      name:'http.server.request.duration', unit:'s',
      histogram:{aggregationTemporality:1,dataPoints},
    }]}],
  }]});
}

try {
  for (let i=0;i<projectCount;i++) {
    const id = randomUUID();
    const key = randomBytes(32).toString('hex');
    await db.query(`
      INSERT INTO projects(id,name,domain,network,owner_id,key_hash)
      VALUES($1,'Load check','load.example','testnet','load-check',$2)
    `, [id,createHash('sha256').update(key).digest('hex')]);
    projects.push({id,key});
  }
  const batches = Array.from({length:batchesPerProject}, (_,hour)=>exportBatch(hour));
  const started = performance.now();
  let cursor = 0;
  const workers = Array.from({length:8}, async () => {
    while (cursor < projects.length) {
      const {key} = projects[cursor++];
      for (const body of batches) {
        const start = performance.now();
        const result = await fetch(endpoint,{
          method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
          body,signal:AbortSignal.timeout(10_000),
        });
        assert.ok(result.ok,`Ingest failed with HTTP ${result.status}`);
        assert.equal((await result.json()).accepted,pointsPerBatch);
        durations.push(performance.now()-start);
      }
    }
  });
  const outcomes = await Promise.allSettled(workers);
  for (const outcome of outcomes) if (outcome.status==='rejected') throw outcome.reason;
  const elapsed = (performance.now()-started)/1000;
  const ids = projects.map(project=>project.id);
  const {rows:[totals]} = await db.query(`
    SELECT sum(requests) AS requests,count(*) AS rollups,
      sum(requests) FILTER (WHERE status=503) AS failed
    FROM api_daily WHERE project_id=ANY($1::text[]) AND day=$2::date
  `, [ids,dayLabel]);
  assert.equal(Number(totals.requests),expected);
  assert.equal(Number(totals.failed),projectCount*batchesPerProject*requestsPerPoint);
  assert.equal(Number(totals.rollups),projectCount*2);
  durations.sort((a,b)=>a-b);
  console.log(JSON.stringify({
    projects:projectCount,httpBatches:durations.length,deltaPoints:durations.length*pointsPerBatch,
    representedRequests:expected,dailyRows:Number(totals.rollups),elapsedSeconds:Number(elapsed.toFixed(2)),
    httpBatchP95Ms:Number(durations[Math.ceil(durations.length*.95)-1].toFixed(2)),
  }));
} finally {
  const ids = projects.map(project=>project.id);
  await new Promise(resolve=>server.close(resolve));
  try {
    await db.transaction(async tx=>{
      await tx.query('DELETE FROM records WHERE project_id=ANY($1::text[])',[ids]);
      await tx.query('DELETE FROM quality WHERE project_id=ANY($1::text[])',[ids]);
      await tx.query('DELETE FROM projects WHERE id=ANY($1::text[])',[ids]);
    });
  } finally { await close(); }
}
