import { fetchUmami } from './umami.mjs';

function dayValue(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day).toISOString().slice(0,10) !== day) throw new Error('Invalid UTC day');
  return Date.parse(day);
}

export async function initializeWebRollups(db) {
  await db.exec('ALTER TABLE projects ADD COLUMN IF NOT EXISTS web_connected_at TIMESTAMPTZ');
  await db.exec(`CREATE TABLE IF NOT EXISTS web_daily (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day DATE NOT NULL, pageviews BIGINT NOT NULL CHECK(pageviews>=0),
    visitors BIGINT NOT NULL CHECK(visitors>=0), visits BIGINT, bounces BIGINT, total_duration DOUBLE PRECISION, captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(project_id,day)
  ); CREATE INDEX IF NOT EXISTS web_daily_day ON web_daily(day);
  ALTER TABLE web_daily ADD COLUMN IF NOT EXISTS visits BIGINT;
  ALTER TABLE web_daily ADD COLUMN IF NOT EXISTS bounces BIGINT;
  ALTER TABLE web_daily ADD COLUMN IF NOT EXISTS total_duration DOUBLE PRECISION;`);
}

// Fetch only completed days. Successful recapture replaces, never adds counts.
// Deliberately stores no paths, identities, URLs, or truncated top-N dimensions.
export async function captureWebDay(db, project, day, {fetchDay=fetchUmami, now=Date.now()}={}) {
  const start = dayValue(day);
  if (start + 86400000 > now) throw new Error('Day is not complete');
  if (project.is_demo || !project.umami_website_id) return {status:'not-configured'};
  const result = await fetchDay(project.umami_website_id, new Date(start).toISOString(), new Date(start+86400000-1).toISOString());
  if (result.status !== 'connected' || !result.data) return {status:result.status};
  const {pageviews,visitors,visits,bounces,totalDuration} = result.data;
  if (![pageviews,visitors,visits,bounces].every(v=>Number.isSafeInteger(v)&&v>=0) || !Number.isFinite(totalDuration) || totalDuration<0 || bounces>visits) throw new Error('Invalid daily counts');
  await db.query(`INSERT INTO web_daily(project_id,day,pageviews,visitors,visits,bounces,total_duration) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(project_id,day) DO UPDATE SET pageviews=EXCLUDED.pageviews,visitors=EXCLUDED.visitors,visits=EXCLUDED.visits,bounces=EXCLUDED.bounces,total_duration=EXCLUDED.total_duration,captured_at=now()`,[project.id,day,pageviews,visitors,visits,bounces,totalDuration]);
  return {status:'captured',day};
}

export async function readDailyWeb(db, projectId, startDay, endDay) {
  const start=dayValue(startDay), end=dayValue(endDay);
  if (end<start || end-start>732*86400000) throw new Error('Invalid reporting range');
  const {rows}=await db.query('SELECT day::text,pageviews,visitors,visits,bounces,total_duration,captured_at FROM web_daily WHERE project_id=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day',[projectId,startDay,endDay]);
  const series=rows.map(r=>({date:r.day,pageviews:Number(r.pageviews),dailyVisitors:Number(r.visitors),visits:r.visits===null?null:Number(r.visits),bounces:r.bounces===null?null:Number(r.bounces),totalDuration:r.total_duration===null?null:Number(r.total_duration),capturedAt:new Date(r.captured_at).toISOString()}));
  const available=new Set(series.map(r=>r.date));
  const missingDays=[];
  for(let t=start;t<=end;t+=86400000) {const day=new Date(t).toISOString().slice(0,10);if(!available.has(day)) missingDays.push(day);}
  const additiveComplete=series.every(r=>r.visits!==null&&r.bounces!==null&&r.totalDuration!==null);
  const visits=additiveComplete?series.reduce((n,r)=>n+r.visits,0):null;
  const bounces=additiveComplete?series.reduce((n,r)=>n+r.bounces,0):null;
  const totalDuration=additiveComplete?series.reduce((n,r)=>n+r.totalDuration,0):null;
  return {status:missingDays.length?'incomplete':'complete',series,missingDays,pageviews:series.reduce((n,r)=>n+r.pageviews,0),visitorDays:series.reduce((n,r)=>n+r.dailyVisitors,0),uniqueVisitors:null,visits,bounces,totalDuration,bounceRate:visits?bounces/visits*100:null,avgDuration:visits?totalDuration/visits:null};
}

export async function pruneWebRollups(db) {
  await db.query("DELETE FROM web_daily WHERE day < (now() AT TIME ZONE 'UTC')::date - INTERVAL '24 months'");
}
