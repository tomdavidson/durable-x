// src/api.spec.ts

import { test, expect, describe, beforeEach } from 'bun:test';
import {
    load,
    beforeRisky,
    afterSafe,
    durable,
    complete,
    fail,
    clear,
    clearStep,
    sweep,
    sweepAllCleanups,
} from './api';
import type { Checkpoint, StorageAdapter, CleanupRegistry } from './types';

// Mock storage adapter (plain object with arrow functions)
const createMockStorage = (): StorageAdapter & { reset: () => void } => {
    const store = new Map<string, Checkpoint>();

    return {
        fetchOne: async (fileId: string): Promise<Checkpoint | null> => {
            return store.get(fileId) ?? null;
        },

        upsert: async (cp: Checkpoint): Promise<Checkpoint> => {
            store.set(cp.fileId, cp);
            return cp;
        },

        deleteOne: async (fileId: string): Promise<void> => {
            store.delete(fileId);
        },

        fetchStale: async (thresholdMs: number): Promise<Checkpoint[]> => {
            const cutoff = Date.now() - thresholdMs;
            return Array.from(store.values()).filter(
                (cp) => cp.status === 'running' && cp.startedAt < cutoff,
            );
        },

        fetchPendingCleanups: async (): Promise<Checkpoint[]> => {
            return Array.from(store.values()).filter(
                (cp) => cp.cleanup.length > 0,
            );
        },

        reset: () => {
            store.clear();
        },
    };
};

describe('load', () => {
    let storage: ReturnType<typeof createMockStorage>;
    const runners: CleanupRegistry = {};

    beforeEach(() => {
        storage = createMockStorage();
    });

    test('creates new checkpoint if none exists', async () => {
        const cp = await load(storage)(runners)('file-123');

        expect(cp.fileId).toBe('file-123');
        expect(cp.status).toBe('running');
        expect(cp.cleanup).toEqual([]);
    });

    test('loads existing checkpoint', async () => {
        const existing: Checkpoint = {
            fileId: 'file-123',
            startedAt: 1000,
            completedAt: null,
            status: 'running',
            steps: { step1: { result: 'data', inputHash: 'hash', completedAt: 2000 } },
            cleanup: [],
        };
        await storage.upsert(existing);

        const cp = await load(storage)(runners)('file-123');

        expect(cp.fileId).toBe('file-123');
        expect(cp.steps.step1).toBeDefined();
    });

    test('executes pending cleanups on load', async () => {
        let cleanupRan = false;
        const runners: CleanupRegistry = {
            delete_temp: async () => {
                cleanupRan = true;
            },
        };

        const existing: Checkpoint = {
            fileId: 'file-123',
            startedAt: 1000,
            completedAt: null,
            status: 'running',
            steps: {},
            cleanup: [
                {
                    id: '1',
                    type: 'delete_temp',
                    params: { path: '/tmp' },
                    registeredAt: 1000,
                },
            ],
        };
        await storage.upsert(existing);

        const cp = await load(storage)(runners)('file-123');

        expect(cleanupRan).toBe(true);
        expect(cp.cleanup).toEqual([]);
        expect(cp.status).toBe('running');
    });
});

describe('durable', () => {
    let storage: ReturnType<typeof createMockStorage>;
    let cp: Checkpoint;

    beforeEach(async () => {
        storage = createMockStorage();
        cp = await load(storage)({})('file-123');
    });

    test('executes function and caches result', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            return 'result';
        };

        const step = durable(storage)(cp)('step1');
        const result1 = await step({ input: 'test' })(fn);
        const result2 = await step({ input: 'test' })(fn);

        expect(result1).toBe('result');
        expect(result2).toBe('result');
        expect(callCount).toBe(1); // Function only called once
    });

    test('re-executes if input changes', async () => {
        let callCount = 0;
        const fn = async () => {
            callCount++;
            return `result-${callCount}`;
        };

        const step = durable(storage)(cp)('step1');
        const result1 = await step({ input: 'test1' })(fn);
        const result2 = await step({ input: 'test2' })(fn);

        expect(result1).toBe('result-1');
        expect(result2).toBe('result-2');
        expect(callCount).toBe(2);
    });

    test('skips execution on cache hit', async () => {
        const step = durable(storage)(cp)('step1');
        await step({ input: 'test' })(() => Promise.resolve('cached'));

        // Reload checkpoint to simulate crash recovery
        const reloaded = await load(storage)({})('file-123');
        const step2 = durable(storage)(reloaded)('step1');

        let executed = false;
        const result = await step2({ input: 'test' })(async () => {
            executed = true;
            return 'new';
        });

        expect(result).toBe('cached');
        expect(executed).toBe(false);
    });
})