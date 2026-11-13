// The source must be a fixed SQL fragment returning project_id, ts and data.
// Ingestion supplies only rows inserted by this transaction. Backfill uses retained API records.
export function rollupSql(source) {
  return `
    WITH accepted AS (${source}),
    observations AS (
      SELECT project_id, (ts AT TIME ZONE 'UTC')::date AS day,
        data->>'path' AS path, (data->>'status')::int AS status,
        (data->>'count')::bigint AS requests, ts, histogram.bounds, histogram.counts
      FROM accepted
      CROSS JOIN LATERAL (
        SELECT COALESCE(array_agg((bucket->>'bound')::float8 ORDER BY ordinal), ARRAY[]::float8[]) AS bounds,
          COALESCE(array_agg((bucket->>'count')::bigint ORDER BY ordinal), ARRAY[]::bigint[]) AS counts
        FROM jsonb_array_elements(data->'buckets') WITH ORDINALITY AS buckets(bucket,ordinal)
      ) AS histogram
    ),
    by_bucket AS (
      SELECT project_id,day,path,status,bounds,ordinal,
        sum(requests)::bigint AS requests, max(ts) AS last_at, sum(bucket_count)::bigint AS bucket_count
      FROM observations
      LEFT JOIN LATERAL unnest(counts) WITH ORDINALITY AS buckets(bucket_count,ordinal) ON true
      GROUP BY project_id,day,path,status,bounds,ordinal
    ),
    daily AS (
      SELECT project_id,day,path,status,bounds,max(requests) AS requests,max(last_at) AS last_at,
        COALESCE(array_agg(bucket_count ORDER BY ordinal) FILTER (WHERE ordinal IS NOT NULL), ARRAY[]::bigint[]) AS counts
      FROM by_bucket
      GROUP BY project_id,day,path,status,bounds
    ),
    updated AS (
      INSERT INTO api_daily(project_id,day,path,status,layout,bounds,counts,requests,last_at)
      SELECT project_id,day,path,status,encode(sha256(convert_to(to_jsonb(bounds)::text,'UTF8')),'hex'),
        bounds,counts,requests,last_at
      FROM daily
      ON CONFLICT(project_id,day,path,status,layout) DO UPDATE SET
        requests = api_daily.requests + EXCLUDED.requests,
        last_at = greatest(api_daily.last_at, EXCLUDED.last_at),
        counts = ARRAY(
          SELECT api_daily.counts[i] + EXCLUDED.counts[i]
          FROM generate_subscripts(api_daily.counts, 1) AS slots(i) ORDER BY i
        )
      RETURNING project_id
    )
    SELECT (SELECT count(*) FROM accepted) AS accepted, (SELECT count(*) FROM updated) AS updated
  `;
}

export async function initializeRollups(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_daily (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      day DATE NOT NULL, path TEXT NOT NULL, status INT NOT NULL,
      layout TEXT NOT NULL, bounds DOUBLE PRECISION[] NOT NULL, counts BIGINT[] NOT NULL,
      requests BIGINT NOT NULL, last_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(project_id,day,path,status,layout)
    );
    CREATE INDEX IF NOT EXISTS api_daily_day ON api_daily(day);
    CREATE INDEX IF NOT EXISTS records_ts ON records(ts);
    CREATE TABLE IF NOT EXISTS data_migrations (name TEXT PRIMARY KEY);
  `);
  await db.transaction(async tx => {
    const migration = await tx.query(
      "INSERT INTO data_migrations(name) VALUES ('api_daily_v1') ON CONFLICT DO NOTHING RETURNING name",
    );
    if (!migration.rows.length) return;
    await tx.query(rollupSql(`
      SELECT records.project_id, ts, data FROM records JOIN projects ON projects.id=records.project_id
      WHERE NOT projects.is_demo AND data->>'type'='api'
        AND ts >= ((now() AT TIME ZONE 'UTC')::date - INTERVAL '24 months') AT TIME ZONE 'UTC'
    `));
  });
}

export async function readDailyApi(db, projectId, startDay, endDay) {
  const {rows} = await db.query(`
    SELECT day::text, path, status, bounds, counts, requests, last_at
    FROM api_daily WHERE project_id=$1 AND day BETWEEN $2::date AND $3::date
    ORDER BY day
  `, [projectId, startDay, endDay]);
  return rows.map(row => ({
    day: row.day,
    path: row.path,
    status: row.status,
    count: Number(row.requests),
    errors: row.status >= 400 ? Number(row.requests) : 0,
    timestamp: new Date(row.last_at).toISOString(),
    buckets: row.bounds.map((bound, index) => ({bound, count:Number(row.counts[index])})),
  }));
}

// Raw records also serve as replay keys. Keep them longer than OTLP's seven-day admission window.
export async function expireMetrics(db, now = new Date()) {
  return db.transaction(async tx => {
    const timestamp = now.toISOString();
    const raw = await tx.query(`
      DELETE FROM records USING projects
      WHERE projects.id=records.project_id AND NOT projects.is_demo AND records.data->>'type'='api'
        AND ts < $1::timestamptz - INTERVAL '192 hours'
    `, [timestamp]);
    const daily = await tx.query(`
      DELETE FROM api_daily WHERE day < ($1::timestamptz AT TIME ZONE 'UTC')::date - INTERVAL '24 months'
    `, [timestamp]);
    await tx.query(`
      DELETE FROM web_quality WHERE day < ($1::timestamptz AT TIME ZONE 'UTC')::date - INTERVAL '24 months'
    `, [timestamp]);
    return {raw:raw.rowCount ?? raw.affectedRows, daily:daily.rowCount ?? daily.affectedRows};
  });
}
