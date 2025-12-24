// src/types.ts

export type StepRecord = {
  result: unknown;
  inputHash: string;
  completedAt: number;
};

export type CleanupAction = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  registeredAt: number;
};

export type CheckpointStatus = 'running' | 'completed' | 'failed';

export type Checkpoint = {
  fileId: string;
  startedAt: number;
  completedAt: number | null;
  status: CheckpointStatus;
  steps: Record<string, StepRecord>;
  cleanup: CleanupAction[];
};

export type CleanupRunner = (
  params: Record<string, unknown>,
) => Promise<void>;

export type CleanupRegistry = Record<string, CleanupRunner>;

export type CacheHit<T> = { hit: true; result: T };
export type CacheMiss = { hit: false };
export type CacheCheck<T> = CacheHit<T> | CacheMiss;

export type CleanupSpec = {
  type: string;
  params: Record<string, unknown>;
};

export type StorageAdapter = {
  fetchOne: (fileId: string) => Promise<Checkpoint | null>;
  upsert: (cp: Checkpoint) => Promise<Checkpoint>;
  deleteOne: (fileId: string) => Promise<void>;
  fetchStale: (thresholdMs: number) => Promise<Checkpoint[]>;
  fetchPendingCleanups: () => Promise<Checkpoint[]>;
};
