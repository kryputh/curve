import { createHash } from 'node:crypto';
import { helperIntegrity, helperPath, mountWebHelper } from './web-helper.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const filePattern = /^signal-\d+\.\d+\.\d+-([a-f0-9]{16})\.js$/;

export async function readPinnedTracker(filename) {
  const match = typeof filename === 'string' && filePattern.exec(filename);
  if (!match) return null;
  let bytes;
  try { bytes = await readFile(resolve('public','vendor',filename)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!bytes.length || bytes.length > 1024*1024) return null;
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0,16);
  if (hash !== match[1]) return null;
  return {bytes,integrity:'sha384-'+createHash('sha384').update(bytes).digest('base64')};
}

function attr(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

export async function trackerSnippet(project, publicOrigin) {
  if (!process.env.UMAMI_BASE_URL || (process.env.CURVE_WEB_GATE_SECRET ?? '').length < 32) return null;
  const filename = process.env.CURVE_TRACKER_FILE;
  const tracker = project.umami_website_id && await readPinnedTracker(filename);
  const origin = publicOrigin;
  if (!tracker || !origin) return null;
  let url;
  try { url = new URL(origin); } catch { return null; }
  if (url.origin !== origin || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) return null;
  return `<script defer src="${attr(publicOrigin)}${helperPath}" integrity="${helperIntegrity}" crossorigin="anonymous"></script><script defer src="${attr(publicOrigin)}/vendor/${filename}" integrity="${tracker.integrity}" crossorigin="anonymous" data-before-send="curveBeforeSend" data-website-id="${attr(project.umami_website_id)}" data-host-url="${attr(origin)}" data-domains="${attr(project.domain.split(':')[0])}" data-exclude-search="true" data-exclude-hash="true" data-do-not-track="true"></script>`;
}

export function mountTracker(app) {
  mountWebHelper(app);
  app.get('/vendor/:filename', async (req,res) => {
    const tracker = await readPinnedTracker(req.params.filename);
    if (!tracker) return res.sendStatus(404);
    return res.set({
      'Access-Control-Allow-Origin':'*',
      'Cache-Control':'public, max-age=31536000, immutable',
    }).type('application/javascript').send(tracker.bytes);
  });
}
