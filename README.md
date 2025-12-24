# Durable Execution

**Lightweight durable execution with checkpoint memoization and saga cleanup—no sidecar, no orchestration engine, works anywhere.**

Add Temporal/Dapr-style durability and idempotency to **Windmill workflows, APIs, background jobs, CLI tools**—anywhere you run async code.

## Why This Exists

Temporal and Dapr are powerful but heavyweight: they require sidecars, generators, replay logic, and determinism constraints. **Most teams just want crash recovery and step memoization without the infrastructure overhead.**

This library brings durability to your **existing workflows and code**:

- Running a Windmill job that fetches → transforms → uploads? Add crash recovery.
- Building an API endpoint that calls 3 services? Make it idempotent with checkpoints.
- Processing background jobs? Memoize expensive steps, skip on retry.
- Running a CLI migration? Resume from last checkpoint if it crashes.

**No sidecar. No generators. No determinism requirements. Just checkpoints.**

## Features

- **Checkpoint-based progress tracking**: Survives crashes, retries resume from last checkpoint
- **Step memoization**: Expensive/side-effectful steps cached by input hash, skipped on retry
- **Saga-style cleanup**: Register compensations before risky operations, auto-executed on crash
- **Platform-agnostic core**: Works with any async runtime (Node, Bun, Deno)
- **Bring your own storage**: Postgres, Redis, SQLite, S3, Windmill datatable—anything works
- **Functional architecture**: Pure functions, Result-based error handling, no exceptions
- **Zero infrastructure**: Just a table and a storage adapter—no sidecars, daemons, or special runtimes

## Installation

```bash
bun add @td7x/durable-x
npm install @td7x/durable-x
```

***

## Landscape & Decision Guide

### What's Out There

The durability space is fragmented. Here's what exists and what doesn't:

| Tool | Scope | Sidecar | Step Memoization | Saga Cleanup | Works Anywhere | Primary Use Case |
|------|-------|---------|------------------|--------------|---|---|
| **Temporal** | Full orchestration | ✅ Required | ✅ (via replay) | ❌ Manual | ❌ Temporal-only | Distributed systems |
| **Dapr** | Full orchestration | ✅ Required | ✅ (via replay) | ❌ Manual | ❌ Dapr-only | Microservices |
| **Restate** | Full orchestration | ✅ Required | ✅ (via replay) | ❌ Manual | ❌ Restate-only | Event-driven |
| **AWS Durable SDK** | Lambda orchestration | ❌ | ✅ (via replay) | ❌ Manual | ❌ Lambda-only | Serverless |
| **gpahal/durable-execution** | Task workflows | ❌ | ✅ (via replay) | ❌ Manual | ✅ | AI workflows |
| **micro-memoize** | In-memory caching | ❌ | ✅ | ❌ | ✅ (in-memory only) | Pure functions |
| **@windmill-labs** | Multi-step resilience | ❌ | ✅ (input-based) | ✅ Built-in | ✅ | Windmill + general |

***

### The Gap This Library Fills

**You're solving a unique combination:**

1. **Checkpoint + memoization + saga cleanup** bundled together (only library with all three)
2. **No infrastructure** (no sidecar, no special runtime, no determinism constraints)
3. **Windmill-native** (works with Windmill's datatable out-of-box, plus Postgres/Redis/etc.)
4. **Saga cleanup built-in** (not manual like Temporal/Dapr/Restate)
5. **Input-based memoization** (not replay-based like AWS/Temporal)

### vs `gpahal/durable-execution`

| Feature | gpahal/durable-execution | @td7x/durable-execution |
|---------|--------------------------|----------------------------------|
| **Primary focus** | AI workflows [1][2] | Windmill + general workflows |
| **Saga cleanup** | ❌ Manual | ✅ Built-in (`beforeRisky`/`afterSafe`) |
| **Memoization approach** | Replay-based | Input-hash based (skip unchanged steps) |
| **Storage adapters** | Built-in | Pluggable (Windmill, Postgres, Redis, S3) |
| **Windmill integration** | ❌ | ✅ Native datatable support |
| **Error handling** | Unknown | neverthrow Result types |
| **Best for** | Generic task workflows | Windmill-first + multi-platform |

**Bottom line**: `gpahal/durable-execution` is task-focused and AI-oriented. This library is Windmill-native with built-in saga cleanup and pluggable storage.[2][1]

***

### Decision Tree

**Building AI workflows with generic task engine?** → Consider `gpahal/durable-execution`  
**Using Windmill or need saga cleanup?** → Use this library  
**Need distributed multi-service orchestration?** → Temporal/Dapr  
**AWS Lambda only?** → AWS Durable SDK  
**Just need request idempotency?** → Stripe keys or custom  
**Need to skip expensive steps on retry with cleanup?** → This library  

***

## Quick Start

### Windmill Workflow

```typescript
import {
  windmillStorage,
  load,
  durable,
  beforeRisky,
  afterSafe,
  complete,
  type CleanupRegistry,
} from '@td7x/durable-x';

const cleanupRunners: CleanupRegistry = {
  delete_temp: async (params) => {
    await Bun.remove(params.path as string).catch(() => {});
  },
  rollback_upload: async (params) => {
    await deleteFromCdn(params.url as string);
  },
};

export async function main(fileId: string) {
  const cp = await load(windmillStorage)(cleanupRunners)(fileId);
  const step = durable(windmillStorage)(cp);

  const downloaded = await step('download')({ fileId })(() =>
    fetch(`https://api.example.com/files/${fileId}`).then((r) => r.json()),
  );

  const processed = await step('process')({ path: downloaded.path })(() =>
    processFile(downloaded.path),
  );

  const uploadUrl = `s3://bucket/${fileId}.json`;
  await beforeRisky(windmillStorage)(cp)('rollback_upload')({ url: uploadUrl });

  const uploaded = await step('upload')({ url: uploadUrl })(() =>
    uploadToCdn(processed, uploadUrl),
  );

  await afterSafe(windmillStorage)(cp)('rollback_upload');
  await complete(windmillStorage)(cp);

  return { fileId, uploadedUrl: uploadUrl };
}
```

***

## Why `@td7x/durable-x`?

**The name justifies itself:**

1. **Scoped package** (`@windmill-labs/`) = clear differentiation from `gpahal/durable-execution`
2. **Windmill-first** = Native integration with Windmill's ecosystem
3. **Different target** = Not competing with `gpahal` (AI workflows vs Windmill + general)
4. **Unique features** = Built-in saga cleanup + pluggable storage

**You're NOT stepping on toes.** Different niches, different users, complementary tools.

***

## License

MIT – Free to use, modify, distribute.

## Contributing

Issues and PRs welcome. Run `bun run prepublish` before submitting.

