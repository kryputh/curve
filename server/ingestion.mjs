import { rollupSql } from './rollups.mjs';

export class InstrumentConflict extends Error {}

export async function storeMetrics(db, project, parsed) {
  const records = JSON.stringify(parsed.records);
  return db.transaction(async tx => {
    // Serialize writes for this project, including key rotation and deletion.
    const {rows:[current]} = await tx.query(
      'SELECT key_hash FROM projects WHERE id=$1 FOR UPDATE', [project.id],
    );
    if (!current || current.key_hash !== project.key_hash) return null;

    const conflict = await tx.query(`
      SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS incoming(service text, path text, status int, metric text)
      JOIN instruments AS known ON known.project_id=$1 AND known.service=incoming.service
        AND known.path=incoming.path AND known.status=incoming.status
      WHERE known.metric <> incoming.metric LIMIT 1
    `, [project.id, records]);
    if (conflict.rows.length) throw new InstrumentConflict();

    await tx.query(`
      INSERT INTO instruments(project_id,service,path,status,metric)
      SELECT DISTINCT $1,service,path,status,metric
      FROM jsonb_to_recordset($2::jsonb) AS incoming(service text,path text,status int,metric text)
      ON CONFLICT DO NOTHING
    `, [project.id, records]);

    const {rows:[summary]} = await tx.query(rollupSql(`
      INSERT INTO records(id,project_id,ts,data)
      SELECT point->>'id',$1,(point->>'timestamp')::timestamptz,point
      FROM jsonb_array_elements($2::jsonb) AS input(point)
      ON CONFLICT DO NOTHING RETURNING project_id, ts, data
    `), [project.id, records]);
    const accepted = Number(summary.accepted);
    const duplicate = parsed.records.length - accepted;
    if (duplicate || parsed.rejected) {
      await tx.query(`
        INSERT INTO quality(project_id,duplicates,rejected) VALUES($1,$2,$3)
        ON CONFLICT(project_id) DO UPDATE SET duplicates=quality.duplicates+EXCLUDED.duplicates,
          rejected=quality.rejected+EXCLUDED.rejected
      `, [project.id, duplicate, parsed.rejected]);
    }
    return {accepted, duplicate};
  });
}
