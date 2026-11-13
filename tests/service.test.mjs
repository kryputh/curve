import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createAccount } from '../server/accounts.mjs';
import { captureWebDay } from '../server/web-rollups.mjs';

test('service accounts have durable sessions and cannot select an operator role', async () => {
  const service = await createApp({mode:'service',seed:false,enrollmentMode:'approval',databaseUrl:process.env.CURVE_TEST_DATABASE_URL});
  const server = service.app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie) => fetch(base+path,{method:'POST',
    headers:{'Content-Type':'application/json',...(cookie && {Cookie:cookie})},body:JSON.stringify(body)});
  const username = 'tenant-'+randomUUID().slice(0,8);
  const operator = 'operator-'+randomUUID().slice(0,8);
  const password = 'Test-only-long-password';
  try {
    assert.equal((await post('/api/auth/demo',{role:'operator'})).status,404);
    const registered = await post('/api/auth/register',{username,password,role:'operator'});
    assert.equal(registered.status,200);
    assert.equal((await registered.json()).user.role,'tenant');
    const cookie = registered.headers.get('set-cookie').split(';')[0];
    assert.match(registered.headers.get('set-cookie'),/HttpOnly/);
    const created = await post('/api/projects',{name:'Owned project',domain:'test.example'},cookie);
    assert.equal(created.status,201);
    const {project,apiKey} = await created.json();
    assert.equal(project.enrollment,'pending');
    assert.equal((await post(`/api/projects/${project.id}/web`,{},cookie)).status,403);
    assert.equal((await post(`/api/projects/${project.id}/approve`,{},cookie)).status,403);
    const metric = {resourceMetrics:[{scopeMetrics:[{metrics:[{
      name:'http.server.request.duration', unit:'s',
      histogram:{aggregationTemporality:1,dataPoints:[{
        timeUnixNano:String(BigInt(Date.now())*1_000_000n),
        count:'5', sum:0.5, explicitBounds:[0.25], bucketCounts:['5','0'],
        attributes:[
          {key:'http.route',value:{stringValue:'/payments/123'}},
          {key:'http.response.status_code',value:{intValue:'200'}},
        ],
      }]},
    }]}]}]};
    const ingest = () => fetch(base+'/api/otlp/v1/metrics', {
      method:'POST', headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
      body:JSON.stringify(metric),
    });
    assert.equal((await ingest()).status,403);
    await createAccount(service.db,operator,password,'operator');
    const loggedIn = await post('/api/auth/login',{username:operator,password});
    assert.equal((await loggedIn.json()).user.role,'operator');
    const operatorCookie = loggedIn.headers.get('set-cookie').split(';')[0];
    const approved = await post(`/api/projects/${project.id}/approve`,{},operatorCookie);
    assert.equal(approved.status,200);
    assert.equal((await approved.json()).project.enrollment,'approved');
    const first = await ingest();
    assert.equal(first.status,200);
    assert.equal((await first.json()).accepted,1);
    assert.equal((await (await ingest()).json()).duplicate,1);
    const overview = await (await fetch(base+`/api/projects/${project.id}/overview`,{headers:{Cookie:cookie}})).json();
    assert.equal(overview.metrics.apiRequests,5);
    assert.equal(overview.endpoints[0].path,'/payments/:id');
    assert.equal((await post('/api/operator/read-keys',{},cookie)).status,403);
    const other = await post('/api/auth/register',{username:'other-'+username,password});
    const otherCookie = other.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+`/api/projects/${project.id}/overview`,{headers:{Cookie:otherCookie}})).status,404);
    assert.equal((await fetch(base+`/api/projects/${project.id}/web-history`,{headers:{Cookie:otherCookie}})).status,404);
    const historyStart = new Date(Date.now()-2*86400000); historyStart.setUTCHours(0,0,0,0);
    await service.db.query("UPDATE projects SET created_at=$2,umami_website_id='isolated-test-site' WHERE id=$1",[project.id,historyStart.toISOString()]);
    await captureWebDay(service.db,{id:project.id,umami_website_id:'isolated-test-site'},historyStart.toISOString().slice(0,10),{
      fetchDay:async()=>({status:'connected',data:{pageviews:12,visitors:4,visits:5,bounces:2,totalDuration:60}}),
    });
    const history = await (await fetch(base+`/api/projects/${project.id}/web-history`,{headers:{Cookie:cookie}})).json();
    assert.equal(history.pageviews,12);
    assert.equal(history.visitorDays,4);
    assert.equal(history.uniqueVisitors,null);
    assert.equal(history.missingDays.length,1);
    assert.equal(history.series.length,1);
    assert.equal(history.bounceRate,40);
    const issued = await post('/api/operator/read-keys',{},operatorCookie);
    assert.equal(issued.status,201);
    const readKey = await issued.json();
    assert.equal((await fetch(base+'/api/operator/read-keys',{headers:{Cookie:cookie}})).status,403);
    const keys = await (await fetch(base+'/api/operator/read-keys',{headers:{Cookie:operatorCookie}})).json();
    assert.equal(keys.keys.find(item=>item.id===readKey.id).revoked,false);
    assert.ok(!JSON.stringify(keys).includes(readKey.apiKey));
    assert.equal((await post('/api/auth/logout',{},cookie)).status,200);
    assert.equal((await fetch(base+'/api/projects',{headers:{Cookie:cookie}})).status,401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await service.close();
  }
});
