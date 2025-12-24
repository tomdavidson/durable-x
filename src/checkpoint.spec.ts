import { test, expect, describe } from 'bun:test';
import { emptyCheckpoint, withStep, withCleanup, withoutCleanup, withStatus, rowToCheckpoint, withoutStep, checkpointToRow } from './checkpoint'

describe('emptyCheckpoint', () => {
    test('creates checkpoint with running status', () => {
        const cp = emptyCheckpoint('file-123');
        expect(cp.fileId).toBe('file-123');
        expect(cp.status).toBe('running');
        expect(cp.steps).toEqual({});
        expect(cp.cleanup).toEqual([]);
        expect(cp.completedAt).toBeNull();
    });

    test('sets startedAt to current time', () => {
        const before = Date.now();
        const cp = emptyCheckpoint('file-123');
        const after = Date.now();
        expect(cp.startedAt).toBeGreaterThanOrEqual(before);
        expect(cp.startedAt).toBeLessThanOrEqual(after);
    });
});

describe('withStep', () => {
    test('adds step to checkpoint', () => {
        const cp = emptyCheckpoint('file-123');
        const updated = withStep(cp, 'step1', { data: 'result' }, 'hash123');

        expect(updated.steps['step1']).toBeDefined();
        expect(updated.steps['step1'].result).toEqual({ data: 'result' });
        expect(updated.steps['step1'].inputHash).toBe('hash123');
    });

    test('does not mutate original checkpoint', () => {
        const cp = emptyCheckpoint('file-123');
        const updated = withStep(cp, 'step1', 'result', 'hash123');

        expect(cp.steps).toEqual({});
        expect(updated.steps['step1']).toBeDefined();
    });
});

describe('withCleanup', () => {
    test('adds cleanup action to checkpoint', () => {
        const cp = emptyCheckpoint('file-123');
        const updated = withCleanup(cp, { type: 'delete_temp', params: { path: '/tmp/file' } });

        expect(updated.cleanup).toHaveLength(1);
        expect(updated.cleanup[0].type).toBe('delete_temp');
        expect(updated.cleanup[0].params).toEqual({ path: '/tmp/file' });
    });

    test('generates unique cleanup IDs', () => {
        const cp = emptyCheckpoint('file-123');
        const updated1 = withCleanup(cp, { type: 'delete', params: {} });
        const updated2 = withCleanup(updated1, { type: 'delete', params: {} });

        expect(updated2.cleanup[0].id).not.toBe(updated2.cleanup[1].id);
    });
});

describe('withoutCleanup', () => {
    test('removes cleanup actions of given type', () => {
        let cp = emptyCheckpoint('file-123');
        cp = withCleanup(cp, { type: 'delete_temp', params: {} });
        cp = withCleanup(cp, { type: 'rollback', params: {} });

        const updated = withoutCleanup(cp, 'delete_temp');
        expect(updated.cleanup).toHaveLength(1);
        expect(updated.cleanup[0].type).toBe('rollback');
    });
});

describe('withStatus', () => {
    test('marks as completed with timestamp', () => {
        const cp = emptyCheckpoint('file-123');
        const completed = withStatus(cp, 'completed');

        expect(completed.status).toBe('completed');
        expect(completed.completedAt).toBeGreaterThan(0);
    });

    test('clears completedAt when status is running', () => {
        let cp = emptyCheckpoint('file-123');
        cp = withStatus(cp, 'completed');
        const reverted = withStatus(cp, 'running');

        expect(reverted.status).toBe('running');
        expect(reverted.completedAt).toBeNull();
    });
});

describe('withoutStep', () => {
    test('removes step from checkpoint', () => {
        let cp = emptyCheckpoint('file-123');
        cp = withStep(cp, 'step1', 'result1', 'hash1');
        cp = withStep(cp, 'step2', 'result2', 'hash2');

        const updated = withoutStep(cp, 'step1');
        expect(updated.steps['step1']).toBeUndefined();
        expect(updated.steps['step2']).toBeDefined();
    });
});

describe('checkpointToRow / rowToCheckpoint', () => {
    test('round-trips checkpoint correctly', () => {
        let cp = emptyCheckpoint('file-123');
        cp = withStep(cp, 'step1', { data: 'test' }, 'hash123');
        cp = withCleanup(cp, { type: 'cleanup', params: { key: 'value' } });

        const row = checkpointToRow(cp);
        const restored = rowToCheckpoint(row);

        expect(restored.fileId).toBe(cp.fileId);
        expect(restored.status).toBe(cp.status);
        expect(restored.steps['step1'].result).toEqual(cp.steps['step1'].result);
        expect(restored.cleanup[0].type).toBe(cp.cleanup[0].type);
    });

    test('handles JSON string steps', () => {
        const row = {
            file_id: 'file-123',
            started_at: 1000,
            completed_at: null,
            status: 'running',
            steps: JSON.stringify({ step1: { result: 'data', inputHash: 'hash', completedAt: 2000 } }),
            cleanup: '[]',
        };

        const cp = rowToCheckpoint(row);
        expect(cp.steps['step1'].result).toBe('data');
    });
});
