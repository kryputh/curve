import express from 'express';
import { initializeAccounts, mountAccounts } from './accounts.mjs';
import { openDatabase } from './database.mjs';
import { InstrumentConflict, storeMetrics } from './ingestion.mjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { digest, parseOtlp, percentile, statusDistribution } from './core.mjs';
import { initializeRollups, readDailyApi } from './rollups.mjs';
import { fetchUmami, provisionUmami, removeManagedUmami, umamiConfigured } from './umami.mjs';
import { parseOtlpHttp, sendOtlpMetricsResponse } from './otlp-http.mjs';
import { mountTracker, trackerSnippet } from './tracker.mjs';
import { mountWebGate } from './web-gate.mjs';
import { initializeWebRollups, readDailyWeb } from './web-rollups.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const daysOf=req=>[7,30,90,365,731].includes(Number(req.query.days))?Number(req.query.days):30;
const method={version:'curve-0.2',notes:['Web metrics originate from Umami frontend instrumentation; API metrics originate from authenticated tenant OTLP delta exports.','Synthetic demo fixtures are never mixed into newly enrolled projects.','Latency percentiles are histogram bucket upper-bound estimates. Null means an unbounded bucket or insufficient compatible histogram data; no finite percentile is claimed.','API counts use UTC daily rollups; recent diagnostics contain the last eight days of retained export points.','API errors include HTTP 4xx and 5xx. Unique visitors are Umami estimates, not verified people.','Web last-event time and coverage are unknown for live Umami snapshots; zero values with not-configured/unavailable source state mean missing data, not measured zero usage.','A digest verifies report integrity, not genuine traffic or independent attestation.']};
const cleanProject=row=>{const {key_hash,owner_id,...p}=row;return {id:p.id,name:p.name,domain:p.domain,network:p.network,isDemo:p.is_demo,createdAt:p.created_at,umamiWebsiteId:p.umami_website_id,enrollment:p.enrollment};};

export async function createApp({dataDir='memory://',databaseUrl,mode=databaseUrl?'service':'local-demo',seed=mode==='local-demo',publicOrigin,enrollmentMode='open'}={}) {
  const service = mode === 'service';
  const development = mode === 'development';
  if (!['development','service','local-demo'].includes(mode)) throw new Error('Invalid application mode.');
  if (development && (publicOrigin || seed)) throw new Error('Development mode requires a local origin and no seeded data.');
  if (!['open','approval'].includes(enrollmentMode)) throw new Error('Invalid enrollment mode.');

  const origin = publicOrigin ? new URL(publicOrigin) : null;
  if (origin && (origin.origin !== publicOrigin || origin.protocol !== 'https:')) throw new Error('CURVE_PUBLIC_ORIGIN must be an HTTPS origin.');
  if (service && !databaseUrl && seed) throw new Error('Service mode cannot seed demo data.');
  const db = await openDatabase({dataDir,databaseUrl});
  await db.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY,name TEXT NOT NULL,domain TEXT NOT NULL,network TEXT NOT NULL,is_demo BOOLEAN NOT NULL DEFAULT false,owner_id TEXT NOT NULL,key_hash TEXT,umami_website_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),ts TIMESTAMPTZ NOT NULL,data JSONB NOT NULL);
    CREATE INDEX IF NOT EXISTS records_project_ts ON records(project_id,ts);
    CREATE TABLE IF NOT EXISTS quality (project_id TEXT PRIMARY KEY REFERENCES projects(id),duplicates BIGINT NOT NULL DEFAULT 0,rejected BIGINT NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS read_keys (id TEXT PRIMARY KEY,key_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),revoked BOOLEAN NOT NULL DEFAULT false);`);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS instruments (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      service TEXT NOT NULL, path TEXT NOT NULL, status INT NOT NULL, metric TEXT NOT NULL,
      PRIMARY KEY(project_id,service,path,status)
    );
    INSERT INTO instruments(project_id,service,path,status,metric)
    SELECT DISTINCT ON (project_id,data->>'service',data->>'path',data->>'status')
      project_id,data->>'service',data->>'path',(data->>'status')::int,data->>'metric'
    FROM records WHERE data->>'metric' IS NOT NULL
    ORDER BY project_id,data->>'service',data->>'path',data->>'status',ts,id
    ON CONFLICT DO NOTHING;
  `);
  await initializeRollups(db);
  await initializeWebRollups(db);
  if(seed) {
    for (const [id,name,domain,mult] of [['demo-project','Meridian Pay','meridian.example',1],['demo-orbit','Orbit Exchange','orbit.example',0.64]]) {
      await db.query('INSERT INTO projects(id,name,domain,network,is_demo,owner_id) VALUES ($1,$2,$3,$4,true,$5) ON CONFLICT DO NOTHING',[id,name,domain,'mainnet',id==='demo-project'?'demo-tenant':'another-tenant']);
      const existing=await db.query('SELECT id FROM records WHERE project_id=$1 LIMIT 1',[id]);
      if(!existing.rows.length) await db.transaction(async tx=>{
        for(let i=89;i>=0;i--) {
          const date=new Date();date.setUTCHours(12,0,0,0);date.setUTCDate(date.getUTCDate()-i);
          const wave=1+Math.sin(i*.6)*.22;const growth=1+(89-i)/110;
          for (const [j,path] of ['/','/dashboard','/send','/developers'].entries()) {
            const count=Math.round((110+23*j)*wave*growth*mult);
            const r={id:`${id}-web-${i}-${j}`,type:'pageview',path,count,status:200,duration:84+j*19,timestamp:date.toISOString(),source:'synthetic',disposition:'accepted',visitors:Math.round(count*.72),bounces:Math.round(count*.29),buckets:[]};
            await tx.query('INSERT INTO records(id,project_id,ts,data) VALUES ($1,$2,$3,$4)',[r.id,id,r.timestamp,JSON.stringify(r)]);
          }
          for(const [j,path] of ['/api/payments','/api/accounts/:address','/api/quotes','/api/transactions/:hash'].entries()) {
            const count=Math.round((1850-j*330)*wave*growth*mult),errors=Math.round(count*(.006+j*.002));
            const b1=Math.floor(count*.56),b2=Math.floor(count*.4),b3=count-b1-b2;
            const r={id:`${id}-api-${i}-${j}`,type:'api',path,count,errors,status:200,duration:92+j*12,timestamp:date.toISOString(),source:'synthetic',disposition:'accepted',service:'meridian-api',buckets:[{bound:100,count:b1},{bound:250,count:b2},{bound:500,count:b3}]};
            await tx.query('INSERT INTO records(id,project_id,ts,data) VALUES ($1,$2,$3,$4)',[r.id,id,r.timestamp,JSON.stringify(r)]);
          }
        }
      });
    }
  }
  if (service) await initializeAccounts(db);
  await db.exec(`
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS manages_umami BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS enrollment TEXT NOT NULL DEFAULT 'approved'
      CHECK(enrollment IN ('approved','pending'));
    CREATE TABLE IF NOT EXISTS web_quality (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      day DATE NOT NULL, outcome TEXT NOT NULL, attempts BIGINT NOT NULL,
      PRIMARY KEY(project_id,day,outcome)
    );
  `);
  const app=express(); app.disable('x-powered-by');
  const trustedProxy = process.env.CURVE_TRUSTED_PROXY;
  if (service && trustedProxy) app.set('trust proxy',trustedProxy);
  const webSecret = process.env.CURVE_WEB_GATE_SECRET;
  const umamiBase = process.env.UMAMI_BASE_URL;
  const sessions=new Map(),rate=new Map();
  // The immutable tracker is public and must support cross-origin SRI.
  mountTracker(app);
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('Cache-Control','no-store');
    const hostname=req.hostname;
    if(hostname!==origin?.hostname && !['localhost','127.0.0.1','::1','[::1]'].includes(hostname)) return res.status(403).json({error:'Host is not configured for this service.'});
    if (webSecret && umamiBase && ['/api/web-challenge','/api/send'].includes(req.path)) return next();
    if(service && req.headers.origin && req.headers.origin !== (publicOrigin || `http://${req.headers.host}`)) return res.status(403).json({error:'Cross-origin requests are not allowed'});
    if(!service && req.headers.origin) {let origin;try{origin=new URL(req.headers.origin);}catch{return res.status(403).json({error:'Invalid origin'});} if(!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) return res.status(403).json({error:'Cross-origin requests are not allowed'});}
    next();
  });
  if (webSecret && umamiBase) {
    mountWebGate(app,{
      secret:webSecret,
      upstream:umamiBase,
      findWebsite:async id=>{
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return null;
        const {rows} = await db.query(
          'SELECT id,domain,umami_website_id,is_demo,enrollment FROM projects WHERE umami_website_id=$1 LIMIT 2',
          [id],
        );
        return rows.length === 1 ? rows[0] : null;
      },
      observe:(project,outcome,time)=>db.query(`
        INSERT INTO web_quality(project_id,day,outcome,attempts) VALUES($1,$2,$3,1)
        ON CONFLICT(project_id,day,outcome) DO UPDATE SET attempts=web_quality.attempts+1
      `,[project.id,time.toISOString().slice(0,10),outcome]),
    });
  }
  const jsonParser = express.json({limit:'512kb'});
  app.use((req,res,next)=>{
    if (req.path.startsWith('/api/otlp/')) return next();
    return jsonParser(req,res,next);
  });
  if (service) mountAccounts(app, db, Boolean(origin));
  else if (development) app.use((req,_res,next)=>{
    req.user={id:'local-developer',role:'operator',name:'Developer'};
    next();
  });
  else app.use((req,res,next)=>{
    const cookie=req.headers.cookie?.match(/(?:^|;\s*)curve_session=([a-f0-9]+)/)?.[1];
    const session=cookie&&sessions.get(cookie);if(session&&session.expires>Date.now())req.user=session.user;
    next();
  });
  const requireAuth=(req,res,next)=>req.user?next():res.status(401).json({error:'Sign in to continue.'});
  const operator=(req,res,next)=>req.user?.role==='operator'?next():res.status(403).json({error:'Operator access required'});
  app.get('/api/health',(req,res)=>res.json({status:'ok',mode,database:databaseUrl?'PostgreSQL server':'PGlite PostgreSQL',productionReady:false}));
  if (mode === 'local-demo') app.post('/api/auth/demo',(req,res)=>{
    if(!['tenant','operator'].includes(req.body.role))return res.status(400).json({error:'role must be tenant or operator'});
    const role=req.body.role,user={id:role==='tenant'?'demo-tenant':'demo-operator',role,name:role==='tenant'?'Demo builder':'SCF operator demo'};
    const session=randomBytes(32).toString('hex');sessions.set(session,{user,expires:Date.now()+8*3600000});
    res.cookie('curve_session',session,{httpOnly:true,sameSite:'strict',maxAge:8*3600000,path:'/'}).json({user,session:user,mode:'local-demo'});
  });
  app.get('/api/auth/me',requireAuth,(req,res)=>res.json({user:req.user,session:req.user,mode}));
  if (mode === 'local-demo') app.post('/api/auth/logout',(req,res)=>{const token=req.headers.cookie?.match(/curve_session=([a-f0-9]+)/)?.[1];sessions.delete(token);res.clearCookie('curve_session').json({ok:true});});
  const lookup=async(id)=> (await db.query('SELECT * FROM projects WHERE id=$1',[id])).rows[0];
  const access=async(req,res,next)=>{
    const p=await lookup(req.params.id);
    if(!p||(req.user.role!=='operator'&&p.owner_id!==req.user.id))return res.status(404).json({error:'Project not found'});
    req.project=p;next();
  };
  app.get('/api/projects',requireAuth,async(req,res)=>{
    const q=req.user.role==='operator'?await db.query('SELECT * FROM projects ORDER BY created_at,id'):await db.query('SELECT * FROM projects WHERE owner_id=$1 ORDER BY created_at,id',[req.user.id]);
    res.json({projects:q.rows.map(cleanProject)});
  });
  app.post('/api/projects',requireAuth,async(req,res)=>{
    const {name,domain,network='testnet',umamiWebsiteId}=req.body;
    if(umamiWebsiteId && req.user.role!=='operator')return res.status(403).json({error:'Only an operator may bind an Umami website after verifying ownership.'});
    if(typeof name!=='string'||!name.trim()||name.length>80||typeof domain!=='string'||!/^([a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/i.test(domain)||domain.length>253||!['mainnet','testnet'].includes(network)||(umamiWebsiteId&&!/^[a-f0-9-]{36}$/i.test(umamiWebsiteId)))return res.status(400).json({error:'Provide a name, hostname without protocol, mainnet/testnet, and optional Umami website UUID.'});
    if (umamiWebsiteId) {
      const {rows} = await db.query('SELECT id FROM projects WHERE umami_website_id=$1 LIMIT 1',[umamiWebsiteId]);
      if (rows.length) return res.status(409).json({error:'This Umami site is already linked to a project.'});
    }
    if (!service) {
      const count = await db.query('SELECT count(*) FROM projects');
      if (Number(count.rows[0].count)>=100) return res.status(429).json({error:'Local preview project limit reached'});
    }
    const id=randomUUID(),apiKey=`cv_${randomBytes(32).toString('hex')}`;
    const enrollment = enrollmentMode === 'approval' && req.user.role === 'tenant' ? 'pending' : 'approved';
    await db.query(
      'INSERT INTO projects(id,name,domain,network,owner_id,key_hash,umami_website_id,enrollment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id,name.trim(),domain.toLowerCase(),network,req.user.id,hash(apiKey),umamiWebsiteId||null,enrollment],
    );
    res.status(201).json({project:cleanProject(await lookup(id)),apiKey});
  });
  async function overview(p,days) {
    const end=new Date(),start=new Date(end);start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()-days+1);
    const startDay = start.toISOString().slice(0,10);
    const endDay = end.toISOString().slice(0,10);
    const {rows: recent} = await db.query(
      `SELECT data FROM records WHERE project_id=$1 AND ts >= $2 AND ts <= $3
       ORDER BY ts DESC,id DESC${p.is_demo ? '' : ' LIMIT 20'}`,
      [p.id,start.toISOString(),end.toISOString()],
    );
    const observations = recent.map(row => row.data);
    const webRows = p.is_demo ? observations.filter(row => row.type === 'pageview') : [];
    const apiRows = p.is_demo
      ? observations.filter(row => row.type === 'api')
      : await readDailyApi(db,p.id,startDay,endDay);
    const rows = [...webRows,...apiRows];
    const sum=(r,k='count')=>r.reduce((a,b)=>a+Number(b[k]||0),0);
    const grouped=(r)=>{const m=new Map();for(const e of r){if(!m.has(e.path))m.set(e.path,[]);m.get(e.path).push(e);}return [...m.entries()];};
    const webStatus=p.is_demo?{status:'synthetic',data:null}:await fetchUmami(p.umami_website_id,start,end);
    const synthWeb=sum(webRows),synthVisitors=sum(webRows,'visitors');
    const metrics={pageviews:webStatus.data?.pageviews??synthWeb,visitors:webStatus.data?.visitors??synthVisitors,apiRequests:sum(apiRows),acceptedEvents:sum(rows),excludedEvents:0,errorRate:sum(apiRows)?sum(apiRows,'errors')/sum(apiRows)*100:0,p50Latency:percentile(apiRows,.5),p95Latency:percentile(apiRows,.95),activeDays:new Set(rows.map(r=>r.timestamp.slice(0,10))).size,bounceRate:webStatus.data?.bounceRate??(synthWeb?sum(webRows,'bounces')/synthWeb*100:0),avgDuration:webStatus.data?.avgDuration??(webRows.length?sum(webRows,'duration')/webRows.length:0)};
    const dailyCounts = new Map();
    for (const [kind, observations] of [['web',webRows],['api',apiRows]]) {
      for (const row of observations) {
        const day = row.timestamp.slice(0,10);
        const totals = dailyCounts.get(day) ?? {web:0,api:0};
        totals[kind] += row.count;
        dailyCounts.set(day,totals);
      }
    }
    const series = Array.from({length:days}, (_,i) => {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate()+i);
      const date = day.toISOString().slice(0,10);
      return {date,...(dailyCounts.get(date) ?? {web:0,api:0})};
    });
    if(webStatus.data)for(const point of series)point.web=webStatus.data.series.find(s=>s.date===point.date)?.web||0;
    metrics.acceptedEvents=metrics.pageviews+metrics.apiRequests;
    const qualityRow=(await db.query('SELECT * FROM quality WHERE project_id=$1',[p.id])).rows[0];
    const quality={duplicate:Number(qualityRow?.duplicates||0),bot:0,invalid:Number(qualityRow?.rejected||0),accepted:metrics.acceptedEvents,coverageDays:metrics.activeDays,lastEventAt:rows.reduce((latest,row)=>latest===null||row.timestamp>latest?row.timestamp:latest,null),scope:'Duplicate and invalid counters are lifetime; accepted metrics are selected period. Bot filtering is delegated to Umami; no bot count imported.'};
    if (p.manages_umami && webSecret) {
      const {rows:diagnostics} = await db.query(`
        SELECT outcome,sum(attempts) AS attempts FROM web_quality
        WHERE project_id=$1 AND day BETWEEN $2::date AND $3::date GROUP BY outcome
      `,[p.id,startDay,endDay]);
      const outcomes = Object.fromEntries(diagnostics.map(row=>[row.outcome,Number(row.attempts)]));
      quality.webGate = {
        forwarded:outcomes.forwarded ?? 0, suspectedBots:outcomes.bot ?? 0,
        rateLimited:outcomes.limited ?? 0, upstreamErrors:outcomes.upstream_error ?? 0,
      };
      quality.scope = 'API duplicates and invalid counts are lifetime. Web gate diagnostics are attempts in the selected period. Forwarded attempts are distinct from pageviews confirmed by Umami.';
    }
    metrics.excludedEvents=quality.duplicate+quality.invalid;
    const splits=(items)=>items.map(([name,share])=>({name,events:Math.round(metrics.pageviews*share)}));
    const countries=webStatus.data?.countries??(p.is_demo?splits([['Nigeria',.38],['United States',.26],['Kenya',.19],['United Kingdom',.1],['Other',.07]]):[]);
    const devices=webStatus.data?.devices??(p.is_demo?splits([['Mobile',.61],['Desktop',.35],['Tablet',.04]]):[]);
    const browsers=webStatus.data?.browsers??(p.is_demo?splits([['Chrome',.64],['Safari',.25],['Firefox',.11]]):[]);
    const referrers=webStatus.data?.referrers??(p.is_demo?splits([['Direct',.52],['stellar.org',.26],['Google',.14],['Other',.08]]):[]);
    return {project:cleanProject(p),days,metrics,series,statusCodes:statusDistribution(apiRows),pages:webStatus.data?.pages??grouped(webRows).map(([path,rs])=>({path,views:sum(rs)})).sort((a,b)=>b.views-a.views),endpoints:grouped(apiRows).map(([path,rs])=>({path,requests:sum(rs),statusCodes:statusDistribution(rs),errorRate:sum(rs,'errors')/Math.max(sum(rs),1)*100,p50Latency:percentile(rs,.5),p95Latency:percentile(rs,.95)})).sort((a,b)=>b.requests-a.requests),sources:[{name:p.is_demo?'Synthetic web fixture':'Umami browser',events:metrics.pageviews},{name:p.is_demo?'Synthetic API fixture':'Authenticated OTLP',events:metrics.apiRequests}],quality,recentEvents:observations.slice(0,20),methodology:method,countries,devices,browsers,referrers,web:{visitors:metrics.visitors,bounceRate:metrics.bounceRate,avgDuration:metrics.avgDuration,countries,devices,browsers,referrers},sourceStatus:{web:webStatus.status,api:p.is_demo?'synthetic':apiRows.length?'connected':'awaiting-data'},period:{start:start.toISOString(),end:end.toISOString()}};
  }
  app.get('/api/projects/:id/overview',requireAuth,access,async(req,res)=>res.json(await overview(req.project,daysOf(req))));
  app.get('/api/projects/:id/web-history',requireAuth,access,async(req,res)=>{
    if (!req.project.umami_website_id) return res.json({status:'not-configured',series:[],missingDays:[],pageviews:0,visitorDays:0,uniqueVisitors:null});
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const end = new Date(today.getTime()-86400000);
    const start = new Date(today.getTime()-daysOf(req)*86400000);
    const created = new Date(req.project.web_connected_at ?? req.project.created_at); created.setUTCHours(0,0,0,0);
    if (created > end) return res.json({status:'awaiting-completed-day',series:[],missingDays:[],pageviews:0,visitorDays:0,uniqueVisitors:null});
    const report = await readDailyWeb(db,req.project.id,
      new Date(Math.max(start.getTime(),created.getTime())).toISOString().slice(0,10),end.toISOString().slice(0,10));
    res.json({...report,period:{start:new Date(Math.max(start.getTime(),created.getTime())).toISOString(),end:end.toISOString().slice(0,10)+'T23:59:59.999Z'},
      source:'Stored Umami daily aggregates',notes:['Only completed UTC days are included. Missing days are not zero traffic.','Visitor-days sum each day’s estimate; they are not unique visitors across the period.']});
  });
  app.get('/api/projects/:id/events',requireAuth,access,async(req,res)=>{
    const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));const data=await db.query('SELECT data FROM records WHERE project_id=$1 ORDER BY ts DESC LIMIT $2',[req.project.id,limit]);res.json({events:data.rows.map(r=>r.data)});
  });
  app.get('/api/projects/:id/evidence',requireAuth,access,async(req,res)=>{
    const o=await overview(req.project,daysOf(req));const report={schemaVersion:'curve-evidence/1',generatedAt:new Date().toISOString(),project:o.project,period:o.period,metrics:o.metrics,statusCodes:o.statusCodes,quality:o.quality,methodology:o.methodology,sourceStatus:o.sourceStatus,limitations:['Integrity is not proof of genuine users. Tenant instrumentation can fabricate or omit telemetry.','Demo projects contain synthetic fixtures. No SCF endorsement, adoption or compliance certification is implied.','Live Umami response is an upstream snapshot. No immutable external timestamp or independent signature is provided.','Local prototype: no production identity provider, no proven availability SLA and no production scale benchmark.']};
    res.setHeader('Content-Disposition',`attachment; filename="curve-${req.project.id}-evidence.json"`);res.json({...report,digest:digest(report)});
  });
  app.get('/api/projects/:id/export',requireAuth,access,async(req,res)=>{
    const o=await overview(req.project,daysOf(req));res.setHeader('Content-Disposition',`attachment; filename="curve-${req.project.id}.csv"`);res.type('text/csv').send('date,pageviews,api_requests\r\n'+o.series.map(r=>`${r.date},${r.web},${r.api}`).join('\r\n')+'\r\n');
  });
  app.post('/api/projects/:id/approve', requireAuth, operator, access, async (req,res) => {
    const {rows:[project]} = await db.query("UPDATE projects SET enrollment='approved' WHERE id=$1 RETURNING *",[req.project.id]);
    if (!project) return res.status(404).json({error:'Project not found'});
    return res.json({project:cleanProject(project)});
  });
  app.post('/api/projects/:id/web', requireAuth, access, async (req,res) => {
    if (req.project.is_demo) return res.status(400).json({error:'Create a project before connecting web analytics.'});
    if (req.project.enrollment !== 'approved') return res.status(403).json({error:'This project is awaiting operator approval.'});
    if (!umamiConfigured()) return res.status(503).json({error:'The operator has not configured the web analytics service.'});
    try {
      const result = await db.transaction(async tx => {
        const {rows:[project]} = await tx.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[req.project.id]);
        if (!project) return null;
        if (project.umami_website_id) return project;
        const websiteId = await provisionUmami(project);
        const {rows:[updated]} = await tx.query(
          'UPDATE projects SET umami_website_id=$2, manages_umami=true, web_connected_at=now() WHERE id=$1 RETURNING *',
          [project.id,websiteId],
        );
        return updated;
      });
      if (!result) return res.status(404).json({error:'Project not found'});
      return res.json({project:cleanProject(result)});
    } catch {
      return res.status(502).json({error:'Umami could not provision the website. Check that the project has a valid domain and try again.'});
    }
  });
  app.get('/api/projects/:id/integration',requireAuth,access,async(req,res)=>{
    const id=req.project.id;
    const curveOrigin = publicOrigin || `http://127.0.0.1:${process.env.PORT || 3001}`;
    const script = await trackerSnippet(req.project,curveOrigin);
    res.json({endpoint:`${curveOrigin}/api/otlp/v1/metrics`,script,canProvision:umamiConfigured() && req.project.enrollment === 'approved' && !req.project.is_demo && !req.project.umami_website_id,serverExample:`# Dual export using your OpenTelemetry Collector\n# Keep your existing APM exporter and add Curve to metrics only.\nexporters:\n  otlphttp/curve:\n    endpoint: ${curveOrigin}/api/otlp\n    encoding: proto\n    headers:\n      Authorization: Bearer YOUR_PROJECT_KEY\n# Use DELTA temporality, metric http.server.request.duration,\n# service.name and tenant.id=${id}.\n# Send histogram and not a duplicate counter for the same requests.`,privacyNotes:['Use the pinned Umami frontend script and upgrade intentionally after review.','Raw traces, spans and logs are discarded. Arbitrary OTLP attributes and exemplars are never persisted.','Route normalization strips IDs, addresses, hashes and query strings. Prefer http.route templates.','Use delta metrics over OTLP/HTTP protobuf or JSON. Use the Collector to convert cumulative metrics before export.','Only use a tracker on a domain you administer.'],umamiConfigured:Boolean(process.env.UMAMI_BASE_URL&&req.project.umami_website_id)});
  });
  app.post('/api/projects/:id/keys/rotate',requireAuth,access,async(req,res)=>{const apiKey=`cv_${randomBytes(32).toString('hex')}`;await db.query('UPDATE projects SET key_hash=$1 WHERE id=$2',[hash(apiKey),req.project.id]);res.json({apiKey});});
  app.delete('/api/projects/:id/keys',requireAuth,access,async(req,res)=>{await db.query('UPDATE projects SET key_hash=NULL WHERE id=$1',[req.project.id]);res.json({revoked:true});});
  app.delete('/api/projects/:id',requireAuth,operator,access,async(req,res)=>{
    if(req.project.is_demo)return res.status(400).json({error:'Demo fixtures cannot be removed.'});
    await db.transaction(async tx=>{
      const {rows:[project]} = await tx.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[req.project.id]);
      if (!project) return;
      if (project.manages_umami) await removeManagedUmami(project.umami_website_id);
      await tx.query('DELETE FROM records WHERE project_id=$1',[project.id]);
      await tx.query('DELETE FROM quality WHERE project_id=$1',[project.id]);
      await tx.query('DELETE FROM projects WHERE id=$1',[project.id]);
    });
    res.json({deleted:true});
  });
  app.post('/api/operator/read-keys',requireAuth,operator,async(req,res)=>{const id=randomUUID(),apiKey=`cvr_${randomBytes(32).toString('hex')}`;await db.query('INSERT INTO read_keys(id,key_hash) VALUES($1,$2)',[id,hash(apiKey)]);res.status(201).json({id,apiKey,scope:'global:metrics:read'});});
  app.get('/api/operator/read-keys',requireAuth,operator,async(_req,res)=>{
    const {rows} = await db.query('SELECT id,created_at AS "createdAt",revoked FROM read_keys ORDER BY created_at DESC LIMIT 200');
    res.json({keys:rows});
  });
  app.delete('/api/operator/read-keys/:keyId',requireAuth,operator,async(req,res)=>{await db.query('UPDATE read_keys SET revoked=true WHERE id=$1',[req.params.keyId]);res.json({revoked:true});});
  app.get('/api/metrics',async(req,res)=>{const key=req.headers.authorization?.replace(/^Bearer /,'');if(!key)return res.status(401).json({error:'Metrics read key required'});const found=await db.query('SELECT id FROM read_keys WHERE key_hash=$1 AND revoked=false',[hash(key)]);if(!found.rows.length)return res.status(401).json({error:'Invalid read key'});const projects=await db.query("SELECT * FROM projects WHERE enrollment='approved'");const items=[];for(const p of projects.rows) {const o=await overview(p,daysOf(req));items.push({project:o.project,metrics:o.metrics,statusCodes:o.statusCodes,sourceStatus:o.sourceStatus});}res.json({projects:items});});
  async function ingestionAuth(req,res,next) {
    const key=req.headers.authorization?.replace(/^Bearer /,'');if(!key)return res.status(401).json({error:'Project API key required'});
    const rows=await db.query('SELECT * FROM projects WHERE key_hash=$1',[hash(key)]);if(!rows.rows.length)return res.status(401).json({error:'Invalid API key'});req.project=rows.rows[0];
    if(req.project.enrollment !== 'approved') return res.status(403).json({error:'This project is awaiting operator approval.'});
    const now=Date.now(),bucket=rate.get(req.project.id);if(bucket&&bucket.until>now){bucket.count++;if(bucket.count>120)return res.status(429).json({error:'Rate limit: 120 export requests per minute'});}else rate.set(req.project.id,{count:1,until:now+60000});next();
  }
  app.post('/api/otlp/v1/metrics',ingestionAuth,parseOtlpHttp,async(req,res)=>{
    let parsed;try{parsed=parseOtlp(req.body,req.project.id);}catch(e){await db.query('INSERT INTO quality(project_id,rejected) VALUES($1,1) ON CONFLICT(project_id) DO UPDATE SET rejected=quality.rejected+1',[req.project.id]);return res.status(400).json({error:e.message});}
    let result;
    try { result = await storeMetrics(db, req.project, parsed); }
    catch (error) {
      if (!(error instanceof InstrumentConflict)) throw error;
      return res.status(400).json({error:'Conflicting HTTP request instruments. Use one canonical histogram or counter per service/route/status.'});
    }
    if (!result) return res.status(401).json({error:'Project API key is no longer valid'});
    return sendOtlpMetricsResponse(req,res,result,parsed.rejected);
  });
  app.post(['/api/otlp/v1/traces','/api/otlp/v1/logs'],ingestionAuth,(req,res)=>res.json({discarded:true,reason:'Curve persists standardized metrics only; no trace or log content was retained.'}));
  app.post('/api/collect',(req,res)=>res.status(400).json({error:'Use Umami frontend instrumentation for web data, or authenticated OTLP/HTTP for API metrics.'}));
  app.get('/tracker.js',(req,res)=>res.status(410).type('text/javascript').send('/* Curve requires the pinned, locally vendored Umami tracker. See project Integration. */'));
  app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
  app.use(express.static(resolve('dist'),{index:'index.html',setHeaders:res=>res.setHeader('Cache-Control','no-cache')}));
  app.get('/{*path}',(req,res)=>res.sendFile(resolve('dist/index.html'),err=>{if(err&&!res.headersSent)res.status(404).send('Run npm run dev, or npm run build first.');}));
  app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status||500).json({error:error.type==='entity.too.large'?'Payload too large':error instanceof SyntaxError?'Invalid JSON':'Request could not be completed'});});
  return {app,db,close:()=>db.close()};
}
