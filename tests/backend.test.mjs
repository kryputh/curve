import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {normalizePath,digest,parseOtlp} from '../server/core.mjs';
let service,server,base,tenant,operator,project,key;
async function request(path,{cookie,body,method='GET',token,...rest}={}){
 return fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),...rest});
}
const payload=(id,t=Date.now())=>({resourceMetrics:[{resource:{attributes:[{key:'tenant.id',value:{stringValue:id}},{key:'service.name',value:{stringValue:'payments'}}]},scopeMetrics:[{metrics:[{name:'http.server.request.duration',unit:'s',histogram:{aggregationTemporality:1,dataPoints:[{startTimeUnixNano:String(BigInt(t-1000)*1000000n),timeUnixNano:String(BigInt(t)*1000000n),count:'10',sum:1,explicitBounds:[.1,.5],bucketCounts:['5','4','1'],attributes:[{key:'http.route',value:{stringValue:'/accounts/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF?secret=do-not-store'}},{key:'http.response.status_code',value:{intValue:'200'}},{key:'user.email',value:{stringValue:'never-store@example.com'}}]}]}}]}]}]});
before(async()=>{service=await createApp();server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(r=>server.close(r));await service.close();});
test('requires authentication and isolates tenant fixtures',async()=>{
 assert.equal((await request('/api/projects')).status,401);
 const t=await request('/api/auth/demo',{method:'POST',body:{role:'tenant'}});tenant=t.headers.get('set-cookie').split(';')[0];
 const o=await request('/api/auth/demo',{method:'POST',body:{role:'operator'}});operator=o.headers.get('set-cookie').split(';')[0];
 const list=await(await request('/api/projects',{cookie:tenant})).json();assert.equal(list.projects.length,1);assert.equal(list.projects[0].id,'demo-project');
 assert.equal((await request('/api/projects/demo-orbit/overview',{cookie:tenant})).status,404);
 assert.equal((await request('/api/projects/demo-orbit/evidence',{cookie:tenant})).status,404);
 assert.equal((await request('/api/projects/demo-orbit/export',{cookie:tenant})).status,404);
 assert.equal((await(await request('/api/projects',{cookie:operator})).json()).projects.length,2);
});
test('enrolls an empty real project and shows key only once',async()=>{
 assert.equal((await request('/api/projects',{method:'POST',cookie:tenant,body:{name:'Steal',domain:'example.test',umamiWebsiteId:'12345678-1234-1234-1234-123456789abc'}})).status,403);
 const response=await request('/api/projects',{method:'POST',cookie:tenant,body:{name:'Test project',domain:'example.test',network:'testnet'}});assert.equal(response.status,201);
 const body=await response.json();project=body.project;key=body.apiKey;assert.match(key,/^cv_/);
 const data=await(await request(`/api/projects/${project.id}/overview`,{cookie:tenant})).json();assert.equal(data.metrics.pageviews,0);assert.equal(data.metrics.apiRequests,0);assert.equal(data.sourceStatus.web,'not-configured');
 const list=await(await request('/api/projects',{cookie:tenant})).json();assert.equal(JSON.stringify(list).includes(key),false);assert.equal(JSON.stringify(list).includes('key_hash'),false);
});
test('ingests authenticated delta OTLP, rejects cross-tenant spoofing, redacts and deduplicates',async()=>{
 const body=payload(project.id);
 assert.equal((await request('/api/otlp/v1/metrics',{method:'POST',body})).status,401);
 assert.equal((await request('/api/otlp/v1/metrics',{method:'POST',body:payload('other-tenant'),token:key})).status,400);
 const first=await request('/api/otlp/v1/metrics',{method:'POST',body,token:key});assert.equal(first.status,200);assert.equal((await first.json()).accepted,1);
 const second=await(await request('/api/otlp/v1/metrics',{method:'POST',body,token:key})).json();assert.equal(second.duplicate,1);
 const o=await(await request(`/api/projects/${project.id}/overview`,{cookie:tenant})).json();assert.equal(o.metrics.apiRequests,10);assert.equal(o.endpoints[0].path,'/accounts/:address');assert.equal(o.metrics.p95Latency,null);
 const stored=JSON.stringify((await service.db.query('SELECT data FROM records WHERE project_id=$1',[project.id])).rows);assert.equal(stored.includes('never-store'),false);assert.equal(stored.includes('do-not-store'),false);
});
test('evidence digest is reproducible; a changed metric breaks verification',async()=>{
 const report=await(await request(`/api/projects/${project.id}/evidence`,{cookie:tenant})).json();const {digest:actual,...body}=report;assert.equal(digest(body),actual);body.metrics.apiRequests++;assert.notEqual(digest(body),actual);
 const csv=await(await request(`/api/projects/${project.id}/export`,{cookie:tenant})).text();assert.match(csv,/date,pageviews,api_requests/);assert.equal(csv.includes('never-store'),false);
});
test('status distributions count requests by status in both dashboard and evidence',async()=>{
 const body=payload(project.id);
 const point=body.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0];
 point.attributes.find(attribute=>attribute.key==='http.response.status_code').value.intValue='503';
 assert.equal((await request('/api/otlp/v1/metrics',{method:'POST',body,token:key})).status,200);
 const expected=[{status:200,count:10},{status:503,count:10}];
 const overview=await(await request(`/api/projects/${project.id}/overview`,{cookie:tenant})).json();
 assert.deepEqual(overview.statusCodes,expected);
 assert.deepEqual(overview.endpoints[0].statusCodes,expected);
 assert.equal(overview.metrics.errorRate,50);
 const evidence=await(await request(`/api/projects/${project.id}/evidence`,{cookie:tenant})).json();
 assert.deepEqual(evidence.statusCodes,expected);
});
test('rejects cumulative data and drops trace/log content',async()=>{
 const data=payload(project.id);data.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.aggregationTemporality=2;
 assert.equal((await request('/api/otlp/v1/metrics',{method:'POST',body:data,token:key})).status,400);
 assert.equal((await(await request('/api/otlp/v1/traces',{method:'POST',body:{secret:'never-retain'},token:key})).json()).discarded,true);
 assert.equal((await request('/api/collect',{method:'POST',body:{type:'pageview'}})).status,400);
});
test('operator read keys are revocable and tenant cannot issue global keys',async()=>{
 assert.equal((await request('/api/operator/read-keys',{method:'POST',body:{},cookie:tenant})).status,403);
 const created=await(await request('/api/operator/read-keys',{method:'POST',body:{},cookie:operator})).json();assert.equal((await request('/api/metrics',{token:created.apiKey})).status,200);
 await request(`/api/operator/read-keys/${created.id}`,{method:'DELETE',cookie:operator});assert.equal((await request('/api/metrics',{token:created.apiKey})).status,401);
 await request(`/api/projects/${project.id}/keys`,{method:'DELETE',cookie:tenant});assert.equal((await request('/api/otlp/v1/metrics',{method:'POST',token:key,body:payload(project.id)})).status,401);
});
test('normalizes sensitive route patterns and validates histogram counts',()=>{
 assert.equal(normalizePath('/users/123/'),' /users/:id'.trim());assert.equal(normalizePath('/tx/0x1234567890abcdef1234567890abcdef?email=a@b'),' /tx/:hash'.trim());assert.equal(normalizePath('/users/person%40example.com'),'/users/:redacted');assert.equal(normalizePath('/items/aa12bb34-1234-1234-1234-123456789abc'),'/items/:id');
 const data=payload('a');data.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0].count='11';assert.throws(()=>parseOtlp(data,'a'),/histogram/);
 const mixed=payload('a');const point=mixed.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0];mixed.resourceMetrics[0].scopeMetrics[0].metrics.push({name:'http.server.request.count',sum:{aggregationTemporality:1,dataPoints:[{...point,asInt:'10'}]}});assert.throws(()=>parseOtlp(mixed,'a'),/exactly one/);
});
test('rejects hostile origins and oversized requests',async()=>{
 assert.equal((await request('/api/auth/demo',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:{role:'operator'}})).status,403);
 assert.equal((await request('/api/auth/demo',{method:'POST',body:{role:'operator',extra:'x'.repeat(600000)}})).status,413);
});
