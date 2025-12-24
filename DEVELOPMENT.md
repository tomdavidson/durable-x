# Durable Execution Module

## Directory Structure

```
durable-execution/
├── src/
│   ├── index.ts              # Public API exports
│   ├── types.ts              # Domain types (platform-agnostic)
│   ├── hash.ts               # Pure hashing (with tests)
│   ├── checkpoint.ts         # Pure checkpoint transforms (with tests)
│   ├── log.ts                # Logging helpers
│   ├── cleanup.ts            # Cleanup execution
│   ├── api.ts                # Core orchestration logic
│   └── adapters/
│       └── windmill.ts       # Windmill implementation
├── package.json              # npm metadata
├── tsconfig.json             # TypeScript config
├── README.md                 # Full documentation
├── LICENSE                   # MIT
├── .gitignore                # Git exclusions
└── dist/                     # (generated on build)
```

## Quick Start

### Install dependencies

```bash
bun install
```

### Run tests

```bash
# All tests
bun test

# Watch mode
bun test --watch

# Specific file
bun test src/hash.ts
```

### Build

```bash
# Full build (types + ESM)
bun run build

# Type check only
bun run lint

# Clean dist/
bun run clean
```

### Publish

```bash
# Full prepublish workflow (clean, build, lint, test)
bun run prepublish

# Publish to npm
npm publish

# For scoped/private registry
npm publish --registry https://your-registry.example.com
```

## What's Included

✅ **Pure, testable core**: hash, checkpoint transforms, logic  
✅ **Colocated unit tests**: Using bun:test in same files  
✅ **Result-based error handling**: neverthrow, no exceptions  
✅ **Platform-agnostic**: Implement StorageAdapter for any backend  
✅ **Full TypeScript**: No `any`, strict mode  
✅ **Windmill adapter**: Ready to use in Windmill flows  
✅ **Production-ready**: ESM, sourcemaps, declaration files  
✅ **Comprehensive README**: Examples, API docs, FAQ  

## Key Features

- **Durable checkpoints**: Per-item progress tracking with crash recovery
- **Step memoization**: Input-based hashing skips expensive steps on retry  
- **Cleanup actions**: Saga-style compensations before risky operations
- **Platform-agnostic core**: Platform-specific logic isolated in adapters
- **Functional architecture**: Pure functions, immutable data, no OOP

## Testing

Tests are colocated in source files and use Bun's native test runner:

```typescript
// Example from src/hash.ts
import { test, expect, describe } from 'bun:test';

describe('hash', () => {
  test('produces stable hashes', () => {
    const h1 = hash({ a: 1, b: 2 });
    const h2 = hash({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });
});
```

Coverage includes:
- ✅ Hashing (stability, determinism)
- ✅ Checkpoint transforms (immutability, status flows)
- ✅ Cache logic (hits, misses)
- ✅ Cleanup tracking (add, remove)
- ✅ Row serialization (JSON round-trips)

## Architecture Decisions

### Why colocated tests?
- **Proximity**: Tests live next to code they verify
- **Simplicity**: No separate test file overhead for small modules
- **Maintainability**: Refactor code + tests together
- **Tree-shaking**: Test code excluded from production builds

### Why Bun?
- **Fast**: Native TypeScript, ESM, built-in test runner
- **Single tool**: No separate bundler, transpiler, test runner
- **Windmill compatible**: Bun is Windmill's default runtime

### Why platform-agnostic?
- **Reusability**: Works with Windmill, Temporal, Prefect, n8n, etc.
- **Portability**: Just implement one `StorageAdapter` interface
- **Flexibility**: Storage backend agnostic (Postgres, Redis, S3, etc.)

## Publishing Checklist

Before publishing to npm:

- [ ] Run `bun run prepublish` (clean, build, lint, test)
- [ ] Verify `dist/` is generated and TypeScript declarations exist
- [ ] Update version in `package.json`
- [ ] Create git tag: `git tag v0.1.0`
- [ ] Push to registry: `npm publish`
- [ ] Verify on npm: https://www.npmjs.com/package/@windmill-labs/durable-execution

## Example Usage in Windmill

```typescript
import { windmillStorage, load, durable, complete } from '@windmill-labs/durable-execution';
import type { CleanupRegistry } from '@windmill-labs/durable-execution';

const cleanupRunners: CleanupRegistry = {
  delete_temp: async (p) => {
    await Bun.remove(p.path as string).catch(() => {});
  },
};

export async function main(fileId: string) {
  const cp = await load(windmillStorage)(cleanupRunners)(fileId);
  const step = durable(windmillStorage)(cp);

  const result = await step('work')({ fileId })(() => doWork(fileId));

  await complete(windmillStorage)(cp);
  return result;
}
```

