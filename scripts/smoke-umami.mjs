import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.mjs';
import { createAccount } from '../server/accounts.mjs';

// Run against a dedicated local Umami test instance. The website is temporary.
const base = new URL(process.env.UMAMI_BASE_URL || 'http://127.0.0.1:3100');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.ok(!base.username && !base.password);
assert.ok(process.env.UMAMI_USERNAME && process.env.UMAMI_PASSWORD,
  'Set the credentials of a local Umami account that can create and delete test websites.');
assert.ok(process.env.CURVE_CHROMIUM, 'Set CURVE_CHROMIUM to a Chrome or Chromium executable.');
process.env.UMAMI_BASE_URL = base.origin;

async function request(origin, path, { method = 'GET', body, token, cookie } = {}) {
  const response = await fetch(new URL(path, origin), {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: {
      ...(body && {'Content-Type': 'application/json'}),
      ...(token && {Authorization: `Bearer ${token}`}),
      ...(cookie && {Cookie: cookie}),
    },
    body: body && JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path} returned HTTP ${response.status}`);
  return response;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

const login = await (await request(base, '/api/auth/login', {
  method: 'POST', body: {username: process.env.UMAMI_USERNAME, password: process.env.UMAMI_PASSWORD},
})).json();
assert.ok(login.token && !login.user?.passwordChangeRequired, 'Use an initialized local Umami account.');
const token = login.token;
const tracker = await request(base, '/script.js');
assert.match(tracker.headers.get('content-type') ?? '', /javascript/i);
const trackerBytes = Buffer.from(await tracker.arrayBuffer());
assert.ok(trackerBytes.length > 0 && trackerBytes.length <= 1024 * 1024);
const trackerName = 'signal-3.5.0-'+createHash('sha256').update(trackerBytes).digest('hex').slice(0,16)+'.js';
const trackerPath = join('public','vendor',trackerName);
const path = '/curve-umami-smoke';
const password = 'curve-smoke-'+randomUUID();
let curve, api, fixture, browser, profile, project, apiUrl, operatorCookie, script, trackerCreated, siteLinked;
try {
  await mkdir(join('public','vendor'),{recursive:true});
  try {
    await writeFile(trackerPath,trackerBytes,{flag:'wx'});
    trackerCreated = true;
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  process.env.CURVE_TRACKER_FILE = trackerName;
  process.env.CURVE_WEB_GATE_SECRET = randomUUID()+randomUUID();
  fixture = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname !== path) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(`<!doctype html><title>Curve smoke</title>${script}`);
  });
  const fixtureUrl = await listen(fixture);
  const tenantUrl = fixtureUrl.replace('127.0.0.1','localhost');
  curve = await createApp({mode:'service',seed:false,databaseUrl:process.env.CURVE_TEST_DATABASE_URL});
  api = createServer(curve.app);
  apiUrl = await listen(api);
  process.env.PORT = new URL(apiUrl).port;
  const owner = await request(apiUrl, '/api/auth/register', {method:'POST',body:{username:'smoke-owner-'+randomUUID().slice(0,8),password}});
  const cookie = owner.headers.get('set-cookie').split(';')[0];
  const operator = 'smoke-operator-'+randomUUID().slice(0,8);
  await createAccount(curve.db,operator,password,'operator');
  const session = await request(apiUrl,'/api/auth/login',{method:'POST',body:{username:operator,password}});
  operatorCookie = session.headers.get('set-cookie').split(';')[0];
  ({project} = await (await request(apiUrl,'/api/projects',{
    method:'POST',cookie,body:{name:'Curve smoke',domain:new URL(tenantUrl).host},
  })).json());
  const provisioned = await (await request(apiUrl,`/api/projects/${project.id}/web`,{method:'POST',cookie})).json();
  assert.equal(provisioned.project.umamiWebsiteId,project.id);
  siteLinked = true;
  const integration = await (await request(apiUrl,`/api/projects/${project.id}/integration`,{cookie})).json();
  assert.match(integration.script,/integrity="sha384-/);
  // The smoke page uses the DNS spelling localhost, matching the tracker domain list.
  script = integration.script;
  profile = await mkdtemp(join(tmpdir(), 'curve-smoke-chromium-'));
  browser = spawn(process.env.CURVE_CHROMIUM, [
    '--headless', '--no-first-run', '--disable-background-networking', '--disable-sync',
    // Dedicated synthetic check: exercise the browser path without the HeadlessChrome bot label.
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    `--user-data-dir=${profile}`,
    `${tenantUrl}${path}?ignored=1`,
  ], {stdio:'ignore', windowsHide:true});
  const browserError = new Promise((_, reject) => browser.once('error', reject));

  await Promise.race([browserError, (async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const overview = await (await request(apiUrl,`/api/projects/${project.id}/overview`,{cookie})).json();
      if (overview.sourceStatus.web === 'connected' && overview.metrics.pageviews >= 1
        && overview.pages.some(page => page.path === path && page.views > 0)) return;
      await delay(700);
    }
    throw new Error('Curve did not report the Umami browser page view within the smoke window.');
  })()]);
  console.log('PASS: pinned tracker in Chromium → local Umami → Curve project overview.');
} finally {
  if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
    const exited = once(browser, 'close');
    browser.kill();
    await Promise.race([exited, delay(2000)]);
  }
  if (project && operatorCookie) {
    try { await request(apiUrl,`/api/projects/${project.id}`,{method:'DELETE',cookie:operatorCookie}); }
    catch {
      // If a lost binding left an orphan, remove only this test's deterministic site.
      await request(base,`/api/websites/${project.id}`,{method:'DELETE',token}).catch(() => {});
      console.warn('Curve could not complete managed property cleanup.');
    }
    if (!siteLinked) await request(base,`/api/websites/${project.id}`,{method:'DELETE',token}).catch(() => {});
  }
  if (api) await new Promise(resolve => api.close(resolve));
  if (fixture) await new Promise(resolve => fixture.close(resolve));
  await curve?.close();
  if (trackerCreated) await unlink(trackerPath);
  if (profile) await rm(profile, {recursive:true,force:true,maxRetries:2}).catch(() => {
    console.warn('Could not remove the temporary browser profile.');
  });
}
