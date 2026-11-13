import { createApp } from './app.mjs';
import { expireMetrics } from './rollups.mjs';
import { startWebMaintenance } from './web-maintenance.mjs';
const port=Number(process.env.PORT||3001);
const databaseUrl=process.env.CURVE_DATABASE_URL;
const mode=process.argv.includes('--demo')?'local-demo':process.argv.includes('--dev')?'development':databaseUrl||process.argv.includes('--service')?'service':'development';
if (mode === 'local-demo' && databaseUrl) throw new Error('Demo mode cannot use a shared service database.');
const host=process.env.CURVE_LISTEN_HOST || '127.0.0.1';
if ((mode !== 'service' || !databaseUrl) && host !== '127.0.0.1') throw new Error('Local development must bind to loopback.');
const {app,db,close}=await createApp({dataDir:process.env.CURVE_DATA_DIR||(mode==='local-demo'?'data/curve-postgres':'data/curve-service'),databaseUrl,mode,seed:mode==='local-demo',publicOrigin:process.env.CURVE_PUBLIC_ORIGIN,enrollmentMode:process.env.CURVE_ENROLLMENT});
const server=app.listen(port,host,()=>console.log(`Curve ${mode} listening on ${host}:${port}`));

let retentionRun;
let retentionTimer;
let stopWebMaintenance;
function scheduleRetention() {
  if (retentionRun) return;
  retentionRun = expireMetrics(db)
    .catch(() => console.error('Curve metric retention failed. Check database availability and privileges.'))
    .finally(() => { retentionRun = undefined; });
}
if (mode !== 'local-demo') {
  if (process.env.CURVE_WEB_MAINTENANCE !== 'off') stopWebMaintenance = startWebMaintenance(db,{
    onResult:result => { if (result.failed) console.error(`Curve web history: ${result.failed} daily captures failed; existing snapshots preserved.`); },
    onError:() => console.error('Curve web history maintenance failed. Check database and Umami availability.'),
  });
  scheduleRetention();
  retentionTimer = setInterval(scheduleRetention, 60 * 60 * 1000);
  retentionTimer.unref();
}

for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
  clearInterval(retentionTimer);
  server.close(async () => {
    await stopWebMaintenance?.();
    await retentionRun;
    await close();
  });
});
