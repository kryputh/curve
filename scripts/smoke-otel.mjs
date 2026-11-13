import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.mjs';

assert.ok(process.env.CURVE_OTELCOL, 'Set CURVE_OTELCOL to the Collector Contrib executable.');
async function listen(server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function reservePort() {
  const server = createServer();
  const address = await listen(server);
  await new Promise(resolve=>server.close(resolve));
  return new URL(address).port;
}
const existingExports = [];
const sink = createServer(async (req,res)=>{
  if (req.url !== '/v1/metrics') return res.writeHead(404).end();
  const parts=[];
  for await (const chunk of req) parts.push(chunk);
  existingExports.push(JSON.parse(Buffer.concat(parts)));
  res.writeHead(200,{'Content-Type':'application/json'}).end('{}');
});
const existingUrl = await listen(sink);
const {app,close}=await createApp({seed:false});
const server = createServer(app);
const curveUrl = await listen(server);
const temp = await mkdtemp(join(tmpdir(),'curve-otel-smoke-'));
const configPath = join(temp,'collector.yaml');
let collector;
try {
  const json = {'Content-Type':'application/json'};
  const login = await fetch(curveUrl+'/api/auth/demo',{method:'POST',headers:json,body:JSON.stringify({role:'operator'})});
  assert.equal(login.status,200);
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const property = await fetch(curveUrl+'/api/projects',{
    method:'POST',headers:{...json,Cookie},body:JSON.stringify({name:'Collector smoke',domain:'smoke.example'}),
  });
  assert.equal(property.status,201);
  const {project,apiKey} = await property.json();
  const [grpcPort,httpPort] = await Promise.all([reservePort(),reservePort()]);
  const config = (await readFile(new URL('../examples/otel-collector.yaml',import.meta.url),'utf8'))
    .replace('127.0.0.1:4317','127.0.0.1:'+grpcPort)
    .replace('127.0.0.1:4318','127.0.0.1:'+httpPort)
    .replace('  otlphttp/existing:\n','  otlphttp/existing:\n    encoding: json\n    compression: none\n');
  await writeFile(configPath,config);
  collector=spawn(process.env.CURVE_OTELCOL,['--config',configPath],{
    stdio:'inherit',windowsHide:true,env:{...process.env,EXISTING_APM_ENDPOINT:existingUrl,
      EXISTING_APM_AUTHORIZATION:'Bearer fixture',CURVE_OTLP_BASE_URL:curveUrl+'/api/otlp',CURVE_PROJECT_KEY:apiKey},
  });
  let spawnError;
  collector.once('error',error=>{spawnError=error;});
  const endpoint = `http://127.0.0.1:${httpPort}/v1/metrics`;
  const start = BigInt(Date.now()-60_000)*1_000_000n;
  function point(count,time) {
    return {resourceMetrics:[{resource:{attributes:[
      {key:'service.name',value:{stringValue:'payments'}},
      {key:'service.instance.id',value:{stringValue:'fixture'}},
    ]},scopeMetrics:[{metrics:[{
      name:'http.server.request.duration',unit:'s',
      histogram:{aggregationTemporality:2,dataPoints:[{
        startTimeUnixNano:String(start),timeUnixNano:String(time),count:String(count),
        sum:count*0.1,explicitBounds:[0.25],bucketCounts:[String(count),'0'],
        attributes:[{key:'http.route',value:{stringValue:'/payments/243'}},
          {key:'http.response.status_code',value:{intValue:'200'}}],
      }]},
    }]}]}]};
  }
  async function send(body) {
    const result = await fetch(endpoint,{method:'POST',headers:json,body:JSON.stringify(body),signal:AbortSignal.timeout(1000)});
    assert.equal(result.status,200);
  }
  const t = BigInt(Date.now()-1000)*1_000_000n;
  let ready = false;
  for(let i=0;i<80;i++){
    if(spawnError) throw spawnError;
    if(collector.exitCode!==null) throw new Error('Collector stopped before accepting metrics.');
    try {await send(point(10,t));ready=true;break;} catch {}
    await delay(250);
  }
  assert.ok(ready,'Collector did not start');
  await send(point(17,t+1_000_000n));
  for(let i=0;i<40;i++){
    const overview = await (await fetch(curveUrl+`/api/projects/${project.id}/overview`,{headers:{Cookie}})).json();
    const original = existingExports.flatMap(exp=>exp.resourceMetrics)
      .flatMap(resource=>resource.scopeMetrics).flatMap(scope=>scope.metrics).map(metric=>metric.histogram);
    if(overview.metrics.apiRequests===7 && original.flatMap(h=>h.dataPoints).length>=2){
      assert.ok(original.every(h=>Number(h.aggregationTemporality)===2));
      assert.deepEqual(original.flatMap(h=>h.dataPoints).map(p=>Number(p.count)),[10,17]);
      assert.equal(overview.endpoints[0].path,'/payments/:id');
      console.log('PASS: Collector dual export preserved cumulative data for the existing APM and sent seven delta requests to Curve.');
      ready = 'verified';
      break;
    }
    await delay(500);
  }
  assert.equal(ready,'verified','Could not reconcile both Collector outputs.');
} finally {
  if(collector?.pid && collector.exitCode===null && collector.signalCode===null){
    const exited=once(collector,'close');
    collector.kill();
    await Promise.race([exited,delay(2500)]);
  }
  await Promise.all([sink,server].map(item=>new Promise(resolve=>item.close(resolve))));
  await close();
  await unlink(configPath).catch(()=>{});
  await rmdir(temp);
}
