import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import express from 'express';
import { normalizePath } from './core.mjs';

// Privacy boundary: only anonymous pageviews reach the private Umami collector.
export function sanitizeWebEvent(body, project, requestOrigin) {
  if (!project || project.is_demo || project.enrollment === 'pending') throw new Error('Unknown website');
  const origin = new URL(requestOrigin);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== requestOrigin ||
    (origin.host !== project.domain && origin.hostname !== project.domain)) throw new Error('Origin mismatch');
  const p = body?.payload;
  if (body?.type !== 'event' || !p || p.website !== project.umami_website_id || p.hostname !== origin.hostname) throw new Error('Invalid event');
  if (p.name || p.id || p.data || p.tag || p.timestamp) throw new Error('Only anonymous pageviews are accepted');
  if (typeof p.url !== 'string' || !p.url || p.url.length > 2048) throw new Error('Invalid page URL');
  const page = new URL(p.url, origin);
  if (page.origin !== origin.origin || page.pathname.length > 1024) throw new Error('Invalid page URL');
  // No queries, fragments, titles, arbitrary properties, identifiers or precise referrer paths.
  let referrer = '';
  try { const r = new URL(p.referrer); if (['http:', 'https:'].includes(r.protocol)) referrer = r.origin; } catch {}
  const payload = { website: p.website, hostname: origin.hostname, url: normalizePath(page.pathname), referrer };
  if (typeof p.language === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(p.language)) payload.language = p.language.slice(0,35);
  if (typeof p.screen === 'string' && /^\d{1,5}x\d{1,5}$/.test(p.screen)) payload.screen = p.screen;
  return { type: 'event', payload };
}

export function coarseAddress(address) {
  const ip = address?.replace(/^::ffff:(?=\d+\.)/i,'');
  if (isIP(ip) === 4) return ip.replace(/\.\d+$/,'.0');
  if (isIP(ip) !== 6 || ip.includes('%')) return '';
  const [left,right] = new URL(`http://[${ip}]`).hostname.slice(1,-1).split('::');
  const first = left ? left.split(':') : [];
  if (right !== undefined) {
    const last = right ? right.split(':') : [];
    first.push(...Array(8-first.length-last.length).fill('0'),...last);
  }
  return first.slice(0,3).join(':')+'::';
}

function browserRequest(req) {
  return req.get('sec-fetch-mode') === 'cors' && req.get('sec-fetch-dest') === 'empty'
    && ['same-origin','same-site','cross-site'].includes(req.get('sec-fetch-site'));
}

export function mountWebGate(app, { findWebsite, upstream, secret, observe = async () => {}, fetchImpl = fetch, now = Date.now }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Set CURVE_WEB_GATE_SECRET to at least 32 characters.');
  const collector = new URL('/api/send',upstream);
  const challenges = new Map();
  const networks = new Map();
  const anonymize = (...values) => createHmac('sha256',secret).update(JSON.stringify(values)).digest('hex');
  const originOf = req => req.get('origin');
  const privacyOptOut = req => req.get('dnt') === '1' || req.get('sec-gpc') === '1';
  async function report(project,kind,time) {
    try { await observe(project,kind,new Date(time)); }
    catch { console.error('Could not record web collection diagnostics.'); }
  }
  const cors = (req,res) => res.set({'Access-Control-Allow-Origin':originOf(req),'Vary':'Origin','Cache-Control':'no-store'});
  const sweep = (map,time) => {
    // All entries use a fixed TTL and are ordered by insertion time.
    for (const [key,value] of map) {
      if (value.expires > time) break;
      map.delete(key);
    }
  };
  app.options('/api/send', (req,res) => {
    if (!originOf(req) || originOf(req)==='null') return res.sendStatus(403);
    return cors(req,res).set({'Access-Control-Allow-Methods':'POST',
      'Access-Control-Allow-Headers':'content-type,x-umami-website-id,x-umami-hostname,x-umami-cache'}).sendStatus(204);
  });
  app.get('/api/web-challenge', async (req,res) => {
    try {
      if (!browserRequest(req) || privacyOptOut(req)) return res.sendStatus(403);
      const origin = new URL(originOf(req));
      const website = req.query.website;
      const project = await findWebsite(website);
      sanitizeWebEvent({type:'event',payload:{website,hostname:origin.hostname,url:'/'}},project,originOf(req));
      cors(req,res);
      const time = now();
      sweep(challenges,time);
      sweep(networks,time);
      if (challenges.size >= 10000 || networks.size >= 10000) return res.sendStatus(429);
      const agent = (req.get('user-agent') ?? '').slice(0,256);
      const key = anonymize('network',website,coarseAddress(req.ip) || req.ip,Math.floor(time/600_000));
      const bucket = networks.get(key) ?? {expires:time+600_000,agents:new Set(),requests:0};
      networks.set(key,bucket);
      bucket.agents.add(anonymize(agent));
      if (++bucket.requests > 600 || bucket.agents.size > 24) {
        await report(project,'limited',time);
        return res.sendStatus(429);
      }
      const token = randomBytes(24).toString('base64url');
      challenges.set(token,{expires:time+30_000,binding:anonymize(website,origin.origin,req.ip,agent)});
      return res.json({token});
    } catch { return res.sendStatus(403); }
  });
  app.post('/api/send', express.json({limit:'16kb'}), async (req,res) => {
    const website = req.body?.payload?.website;
    const challengeToken = req.body?.payload?.curveChallenge;
    const agent = (req.get('user-agent') ?? '').slice(0,256);
    try {
      if (!browserRequest(req) || privacyOptOut(req) || !originOf(req)) return res.sendStatus(403);
      const challenge = challenges.get(challengeToken);
      const time = now();
      if (!challenge || challenge.expires <= time ||
        challenge.binding !== anonymize(website,originOf(req),req.ip,agent)) return res.sendStatus(403);
      challenges.delete(challengeToken);
      const project = await findWebsite(website);
      const body = sanitizeWebEvent(req.body,project,originOf(req));
      cors(req,res);
      const ip = coarseAddress(req.ip);
      if (ip) body.payload.ip = ip;
      body.payload.salt = anonymize('visitor',website,req.ip,Math.floor(time/86_400_000));
      let result;
      try {
        const response = await fetchImpl(collector, {
          method:'POST',headers:{'content-type':'application/json','user-agent':agent},
          body:JSON.stringify(body),signal:AbortSignal.timeout(5000),redirect:'error',
        });
        if (!response.ok) throw new Error('Upstream unavailable');
        result = await response.json();
      } catch {
        await report(project,'upstream_error',time);
        return res.status(502).json({error:'Collection unavailable'});
      }
      await report(project,result?.beep === 'boop' ? 'bot' : 'forwarded',time);
      return res.json({});
    } catch { return res.status(400).json({error:'Collection rejected'}); }
  });
}
