// src/adapters/windmill.ts

import * as wmill from 'windmill-client';
import { ResultAsync, okAsync, errAsync } from 'neverthrow';
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

// Track if we've already run setup in this script execution
const setupState = {
  hasRun: false,
};

// WHY: Database throws errors when table doesn't exist
// This function detects those errors in a database-agnostic way
// Database-agnostic check for "table/relation doesn't exist"
const isTableMissingError = (err: unknown): boolean => {
  const msg = String(err).toLowerCase();
  return (
    // PostgreSQL/SQLite patterns
    ((msg.includes('table') || msg.includes('relation')) && msg.includes('does not exist')) ||
    // MySQL pattern
    (msg.includes('table') && msg.includes("doesn't exist")) ||
    // DuckDB pattern
    (msg.includes('catalog') && msg.includes('does not exist')) ||
    // MS SQL pattern
    msg.includes('invalid object name') ||
    // PostgreSQL error code
    msg.includes('42p01') ||
    // Generic "not found" patterns
    ((msg.includes('table') || msg.includes('relation')) && msg.includes('not found'))
  );
};


// WHY: Setup should only run once per script execution
// The SQL is idempotent (CREATE IF NOT EXISTS), but we avoid
// the round-trip cost on subsequent operations
const runSetup = (): ResultAsync<void, Error> => {
  // Already ran setup? Skip it
  if (setupState.hasRun) {
    return okAsync(undefined);
  }

  // WHY: We use ResultAsync.fromPromise because wmill.datatable()
  // returns a Promise that can reject (throw an error)
  return ResultAsync.fromPromise(
    wmill
      .datatable()`${SETUP_SQL}`  // ← Returns Promise
      .fetch()                      // ← Actually executes the query
      .then(() => {
        setupState.hasRun = true;
        console.log(`✓ Checkpoint schema initialized`);
      }),
    // WHY: If setup fails, we need to capture it as an Error
    // This transforms a rejected Promise into errAsync(Error)
    (e: unknown) => new Error(`Setup failed: ${String(e)}`)
  );
};

// WHY: This is the lazy-load pattern you wanted
// 1. Try the operation first (no overhead if table exists)
// 2. If it fails with "table missing" error, run setup
// 3. Retry the operation once
// 4. If still fails, propagate the error
const withAutoSetup = <T>(
  operation: () => Promise<T>  // ← The actual DB operation (INSERT, SELECT, etc)
): ResultAsync<T, Error> =>
  // WHY: Wrap the Promise in ResultAsync so we can use .orElse
  // .orElse is like .catch but for ResultAsync - it lets us recover from errors
  ResultAsync.fromPromise(
    operation(),  // ← Try the operation first
    (e: unknown) => e as Error
  ).orElse(
    (err) => {
      // WHY: Check if the error is "table doesn't exist"
      // If so, this is our signal to run setup
      if (isTableMissingError(err)) {
        console.log(`Table missing, running setup...`);

        // WHY: Run setup, then retry the operation
        // .andThen chains: only runs if setup succeeds
        return runSetup().andThen(() =>
          ResultAsync.fromPromise(
            operation(),  // ← Retry the same operation
            (e: unknown) => new Error(`Retry after setup failed: ${String(e)}`)
          )
        );
      }

      // WHY: If error wasn't "table missing", it's a real error
      // (network issue, invalid SQL, etc) - propagate it
      return errAsync(err);
    }
  );

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
  // WHY: fetchOne returns null on error (not found is normal)
  fetchOne: (fileId: string): Promise<Checkpoint | null> =>
    withAutoSetup(() =>
      wmill
        .datatable()`SELECT * FROM checkpoints.runs WHERE file_id = ${fileId}`
        .fetchOne()  // ← Returns Promise<row | null>
    )
      .map((row: any) => (row ? rowToCheckpoint(row) : null))
      .match(
        // WHY: On success, return the checkpoint (or null)
        (checkpoint) => checkpoint,
        // WHY: On error, log but return null (not found is OK)
        (err) => {
          console.error(`fetchOne error:`, err);
          return null;
        }
    ),

  // WHY: upsert throws on error (mutations should fail loudly)
  // If we can't save a checkpoint, the whole operation should fail
  upsert: (cp: Checkpoint): Promise<Checkpoint> =>
    withAutoSetup(() => {
      const row = checkpointToRow(cp);
      return wmill
        .datatable()`
          INSERT INTO checkpoints.runs (file_id, started_at, completed_at, status, steps, cleanup)
          VALUES (${row.file_id}, ${row.started_at}, ${row.completed_at}, ${row.status}, ${row.steps}, ${row.cleanup})
          ON CONFLICT (file_id) DO UPDATE SET
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at,
            status = EXCLUDED.status,
            steps = EXCLUDED.steps,
            cleanup = EXCLUDED.cleanup
        `
        .fetch();  // ← Returns Promise<void>
    })
      .map(() => cp)
      .match(
        // WHY: On success, return the checkpoint
        (checkpoint) => checkpoint,
        // WHY: On error, throw - caller needs to know upsert failed
        // This prevents silent failures where we think we saved but didn't
        (err) => {
          throw err;
        }
      ),

  // WHY: deleteOne throws on error (mutations should fail loudly)
  deleteOne: (fileId: string): Promise<void> =>
    withAutoSetup(() =>
      wmill
        .datatable()`DELETE FROM checkpoints.runs WHERE file_id = ${fileId}`
        .fetch()  // ← Returns Promise<void>
    )
      .map(() => undefined)
      .match(
        () => undefined,
        // WHY: Throw on error - caller needs to know delete failed
        (err) => {
          throw err;
        }
      ),

  // WHY: fetchStale returns empty array on error (query failures are tolerable)
  fetchStale: (thresholdMs: number): Promise<Checkpoint[]> =>
    withAutoSetup(() =>
      wmill
        .datatable()`
          SELECT * FROM checkpoints.runs
          WHERE status = 'running'
            AND started_at < ${Date.now() - thresholdMs}
        `
        .fetch()  // ← Returns Promise<rows[]>
    )
      .map((rows: any[]) => rows.map(rowToCheckpoint))
      .match(
        (checkpoints) => checkpoints,
        // WHY: Log but return empty - cleanup can continue with what we have
        (err) => {
          console.error(`fetchStale error:`, err);
          return [];
        }
      ),

  // WHY: fetchPendingCleanups returns empty array on error (query failures are tolerable)
  fetchPendingCleanups: (): Promise<Checkpoint[]> =>
    withAutoSetup(() =>
      wmill
        .datatable()`
          SELECT * FROM checkpoints.runs
          WHERE json_array_length(cleanup::json) > 0
        `
        .fetch()  // ← Returns Promise<rows[]>
    )
      .map((rows: any[]) => rows.map(rowToCheckpoint))
      .match(
        (checkpoints) => checkpoints,
        // WHY: Log but return empty - cleanup can continue with what we have
        (err) => {
          console.error(`fetchPendingCleanups error:`, err);
          return [];
        }
      ),
};
