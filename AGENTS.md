# Agent notes

## Identifying VirtualConsole

Node's `Console[Symbol.hasInstance]` returns `true` for **any** console instance, so `x instanceof VirtualConsole` is unreliable (the native `console` will match too).

Use `isVirtualConsole(value)` (`VIRTUAL_CONSOLE_BRAND`) — see `src/runtime/shared/virtual-console.mjs`.

## Runtime constraints

- `VirtualConsoleMixin(Base, platform)` closes over a per-runtime descriptor (`routing`, `emitNative`; Node also `createStream` / `writeNativeChunk`). Internals are `#` private; there are no overridable public hooks (`emit` / `getRouting` / …).
- Cross-instance `#` access requires **one mixin instantiation per runtime** (Node and browser each import once). A foreign copy of the package still passes `isVirtualConsole()`, so private call sites gate on `VirtualConsoleBase.#sharesMixinPrivates(target)` (`#ingest in target`) and fall back to the native path.
- Pseudo-methods rendered by `emitNative` without a same-named `baseConsole` method live in `PLATFORM_EMITTED_METHODS` (`stdout` / `stderr` / `freshLine`).
- Node: pin `originalConsole._stdout` / `_stderr` to `streamTable` (pre-hook natives) before replacing `process.stdout` / `stderr` with getters; `writeNativeChunk` / `emitNative` also use `streamTable`.

## Capture, wire, pipeline

- In-process ↔ wire contract: `LogSegment[]` (not a class hierarchy).
- Capture/nesting and expansion-ref invariants: [docs/capture-and-wire.md](docs/capture-and-wire.md).
- Pipeline shape: top of `src/runtime/shared/virtual-console.mjs`.

## Tests

- Entry: `npm test` → `test/runner.mjs`
- Suites: `test/runtime.mjs`, `test/console/` (recording / nesting / block / performance), `test/snapshot.mjs`, `test/wire.mjs`
- Cross-runtime children: `test/browser/child.mjs`, `test/deno/child.mjs` (spawned by the matching `suite.mjs`; last stdout line is JSON `{ results }`)
- Shared helpers: `test/helpers.mjs` (`createNullConsole`, `spawnChildJsonResults`, `runCase` / `emitChildResults`)
