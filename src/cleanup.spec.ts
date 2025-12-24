// src/cleanup.spec.ts

import { test, expect, describe } from 'bun:test';
import { executeAllCleanups } from './cleanup';
import type { CleanupAction, CleanupRegistry } from './types';

describe('executeAllCleanups', () => {
    test('executes all cleanup actions', async () => {
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
    });

    test('handles empty cleanup list', async () => {
        const runners: CleanupRegistry = {
            delete: async () => {
                throw new Error('Should not be called');
            },
        };

        await executeAllCleanups(runners)([]);

        // Should complete without error
        expect(true).toBe(true);
    });

    test('continues execution if one cleanup fails', async () => {
        const executed: string[] = [];
        const runners: CleanupRegistry = {
            failing_cleanup: async () => {
                throw new Error('Cleanup failed');
            },
            succeeding_cleanup: async () => {
                executed.push('success');
            },
        };

        const actions: CleanupAction[] = [
            {
                id: '1',
                type: 'failing_cleanup',
                params: {},
                registeredAt: Date.now(),
            },
            {
                id: '2',
                type: 'succeeding_cleanup',
                params: {},
                registeredAt: Date.now(),
            },
        ];

        // Should not throw
        await executeAllCleanups(runners)(actions);

        // Second cleanup should still execute
        expect(executed).toContain('success');
    });

    test('warns if cleanup runner not registered', async () => {
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (...args: any[]) => {
            warnings.push(args.join(' '));
        };

        const runners: CleanupRegistry = {};

        const actions: CleanupAction[] = [
            {
                id: '1',
                type: 'nonexistent_cleanup',
                params: {},
                registeredAt: Date.now(),
            },
        ];

        await executeAllCleanups(runners)(actions);

        expect(warnings.some((w) => w.includes('nonexistent_cleanup'))).toBe(true);
        expect(warnings.some((w) => w.includes('no cleanup runner registered'))).toBe(true);

        // Restore console.warn
        console.warn = originalWarn;
    });

    test('logs errors for failed cleanups', async () => {
        const errors: string[] = [];
        const originalError = console.error;
        console.error = (...args: any[]) => {
            errors.push(args.join(' '));
        };

        const runners: CleanupRegistry = {
            failing: async () => {
                throw new Error('Database connection failed');
            },
        };

        const actions: CleanupAction[] = [
            {
                id: '1',
                type: 'failing',
                params: {},
                registeredAt: Date.now(),
            },
        ];

        await executeAllCleanups(runners)(actions);

        expect(errors.some((e) => e.includes('failing'))).toBe(true);
        expect(errors.some((e) => e.includes('cleanup failed'))).toBe(true);

        // Restore console.error
        console.error = originalError;
    });

    test('passes correct params to cleanup runner', async () => {
        let receivedParams: Record<string, unknown> | null = null;
        const runners: CleanupRegistry = {
            cleanup_with_params: async (params) => {
                receivedParams = params;
            },
        };

        const actions: CleanupAction[] = [
            {
                id: '1',
                type: 'cleanup_with_params',
                params: { id: '123', path: '/tmp', nested: { key: 'value' } },
                registeredAt: Date.now(),
            },
        ];

        await executeAllCleanups(runners)(actions);

        expect(receivedParams as any).toEqual({
            id: '123',
            path: '/tmp',
            nested: { key: 'value' },
        });
    });

    test('executes cleanups in parallel', async () => {
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

        // Should complete in ~50ms (parallel) not ~60ms (sequential)
        expect(duration).toBeLessThan(100);
        // Fast cleanup should finish first
        expect(executionOrder).toEqual([2, 1]);
    });

});
