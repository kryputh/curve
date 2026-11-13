import { createHash } from 'node:crypto';

export const helper = `window.curveBeforeSend = async function (type, payload) {
  if (type !== 'event' || payload?.name || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return null;
  try {
    const script = document.querySelector('script[data-before-send="curveBeforeSend"]');
    const response = await fetch(script.dataset.hostUrl + '/api/web-challenge?website='
      + encodeURIComponent(payload.website), {credentials:'omit', cache:'no-store'});
    if (!response.ok) return null;
    const {token} = await response.json();
    return {...payload, curveChallenge:token};
  } catch {
    return null;
  }
};`;
export const helperIntegrity = 'sha384-'+createHash('sha384').update(helper).digest('base64');
export const helperPath = '/vendor/curve-gate-'+createHash('sha256').update(helper).digest('hex').slice(0,16)+'.js';
export function mountWebHelper(app) {
  app.get(helperPath, (_req,res) => res.set({
    'Access-Control-Allow-Origin':'*',
    'Cache-Control':'public, max-age=31536000, immutable',
  }).type('application/javascript').send(helper));
}
