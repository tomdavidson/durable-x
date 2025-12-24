// src/checkpoint.ts

import type {
  Checkpoint,
  CheckpointStatus,
  CleanupAction,
  CleanupSpec,
  StepRecord,
  CacheCheck,
} from './types';

export const emptyCheckpoint = (fileId: string): Checkpoint => ({
  fileId,
  startedAt: Date.now(),
  completedAt: null,
  status: 'running',
  steps: {},
  cleanup: [],
});

export const checkCache = <T>(
  step: StepRecord | undefined,
  inputHash: string,
): CacheCheck<T> =>
  step?.inputHash === inputHash
    ? { hit: true, result: step.result as T }
    : { hit: false };

export const withStep = (
  cp: Checkpoint,
  name: string,
  result: unknown,
  inputHash: string,
): Checkpoint => ({
  ...cp,
  steps: {
    ...cp.steps,
    [name]: { result, inputHash, completedAt: Date.now() },
  },
});

export const withCleanup = (
  cp: Checkpoint,
  action: CleanupSpec,
): Checkpoint => ({
  ...cp,
  cleanup: [
    ...cp.cleanup,
    {
      ...action,
      id: `${action.type}-${crypto.randomUUID()}`,
      registeredAt: Date.now(),
    },
  ],
});

export const withoutCleanup = (cp: Checkpoint, type: string): Checkpoint => ({
  ...cp,
  cleanup: cp.cleanup.filter((c) => c.type !== type),
});

export const withStatus = (
  cp: Checkpoint,
  status: CheckpointStatus,
): Checkpoint => ({
  ...cp,
  status,
  completedAt: status === 'running' ? null : Date.now(),
});

export const withoutStep = (cp: Checkpoint, name: string): Checkpoint => {
  const { [name]: _removed, ...rest } = cp.steps;
  return { ...cp, steps: rest };
};

export const rowToCheckpoint = (row: Record<string, unknown>): Checkpoint => ({
  fileId: row.file_id as string,
  startedAt: row.started_at as number,
  completedAt: (row.completed_at as number | null) ?? null,
  status: row.status as CheckpointStatus,
  steps:
    typeof row.steps === 'string'
      ? JSON.parse(row.steps)
      : ((row.steps as Record<string, StepRecord> | undefined) ?? {}),
  cleanup:
    typeof row.cleanup === 'string'
      ? JSON.parse(row.cleanup)
      : ((row.cleanup as CleanupAction[] | undefined) ?? []),
});

export const checkpointToRow = (cp: Checkpoint) => ({
  file_id: cp.fileId,
  started_at: cp.startedAt,
  completed_at: cp.completedAt,
  status: cp.status,
  steps: JSON.stringify(cp.steps),
  cleanup: JSON.stringify(cp.cleanup),
});

