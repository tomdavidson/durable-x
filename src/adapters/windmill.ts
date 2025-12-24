// src/adapters/windmill.ts

import * as wmill from 'windmill-client';
import type { Checkpoint, StorageAdapter } from '../types';

const TABLE = 'checkpoints.runs';

const SETUP_SQL = `
  CREATE SCHEMA IF NOT EXISTS checkpoints;

  CREATE TABLE IF NOT EXISTS checkpoints.runs (
    file_id TEXT PRIMARY KEY,
    started_at BIGINT NOT NULL,
    completed_at BIGINT,
    status TEXT NOT NULL DEFAULT 'running',
    steps JSONB NOT NULL DEFAULT '{}',
    cleanup JSONB NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_runs_status 
    ON checkpoints.runs (status);

  CREATE INDEX IF NOT EXISTS idx_runs_stale 
    ON checkpoints.runs (started_at) 
    WHERE status = 'running';
`;

const getSql = (() => {
  let ready: Promise<ReturnType<typeof wmill.datatable>> | null = null;

  return async () => {
    if (ready) return ready;

    ready = (async () => {
      try {
        return wmill.datatable();
      } catch (err: unknown) {
        console.warn(
          `datatable() failed, running auto-setup for ${TABLE}...`,
          err,
        );

        // Run setup inline
        const sql = wmill.datatable();
        await sql`${SETUP_SQL}`.fetch();

        console.log(`✓ Auto-setup complete for ${TABLE}`);

        return wmill.datatable();
      }
    })();

    return ready;
  };
})();

const rowToCheckpoint = (row: any): Checkpoint => ({
  fileId: row.file_id,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  status: row.status,
  steps: row.steps,
  cleanup: row.cleanup,
});

const checkpointToRow = (cp: Checkpoint) => ({
  file_id: cp.fileId,
  started_at: cp.startedAt,
  completed_at: cp.completedAt,
  status: cp.status,
  steps: cp.steps,
  cleanup: cp.cleanup,
});

export const windmillStorage: StorageAdapter = {
  fetchOne: async (fileId: string): Promise<Checkpoint | null> => {
    try {
      const sql = await getSql();
      const row = await sql`SELECT * FROM checkpoints.runs WHERE file_id = ${fileId}`.fetchOne();
      return row ? rowToCheckpoint(row) : null;
    } catch {
      return null;
    }
  },

  upsert: async (cp: Checkpoint): Promise<Checkpoint> => {
    const sql = await getSql();
    const row = checkpointToRow(cp);

    await sql`
      INSERT INTO checkpoints.runs (file_id, started_at, completed_at, status, steps, cleanup)
      VALUES (${row.file_id}, ${row.started_at}, ${row.completed_at}, ${row.status}, ${row.steps}, ${row.cleanup})
      ON CONFLICT (file_id) DO UPDATE SET
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        status = EXCLUDED.status,
        steps = EXCLUDED.steps,
        cleanup = EXCLUDED.cleanup
    `.fetch();

    return cp;
  },

  deleteOne: async (fileId: string): Promise<void> => {
    const sql = await getSql();
    await sql`DELETE FROM checkpoints.runs WHERE file_id = ${fileId}`.fetch();
  },

  fetchStale: async (thresholdMs: number): Promise<Checkpoint[]> => {
    const sql = await getSql();
    const rows = await sql`
      SELECT * FROM checkpoints.runs
      WHERE status = 'running'
        AND started_at < ${Date.now() - thresholdMs}
    `.fetch();

    return rows.map(rowToCheckpoint);
  },

  fetchPendingCleanups: async (): Promise<Checkpoint[]> => {
    const sql = await getSql();
    const rows = await sql`
      SELECT * FROM checkpoints.runs
      WHERE json_array_length(cleanup::json) > 0
    `.fetch();

    return rows.map(rowToCheckpoint);
  },
};
