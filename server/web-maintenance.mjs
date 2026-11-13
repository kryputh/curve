import {captureWebDay,pruneWebRollups} from './web-rollups.mjs';
const running=new WeakSet();
const dayMs=86400000;
export async function runWebMaintenance(db,{now=Date.now(),maxDays=32,fetchDay}={}) {
  if(running.has(db)) return {status:'already-running',captured:0,failed:0};
  if(!Number.isInteger(maxDays)||maxDays<1||maxDays>1000) throw new Error('Invalid batch size');
  running.add(db);
  const result={status:'complete',captured:0,failed:0,attempted:0};
  try {
    const today=Math.floor(now/dayMs)*dayMs;
    const oldest=new Date(today); oldest.setUTCMonth(oldest.getUTCMonth()-24);
    const {rows:projects}=await db.query('SELECT id,umami_website_id,COALESCE(web_connected_at,created_at) AS created_at FROM projects WHERE NOT is_demo AND umami_website_id IS NOT NULL ORDER BY created_at,id');
    const tasks=[];
    for(const project of projects) {
      const start=Math.max(Math.floor(new Date(project.created_at).getTime()/dayMs)*dayMs,oldest.getTime());
      if(start>=today) continue;
      const {rows}=await db.query('SELECT day::text FROM web_daily WHERE project_id=$1 AND day >= $2::date AND visits IS NOT NULL AND bounces IS NOT NULL AND total_duration IS NOT NULL',[project.id,new Date(start).toISOString().slice(0,10)]);
      const captured=new Set(rows.map(r=>r.day));
      // Missing days take precedence; yesterday is refreshed once caught up.
      for(let ts=start;ts<today;ts+=dayMs) {
        const day=new Date(ts).toISOString().slice(0,10);
        if(!captured.has(day)||ts===today-dayMs) tasks.push({project,day,refresh:captured.has(day)});
      }
    }
    // Recent days first, interleaved across tenants so one failing backlog cannot
    // consume the entire batch. Rotate tenant order across hourly runs as well.
    const queues=projects.map(p=>tasks.filter(t=>t.project.id===p.id).sort((a,b)=>Number(a.refresh)-Number(b.refresh)||b.day.localeCompare(a.day))).filter(q=>q.length);
    const offset=queues.length?Math.floor(now/3600000)%queues.length:0;
    const ordered=queues.slice(offset).concat(queues.slice(0,offset));
    const batch=[];
    while(batch.length<maxDays&&ordered.some(q=>q.length)) {
      for(const queue of ordered) {if(queue.length&&batch.length<maxDays)batch.push(queue.shift());}
    }
    for(const task of batch) {
      result.attempted++;
      try {const outcome=await captureWebDay(db,task.project,task.day,{now,...(fetchDay?{fetchDay}:{})});if(outcome.status==='captured')result.captured++;else result.failed++;} catch {result.failed++;}
    }
    result.remaining=Math.max(0,tasks.length-result.attempted);
    await pruneWebRollups(db);
    return result;
  } finally {running.delete(db);}
}

export function startWebMaintenance(db,{intervalMs=3600000,onResult=()=>{},onError=()=>{},...options}={}) {
  if(!Number.isFinite(intervalMs)||intervalMs<1000) throw new Error('Invalid maintenance interval');
  let active=null, stopped=false;
  const run=()=>{
    if(stopped||active)return active;
    active=runWebMaintenance(db,options).then(onResult).catch(onError).finally(()=>{active=null;});
    return active;
  };
  void run();
  const timer=setInterval(run,intervalMs); timer.unref?.();
  return async ()=>{stopped=true;clearInterval(timer);await active;};
}
