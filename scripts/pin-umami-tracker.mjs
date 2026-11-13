import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Run only against your reviewed, version-pinned Umami deployment.
const base = process.argv[2] || 'http://127.0.0.1:3100';
const version = '3.5.0';
const url = new URL('/script.js', base);
const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
if (!response.ok || !/javascript/.test(response.headers.get('content-type') || '')) throw new Error('Expected Umami JavaScript from the configured deployment.');
const code = Buffer.from(await response.arrayBuffer());
if (!code.length || code.length > 1024 * 1024) throw new Error('Unexpected tracker size.');
const digest = createHash('sha384').update(code).digest('base64');
const filename = `signal-${version}-${createHash('sha256').update(code).digest('hex').slice(0,16)}.js`;
const dir = resolve('public/vendor');
await mkdir(dir, { recursive: true });
try { await access(resolve(dir, filename)); throw new Error('Pinned artifact already exists; refusing overwrite.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
await writeFile(resolve(dir, filename), code, { flag: 'wx' });
await writeFile(resolve(dir, `${filename}.json`), JSON.stringify({ base, version, sha384: digest, filename, capturedAt: new Date().toISOString(), note: 'Review source and endpoint behavior before tenant deployment. Bytes pinned; source build provenance is a separate check.' }, null, 2), { flag: 'wx' });
console.log(`Pinned ${filename}\nSRI: sha384-${digest}\nSet CURVE_TRACKER_FILE=${filename} and configure Curve's collection gate.`);
