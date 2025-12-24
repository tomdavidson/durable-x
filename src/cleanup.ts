// src/cleanup.ts

import { ResultAsync } from 'neverthrow';
import type { CleanupAction, CleanupRegistry } from './types';
import { logCleanup } from './log';

const executeCleanup =
  (runners: CleanupRegistry) =>
    async (action: CleanupAction): Promise<void> => {
      const runner = runners[action.type];

      if (!runner) {
        console.warn(`⚠️ [${action.type}] no cleanup runner registered`);
        return;
      }

      const result = await ResultAsync.fromPromise(
        runner(action.params),
        (e: unknown) => new Error(`[${action.type}] cleanup failed: ${String(e)}`),
      );

      result.match(
        () => {
          logCleanup(action.type)(undefined as unknown as void);
        },
        (err: Error) => {
          console.error(`⚠️ ${err.message}`);
        },
      );
    };

export const executeAllCleanups =
  (runners: CleanupRegistry) =>
    (actions: CleanupAction[]): Promise<void> =>
      Promise.all(actions.map(executeCleanup(runners))).then(() => undefined);
