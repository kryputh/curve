import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {createApp} from '../server/app.mjs';

const source=new URL(process.env.CURVE_RESTORE_SOURCE_URL);
const target=new URL(process.env.CURVE_RESTORE_TARGET_URL);
for(const url of [source,target]) {
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Only local disposable databases accepted');
 assert.match(url.pathname,/^\/curve_restore_[a-f0-9]+_(source|target)$/);
 const client=new pg.Client({connectionString:url.href});await client.connect();
 try{assert.equal((await client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,'0','Database must be empty');}finally{await client.end();}
}
assert.equal(source.hostname,target.hostname);assert.notEqual(source.pathname,target.pathname);
const file=join(await mkdtemp(join(tmpdir(),'curve-restore-')),'backup.dump');
async function command(executable,args,url) {
 assert.ok(executable,'PG_DUMP_PATH and PG_RESTORE_PATH required');
 await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:'ignore',env:{...process.env,PGHOST:url.hostname.replace(/[\[\]]/g,''),PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)}});
  child.on('error',()=>reject(new Error('PostgreSQL executable unavailable')));child.on('exit',code=>code===0?resolve():reject(new Error('PostgreSQL backup/restore command failed')));
 });
}
async function start(url){const service=await createApp({mode:'service',seed:false,databaseUrl:url.href});const server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return {...service,base:`http://127.0.0.1:${server.address().port}`,stop:async()=>{await new Promise(r=>server.close(r));await service.close();}};}
let app=await start(source);
const post=(path,body,cookie)=>fetch(app.base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
let cookie,otherCookie,project;
try {
 const user=await post('/api/auth/register',{username:'restore-owner',password:'Restore-only-long-password'});assert.equal(user.status,200);cookie=user.headers.get('set-cookie').split(';')[0];
 const other=await post('/api/auth/register',{username:'restore-other',password:'Restore-only-long-password'});assert.equal(other.status,200);otherCookie=other.headers.get('set-cookie').split(';')[0];
 const created=await post('/api/projects',{name:'Restore verification',domain:'restore.example'},cookie);assert.equal(created.status,201);const body=await created.json();project=body.project;
 const metric={resourceMetrics:[{scopeMetrics:[{metrics:[{name:'http.server.request.duration',unit:'s',histogram:{aggregationTemporality:1,dataPoints:[{timeUnixNano:String(BigInt(Date.now())*1000000n),count:'5',sum:0.5,explicitBounds:[0.25],bucketCounts:['5','0'],attributes:[{key:'http.route',value:{stringValue:'/restore'}},{key:'http.response.status_code',value:{intValue:'200'}}]}]}}]}]}]};
 assert.equal((await fetch(app.base+'/api/otlp/v1/metrics',{method:'POST',headers:{Authorization:'Bearer '+body.apiKey,'Content-Type':'application/json'},body:JSON.stringify(metric)})).status,200);
}finally{await app.stop();}
await command(process.env.PG_DUMP_PATH,['--format=custom','--no-owner','--no-acl','--file',file],source);
await command(process.env.PG_RESTORE_PATH,['--exit-on-error','--no-owner','--no-acl','--dbname',target.pathname.slice(1),file],target);
app=await start(target);
try {
 const path=app.base+`/api/projects/${project.id}/overview`;
 const response=await fetch(path,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.equal((await response.json()).metrics.apiRequests,5);
 assert.equal((await fetch(path,{headers:{Cookie:otherCookie}})).status,404);
 console.log('PASS: PostgreSQL custom-format restore preserves session, API totals and tenant isolation.');
}finally{await app.stop();}
