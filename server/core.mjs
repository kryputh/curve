import { createHash } from 'node:crypto';

export function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function normalizePath(input) {
  if (typeof input !== 'string' || input.length > 2048) return '/:redacted';
  let path = input.split(/[?#]/)[0];
  if (!path.startsWith('/')) return '/:redacted';
  const normalized = path.split('/').filter(Boolean).map(part => {
    try { part = decodeURIComponent(part); } catch { return ':redacted'; }
    if (/^:[a-z_][a-z0-9_]*$/i.test(part) || /^\{[a-z_][a-z0-9_]*\}$/i.test(part)) return part;
    if (/^[GCM][A-Z2-7]{40,}$/.test(part)) return ':address';
    if (/^\d+$/.test(part)) return ':id';
    if (/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(part)) return ':id';
    if (/^(?:0x)?[a-f\d]{24,}$/i.test(part)) return ':hash';
    if (part.includes('@') || part.length > 48 || !/^[a-zA-Z][a-zA-Z_-]*$/.test(part)) return ':redacted';
    return part;
  }).join('/');
  return normalized.length > 1023 ? '/:redacted' : '/' + normalized;
}
export function attrs(list = []) {
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(list.slice(0,80).filter(x => x && typeof x.key === 'string').map(x => [x.key,x.value?.stringValue ?? x.value?.intValue ?? x.value?.doubleValue]));
}
export function statusDistribution(rows) {
  const counts = new Map();
  for (const row of rows) {
    // Older synthetic fixtures recorded errors separately from successful status.
    const syntheticErrors = row.source === 'synthetic' ? (row.errors ?? 0) : 0;
    counts.set(row.status, (counts.get(row.status) ?? 0) + row.count - syntheticErrors);
    if (syntheticErrors) counts.set(500, (counts.get(500) ?? 0) + syntheticErrors);
  }
  return [...counts].filter(([, count]) => count > 0)
    .sort(([a], [b]) => a - b)
    .map(([status, count]) => ({status, count}));
}

export function percentile(rows, fraction) {
  let shared;
  let total = 0;
  for (const row of rows) {
    if (row.count <= 0) continue;
    total += row.count;
    let cumulative = 0;
    const next = new Map();
    for (const {bound,count} of row.buckets ?? []) {
      if (bound === null) continue;
      cumulative += count;
      if (!shared || shared.has(bound)) next.set(bound, (shared?.get(bound) ?? 0) + cumulative);
    }
    if (!next.size) return null;
    shared = next;
  }
  if (!shared) return null;
  return [...shared.keys()].sort((a,b) => a-b)
    .find(bound => shared.get(bound) >= total*fraction) ?? null;
}

const METRICS = new Set(['http.server.request.duration','http.server.duration','http.client.duration','http.server.request.count','http.server.requests']);
function boundedList(value, limit, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Invalid ${field}: maximum ${limit} entries`);
  return value;
}

export function parseOtlp(body, projectId, now = Date.now()) {
  if (!body || !Array.isArray(body.resourceMetrics)) throw new Error('resourceMetrics array required');
  const records=[]; let rejected=0;
  for (const resource of boundedList(body.resourceMetrics,100,'resourceMetrics')) {
    const resourceAttrs = attrs(resource.resource?.attributes);
    if (resourceAttrs['tenant.id'] && resourceAttrs['tenant.id'] !== projectId) throw new Error('tenant.id must match API key project');
    for (const scope of boundedList(resource.scopeMetrics,100,'scopeMetrics')) for (const metric of boundedList(scope.metrics,100,'metrics')) {
      if(!METRICS.has(metric.name)) {
        const data = metric.gauge ?? metric.sum ?? metric.histogram ?? metric.exponentialHistogram ?? metric.summary;
        rejected += boundedList(data?.dataPoints,1000,'dataPoints').length;
        continue;
      }
      const type = metric.histogram ? 'histogram' : metric.sum ? 'sum' : null;
      if (!type) { rejected++; continue; }
      const payload=metric[type];
      // Delta only: accumulating cumulative counters would overcount usage.
      if (Number(payload.aggregationTemporality)!==1) throw new Error('Only DELTA aggregationTemporality (1) is supported');
      for(const point of boundedList(payload.dataPoints,1000,'dataPoints')) {
        const a = attrs(point.attributes);
        if(a['tenant.id'] && a['tenant.id']!==projectId) throw new Error('tenant.id must match API key project');
        const count=Number(type==='histogram'?point.count:(point.asInt??point.asDouble));
        const timestamp=Number(BigInt(point.timeUnixNano || '0')/1000000n);
        if(!Number.isSafeInteger(count)||count<0||count>1e7||!timestamp||timestamp>now+300000||timestamp<now-7*86400000) throw new Error('Invalid count or timestamp (maximum age 7 days)');
        const status=Number(a['http.response.status_code']??a['http.status_code']);
        if(!Number.isInteger(status)||status<100||status>599) throw new Error('Invalid HTTP status');
        const path=normalizePath(a['http.route']??a['url.path']??a['http.target']??'/:unknown');
        const service=typeof resourceAttrs['service.name']==='string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(resourceAttrs['service.name']) ? resourceAttrs['service.name'] : 'unnamed-service';
        const multiplier=metric.unit==='s'?1000:1;
        let buckets=[];
        if(type==='histogram') {
          const bounds=point.explicitBounds || [], counts=point.bucketCounts || [];
          if(bounds.length>100 || counts.length!==bounds.length+1 || !bounds.every((b,i)=>Number.isFinite(b*multiplier)&&b>=0&&(!i||b>bounds[i-1])) || !counts.every(b=>Number.isSafeInteger(Number(b))&&Number(b)>=0) || counts.reduce((s,b)=>s+Number(b),0)!==count) throw new Error('Invalid histogram buckets');
          buckets=counts.map((n,i)=>({bound:i<bounds.length?bounds[i]*multiplier:null,count:Number(n)}));
        }
        // Do not retain arbitrary attributes, exemplars, span IDs, IPs, URLs, or logs.
        const record={type:'api',path,status,count,errors:status>=400?count:0,timestamp:new Date(Math.min(timestamp,now)).toISOString(),source:'server',disposition:'accepted',service,buckets,duration:type==='histogram'?Number(point.sum||0)*multiplier/Math.max(count,1):0,metric:metric.name};
        if(!Number.isFinite(record.duration)||record.duration<0) throw new Error('Invalid duration');
        // Include instance/scope in the replay key, without storing either as a report dimension.
        const instance = resourceAttrs['service.instance.id'];
        record.id=digest({projectId,metric:metric.name,service,path,status,time:String(point.timeUnixNano),
          start:String(point.startTimeUnixNano||''),count,buckets,
          ...(instance !== undefined && {instance}),
          ...(scope.scope?.name && {scope:scope.scope.name,scopeVersion:scope.scope.version ?? ''}),
        });
        records.push(record);
        if(records.length>2000) throw new Error('Maximum 2000 data points per request');
      }
    }
  }
  // A request histogram already counts requests. Reject overlapping instruments,
  // rather than silently doubling the usage total from counter + histogram exports.
  const instruments=new Map();
  for(const record of records) {
    const seriesKey=`${record.service}|${record.path}|${record.status}`;
    const previous=instruments.get(seriesKey);
    if(previous && previous!==record.metric) throw new Error('Export exactly one HTTP request instrument per service/route/status: a histogram OR a counter, not both');
    instruments.set(seriesKey,record.metric);
  }
  return {records,rejected};
}
