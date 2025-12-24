// src/api.ts

import type { Checkpoint, CleanupRegistry, StorageAdapter } from './types';
import {
  emptyCheckpoint,
  checkCache,
  withStep,
  withCleanup,
  withoutCleanup,
  withStatus,
  withoutStep,
} from './checkpoint';
import { hash } from './hash';
import { executeAllCleanups } from './cleanup';
import {
  logHit,
  logMiss,
  logSave,
  logCleanupReg,
  logCleanupClear,
  logDone,
  logFailed,
  logRecovery,
} from './log';

export const load =
  (storage: StorageAdapter) =>
    (runners: CleanupRegistry) =>
      (fileId: string): Promise<Checkpoint> =>
        storage
          .fetchOne(fileId)
          .then((existing) => existing ?? emptyCheckpoint(fileId))
          .then((cp) => {
            if (cp.cleanup.length === 0) return cp;

            logRecovery(fileId, cp.cleanup.length)(cp);

            return executeAllCleanups(runners)(cp.cleanup).then(() => ({
              ...cp,
              cleanup: [],
              startedAt: Date.now(),
              status: 'running' as const,
            }));
          })
          .then(storage.upsert);

export const beforeRisky =
  (storage: StorageAdapter) =>
    (cp: Checkpoint) =>
      (type: string) =>
        (params: Record<string, unknown>): Promise<Checkpoint> =>
          Promise.resolve(withCleanup(cp, { type, params }))
            .then(storage.upsert)
            .then((updated) => {
              logCleanupReg(type)(updated);
              Object.assign(cp, updated);
              return updated;
            });

export const afterSafe =
  (storage: StorageAdapter) =>
    (cp: Checkpoint) =>
      (type: string): Promise<Checkpoint> =>
        Promise.resolve(withoutCleanup(cp, type))
          .then(storage.upsert)
          .then((updated) => {
            logCleanupClear(type)(updated);
            Object.assign(cp, updated);
            return updated;
          });

export const durable =
  (storage: StorageAdapter) =>
    (cp: Checkpoint) =>
      (name: string) =>
        <I, T>(inputs: I) =>
          (fn: () => Promise<T>): Promise<T> => {
            const h = hash(inputs);
            const cached = checkCache<T>(cp.steps[name], h);

            if (cached.hit) {
              logHit(name, h)(cached.result);
              return Promise.resolve(cached.result);
            }

            logMiss(name, h)(undefined);
            return fn()
              .then((result) => withStep(cp, name, result, h))
              .then(storage.upsert)
              .then((updated) => {
                logSave(name)(updated);
                Object.assign(cp, updated);
                return updated.steps[name].result as T;
              });
          };

export const complete =
  (storage: StorageAdapter) =>
    (cp: Checkpoint): Promise<Checkpoint> =>
      Promise.resolve(withStatus(cp, 'completed'))
        .then(storage.upsert)
        .then((updated) => {
          logDone(cp.fileId)(updated);
          return updated;
        });

export const fail =
  (storage: StorageAdapter) =>
    (cp: Checkpoint): Promise<Checkpoint> =>
      Promise.resolve(withStatus(cp, 'failed'))
        .then(storage.upsert)
        .then((updated) => {
          logFailed(cp.fileId)(updated);
          return updated;
        });

export const clear =
  (storage: StorageAdapter) =>
    (fileId: string): Promise<void> =>
      storage.deleteOne(fileId);

export const clearStep =
  (storage: StorageAdapter) =>
    (cp: Checkpoint) =>
      (name: string): Promise<Checkpoint> =>
        Promise.resolve(withoutStep(cp, name))
          .then(storage.upsert)
          .then((updated) => {
            Object.assign(cp, updated);
            return updated;
          });

export const sweep =
  (storage: StorageAdapter) =>
    (runners: CleanupRegistry) =>
      (
        staleThresholdMs: number = 60 * 60 * 1000,
      ): Promise<{ cleaned: number; details: string[] }> =>
        storage.fetchStale(staleThresholdMs).then((stale) =>
          Promise.all(
            stale.map((cp) =>
              executeAllCleanups(runners)(cp.cleanup)
                .then(() => withStatus({ ...cp, cleanup: [] }, 'failed'))
                .then(storage.upsert)
                .then(() => cp.fileId),
            ),
          ).then((fileIds) => ({ cleaned: fileIds.length, details: fileIds })),
        );

export const sweepAllCleanups =
  (storage: StorageAdapter) =>
    (runners: CleanupRegistry) =>
      (): Promise<{ cleaned: number }> =>
        storage.fetchPendingCleanups().then((cps) =>
          Promise.all(
            cps.map((cp) =>
              executeAllCleanups(runners)(cp.cleanup).then(() =>
                storage.upsert({ ...cp, cleanup: [] }),
              ),
            ),
          ).then((results) => ({ cleaned: results.length })),
        );
