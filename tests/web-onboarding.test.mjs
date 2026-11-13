import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { createAccount } from '../server/accounts.mjs';

async function listen(server) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('project owners can provision a managed website and obtain an immutable tracker', async () => {
  const websites = new Map();
  const collected = [];
  let creates = 0;
  const upstream = createServer(async (req,res)=>{
    const json = (status,value) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
    if (req.url === '/api/auth/login') return json(200,{token:'mock'});
    if (req.url === '/api/send' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      collected.push({body:JSON.parse(Buffer.concat(chunks)),headers:req.headers});
      return json(200,{});
    }
    if (req.headers.authorization !== 'Bearer mock') return json(401,{});
    if (req.url === '/api/websites' && req.method === 'POST') {
      const chunks=[];
      for await (const chunk of req) chunks.push(chunk);
      const site = JSON.parse(Buffer.concat(chunks));
      creates++;
      if (websites.has(site.id)) return json(400,{});
      websites.set(site.id,site);
      return json(200,site);
    }
    const id = req.url.split('/').at(-1);
    const site = websites.get(id);
    if (!site) return json(404,{});
    if (req.method === 'DELETE') {
      websites.delete(id);
      return json(200,{});
    }
    return json(200,site);
  });
  const upstreamUrl = await listen(upstream);
  const bytes = Buffer.from(`/* isolated test fixture ${randomUUID()} */`);
  const name = 'signal-3.5.0-'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.js';
  const file = 'public/vendor/'+name;
  await mkdir('public/vendor',{recursive:true});
  await writeFile(file,bytes,{flag:'wx'});
  const env = {UMAMI_BASE_URL:upstreamUrl,UMAMI_USERNAME:'test',UMAMI_PASSWORD:'test',
    CURVE_TRACKER_FILE:name,CURVE_WEB_GATE_SECRET:'a-test-only-gate-secret-long-enough'};
  const previous = Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  let service, server;
  try {
    service = await createApp({mode:'service',seed:false,publicOrigin:'https://curve.example'});
    server = createServer(service.app);
    const base = await listen(server);
    const call = (path,method='GET',cookie,body) => fetch(base+path,{
      method,headers:{...(cookie && {Cookie:cookie}),...(body && {'Content-Type':'application/json'})},
      body:body && JSON.stringify(body),
    });
    async function register(username) {
      const response = await call('/api/auth/register','POST',null,{username,password:'test-password-long'});
      assert.equal(response.status,200);
      return response.headers.get('set-cookie').split(';')[0];
    }
    const owner = await register('owner');
    const outsider = await register('outsider');
    const response = await call('/api/projects','POST',owner,{name:'Payment App',domain:'payments.example'});
    assert.equal(response.status,201);
    const {project} = await response.json();
    const route = '/api/projects/'+project.id;
    assert.equal((await call(route+'/web','POST',outsider)).status,404);
    // Simulate Umami accepting the create before Curve recorded the binding.
    websites.set(project.id,{id:project.id,domain:project.domain,name:`Curve ${project.id} — ${project.name}`});
    const [connected,repeated] = await Promise.all([call(route+'/web','POST',owner),call(route+'/web','POST',owner)]);
    for (const result of [connected,repeated]) {
      assert.equal(result.status,200);
      assert.equal((await result.json()).project.umamiWebsiteId,project.id);
    }
    assert.equal(creates,1);
    const integration = await (await call(route+'/integration','GET',owner)).json();
    assert.equal(integration.canProvision,false);
    assert.ok(integration.script.includes(`src="https://curve.example/vendor/${name}"`));
    assert.ok(integration.script.includes('data-domains="payments.example"'));
    assert.ok(integration.script.includes('data-before-send="curveBeforeSend"'));
    assert.ok(integration.script.includes('integrity="sha384-'+createHash('sha384').update(bytes).digest('base64')+'"'));
    const tracker = await fetch(base+'/vendor/'+name,{headers:{Origin:'https://payments.example'}});
    assert.equal(tracker.status,200);
    assert.equal(tracker.headers.get('access-control-allow-origin'),'*');
    assert.match(tracker.headers.get('cache-control'),/immutable/);
    assert.deepEqual(Buffer.from(await tracker.arrayBuffer()),bytes);
    const path = '/api/web-challenge?website='+project.id;
    const browser = {Origin:'https://payments.example','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty','Sec-Fetch-Site':'cross-site'};
    assert.equal((await fetch(base+path,{headers:{Origin:browser.Origin}})).status,403);
    assert.equal((await fetch(base+path,{headers:{...browser,Origin:'https://elsewhere.example'}})).status,403);
    assert.equal((await fetch(base+path,{headers:{...browser,DNT:'1'}})).status,403);
    const challenge = await fetch(base+path,{headers:browser});
    assert.equal(challenge.status,200);
    const {token} = await challenge.json();
    const event = {type:'event',payload:{
      website:project.id,hostname:'payments.example',url:'https://payments.example/payments/123?secret=pii',
      title:'private page title',referrer:'https://search.example/private?q=secret',curveChallenge:token,
    }};
    const send = payload => fetch(base+'/api/send',{method:'POST',headers:{
      ...browser,'Content-Type':'application/json','X-Forwarded-For':'198.51.100.123','Cookie':'sensitive=1',
    },body:JSON.stringify(payload)});
    assert.equal((await send(event)).status,200);
    assert.equal((await send(event)).status,403);
    assert.equal(collected.length,1);
    assert.equal(collected[0].body.payload.url,'/payments/:id');
    assert.equal(collected[0].body.payload.referrer,'https://search.example');
    assert.equal(collected[0].body.payload.ip,'127.0.0.0');
    assert.match(collected[0].body.payload.salt,/^[0-9a-f]{64}$/);
    assert.equal(collected[0].body.payload.title,undefined);
    assert.equal(collected[0].body.payload.curveChallenge,undefined);
    assert.equal(collected[0].headers['x-forwarded-for'],undefined);
    assert.equal(collected[0].headers.cookie,undefined);
    const evidence = await (await call(route+'/evidence','GET',owner)).json();
    assert.deepEqual(evidence.quality.webGate,{forwarded:1,suspectedBots:0,rateLimited:0,upstreamErrors:0});
    await writeFile(file,'changed');
    assert.equal((await call('/vendor/'+name)).status,404);
    assert.equal((await (await call(route+'/integration','GET',owner)).json()).script,null);
    await createAccount(service.db,'operator','test-password-long','operator');
    const session = await call('/api/auth/login','POST',null,{username:'operator',password:'test-password-long'});
    const operator = session.headers.get('set-cookie').split(';')[0];
    assert.equal((await call(route,'DELETE',owner)).status,403);
    assert.equal((await call(route,'DELETE',operator)).status,200);
    assert.equal(websites.has(project.id),false);
    assert.equal((await call(route+'/integration','GET',owner)).status,404);
  } finally {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (server) await new Promise(resolve=>server.close(resolve));
    await service?.close();
    await new Promise(resolve=>upstream.close(resolve));
    await unlink(file);
  }
});
