import { normalizePath } from './core.mjs';
import { createHash } from 'node:crypto';

let cachedSession;

function referrerHost(value) {
  if (!value || value === '(direct)') return 'Direct';
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      ? url.hostname : 'Other';
  } catch { return 'Other'; }
}

function group(rows, transform) {
  const counts = new Map();
  for (const row of rows) {
    const name = transform(row.name);
    counts.set(name, (counts.get(name) || 0) + row.events);
  }
  return [...counts].map(([name, events]) => ({name, events})).sort((a, b) => b.events - a.events);
}

export class UmamiError extends Error {
  constructor(status) {
    super('Umami request failed');
    this.status = status;
  }
}

export function umamiConfigured() {
  return Boolean(process.env.UMAMI_BASE_URL && process.env.UMAMI_USERNAME && process.env.UMAMI_PASSWORD);
}

// Server-to-server adapter. Credentials and upstream response bodies stay on the server.
async function umamiSession() {
  const base = new URL(process.env.UMAMI_BASE_URL);
  if (!['http:','https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid Umami URL');
  async function request(path, {method='GET',body,token}={}) {
    const res = await fetch(new URL(path,base), {
      method,redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{...(body && {'Content-Type':'application/json'}),...(token && {Authorization:`Bearer ${token}`})},
      body:body && JSON.stringify(body),
    });
    if (!res.ok) throw new UmamiError(res.status);
    return res;
  }
  const username = process.env.UMAMI_USERNAME, password = process.env.UMAMI_PASSWORD;
  const fingerprint = createHash('sha256').update(JSON.stringify([base.href,username,password])).digest('hex');
  function token() {
    if (!cachedSession || cachedSession.fingerprint !== fingerprint || cachedSession.expires <= Date.now()) {
      const pending = request('/api/auth/login',{method:'POST',body:{username,password}})
        .then(response=>response.json()).then(login=>{
          if (!login.token || login.user?.passwordChangeRequired) throw new Error('Umami account must be initialized');
          return login.token;
        });
      const entry = {fingerprint,expires:Date.now()+240_000,pending};
      cachedSession = entry;
      pending.catch(()=>{if(cachedSession === entry)cachedSession = undefined;});
    }
    return cachedSession.pending;
  }
  return async (path,options) => {
    try { return await request(path,{...options,token:await token()}); }
    catch (error) {
      if (!(error instanceof UmamiError) || error.status !== 401) throw error;
      if (cachedSession?.fingerprint === fingerprint) cachedSession = undefined;
      return request(path,{...options,token:await token()});
    }
  };
}

export async function provisionUmami(project) {
  const request = await umamiSession();
  const path = '/api/websites/'+encodeURIComponent(project.id);
  const name = `Curve ${project.id} — ${project.name}`.slice(0,100);
  const domain = project.domain;
  let website;
  try {
    website = await (await request('/api/websites',{method:'POST',body:{id:project.id,name,domain}})).json();
  } catch (error) {
    if (!(error instanceof UmamiError) || ![400,409].includes(error.status)) throw error;
    // Recover only the property allocated to this project after a lost response or DB rollback.
    website = await (await request(path)).json();
  }
  if (website?.id !== project.id || website.domain !== domain || website.name !== name) {
    throw new Error('Unexpected Umami website');
  }
  return website.id;
}

export async function removeManagedUmami(websiteId) {
  const request = await umamiSession();
  try { await request('/api/websites/'+encodeURIComponent(websiteId),{method:'DELETE'}); }
  catch (error) {
    if (!(error instanceof UmamiError) || error.status !== 404) throw error;
  }
}

export async function fetchUmami(websiteId, startAt, endAt) {
  const base=process.env.UMAMI_BASE_URL;
  if(!base || !websiteId) return {status:'not-configured',data:null};
  try {
    const request = await umamiSession();
    const query=`startAt=${new Date(startAt).getTime()}&endAt=${new Date(endAt).getTime()}`;
    const get=async path=>(await request(`/api/websites/${encodeURIComponent(websiteId)}/${path}`)).json();
    const [rawStats,pageviews,pages,referrers,countries,devices,browsers]=await Promise.all([
      get(`stats?${query}`),get(`pageviews?${query}&unit=day&timezone=UTC`),...['path','referrer','country','device','browser'].map(type=>get(`metrics?${query}&type=${type}&limit=50`))
    ]);
    const stats = rawStats?.[0] ?? rawStats;
    if (!Object.hasOwn(stats, 'pageviews') || !Array.isArray(pageviews.pageviews)) throw new Error('Unexpected Umami response');
    if (!['pageviews','visitors','visits','bounces','totaltime'].every(key=>{
      const value=stats[key]?.value ?? stats[key];
      return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value)>=0;
    })) throw new Error('Incomplete Umami statistics');
    const n=x=>Number.isFinite(Number(x?.value??x)) ? Math.max(0, Number(x?.value??x)) : 0;
    const list=x=>Array.isArray(x)?x.map(v=>({name:String(v.x??''),events:n(v.y)})):[];
    const visits=n(stats.visits);
    const shortLabel = value => /^[a-z0-9 _-]{1,24}$/i.test(value) ? value : 'Other';
    return {status:'connected',data:{
      pageviews:n(stats.pageviews), visitors:n(stats.visitors),
      visits, bounces:n(stats.bounces), totalDuration:n(stats.totaltime),
      bounceRate:visits?n(stats.bounces)/visits*100:0,
      avgDuration:visits?n(stats.totaltime)/visits:0,
      pages:group(list(pages), normalizePath).map(p=>({path:p.name,views:p.events})),
      referrers:group(list(referrers), referrerHost),
      countries:group(list(countries), value => /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : 'Other'),
      devices:group(list(devices), shortLabel), browsers:group(list(browsers), shortLabel),
      series:pageviews.pageviews.map(p=>({date:String(p.x).slice(0,10),web:n(p.y)})),
    }};
  } catch { return {status:'unavailable',data:null}; }
}
