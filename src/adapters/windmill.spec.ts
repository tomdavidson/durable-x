// src/cleanup.spec.ts

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { executeAllCleanups } from '../cleanup';
import type { CleanupAction, CleanupRegistry } from '../types';

describe('executeAllCleanups', () => {
    let consoleLogs: { warns: string[]; errors: string[] };
    let originalWarn: typeof console.warn;
    let originalError: typeof console.error;

    beforeEach(() => {
        consoleLogs = { warns: [], errors: [] };
        originalWarn = console.warn;
        originalError = console.error;

        console.warn = (...args: any[]) => {
            consoleLogs.warns.push(args.join(' '));
        };
        console.error = (...args: any[]) => {
            consoleLogs.errors.push(args.join(' '));
        };
    });

    afterEach(() => {
        console.warn = originalWarn;
        console.error = originalError;
    });

    test('executes all cleanup actions successfully', async () => {
        const executed: string[] = [];
        const runners: CleanupRegistry = {
            delete_temp: async (params) => {
                executed.push(`delete_temp:${params.path}`);
            },
            rollback_upload: async (params) => {
                executed.push(`rollback_upload:${params.url}`);
            },
        };

        const actions: CleanupAction[] = [
            {
                id: '1',
                type: 'delete_temp',
                params: { path: '/tmp/file1' },
                registeredAt: Date.now(),
            },
            {
                id: '2',
                type: 'rollback_upload',
                params: { url: 'https://cdn.example.com/file.json' },
                registeredAt: Date.now(),
            },
        ];

        await executeAllCleanups(runners)(actions);

        expect(executed).toEqual([
            'delete_temp:/tmp/file1',
            'rollback_upload:https://cdn.example.com/file.json',
        ]);
        expect(consoleLogs.errors).toHaveLength(0);
    });

    test('handles empty cleanup list', async () => {
        const runners: CleanupRegistry = {};

        await executeAllCleanups(runners)([]);

        expect(consoleLogs.warns).toHaveLength(0);
        expect(consoleLogs.errors).toHaveLength(0);
    });

    test('continues executing remaining cleanups when one fails', async () => {
        const executed: string[] = [];
        const runners: CleanupRegistry = {
            failing_cleanup: async () => {
                throw new Error('Database connection failed');
            },
            succeeding_cleanup: async () => {
                executed.push('success');
            },
        };

        const actions: CleanupAction[] = [
            { id: '1', type: 'failing_cleanup', params: {}, registeredAt: Date.now() },
            { id: '2', type: 'succeeding_cleanup', params: {}, registeredAt: Date.now() },
        ];

        await executeAllCleanups(runners)(actions);

        expect(executed).toContain('success');
        expect(consoleLogs.errors.some(e => e.includes('failing_cleanup'))).toBe(true);
        expect(consoleLogs.errors.some(e => e.includes('Database connection failed'))).toBe(true);
    });

    test('warns when cleanup runner not registered', async () => {
        const runners: CleanupRegistry = {
            registered: async () => { },
        };

        const actions: CleanupAction[] = [
            { id: '1', type: 'nonexistent_cleanup', params: {}, registeredAt: Date.now() },
        ];

        await executeAllCleanups(runners)(actions);

        expect(consoleLogs.warns.some(w => w.includes('nonexistent_cleanup'))).toBe(true);
        expect(consoleLogs.warns.some(w => w.includes('no cleanup runner registered'))).toBe(true);
        expect(consoleLogs.errors).toHaveLength(0);
    });

    test('passes exact params to cleanup runner', async () => {
        let receivedParams: Record<string, unknown> | null = null;
        const runners: CleanupRegistry = {
            parameterized: async (params) => {
                receivedParams = params;
            },
        };

        const expectedParams = { id: '123', path: '/tmp', nested: { key: 'value' } };
        const actions: CleanupAction[] = [
            {
                id: '1',
                type: 'parameterized',
                params: expectedParams,
                registeredAt: Date.now(),
            },
        ];

        await executeAllCleanups(runners)(actions);

        expect(receivedParams).not.toBe(null);

        expect(receivedParams as any).toEqual(expectedParams);  // ← Cast to any
    });

    test('executes multiple cleanups in parallel', async () => {
        const executionOrder: number[] = [];
        const runners: CleanupRegistry = {
            slow: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                executionOrder.push(1);
            },
            fast: async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                executionOrder.push(2);
            },
        };

        const actions: CleanupAction[] = [
            { id: '1', type: 'slow', params: {}, registeredAt: Date.now() },
            { id: '2', type: 'fast', params: {}, registeredAt: Date.now() },
        ];

        const start = Date.now();
        await executeAllCleanups(runners)(actions);
        const duration = Date.now() - start;

        expect(duration).toBeLessThan(100); // ~50ms (parallel) not ~60ms (sequential)
        expect(executionOrder).toEqual([2, 1]); // Fast finishes first
    });

    test('handles thrown non-Error objects gracefully', async () => {
        const runners: CleanupRegistry = {
            throws_string: async () => {
                throw 'string error'; // Not an Error object
            },
            throws_number: async () => {
                throw 42;
            },
        };

        const actions: CleanupAction[] = [
            { id: '1', type: 'throws_string', params: {}, registeredAt: Date.now() },
            { id: '2', type: 'throws_number', params: {}, registeredAt: Date.now() },
        ];

        await executeAllCleanups(runners)(actions);

        expect(consoleLogs.errors.some(e => e.includes('throws_string'))).toBe(true);
        expect(consoleLogs.errors.some(e => e.includes('throws_number'))).toBe(true);
    });

    test('does not throw if all cleanups fail', async () => {
        const runners: CleanupRegistry = {
            fail1: async () => { throw new Error('fail1'); },
            fail2: async () => { throw new Error('fail2'); },
        };

        const actions: CleanupAction[] = [
            { id: '1', type: 'fail1', params: {}, registeredAt: Date.now() },
            { id: '2', type: 'fail2', params: {}, registeredAt: Date.now() },
        ];

        // Should not throw
        await executeAllCleanups(runners)(actions);

        expect(consoleLogs.errors).toHaveLength(2);
    });
});
