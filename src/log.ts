// src/log.ts

const log =
  <T>(emoji: string, tag: string, msg: string) =>
  (value: T): T => {
    console.log(`${emoji} [${tag}] ${msg}`);
    return value;
  };

export const logHit = (name: string, h: string) =>
  log('⏭️', name, `cached (${h})`);

export const logMiss = (name: string, h: string) =>
  log('▶️', name, `exec (${h})`);

export const logSave = (name: string) => log('✅', name, 'saved');

export const logCleanup = (type: string) => log('🧹', type, 'cleanup executed');

export const logCleanupReg = (type: string) =>
  log('📋', type, 'cleanup registered');

export const logCleanupClear = (type: string) =>
  log('✓', type, 'cleanup cleared');

export const logDone = (id: string) => log('🏁', id, 'complete');

export const logFailed = (id: string) => log('💥', id, 'failed');

export const logRecovery = (id: string, count: number) =>
  log('🔧', id, `recovering ${count} pending cleanups`);
