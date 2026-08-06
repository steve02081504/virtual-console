# Agent notes

## Identifying VirtualConsole

Node's `Console[Symbol.hasInstance]` returns `true` for **any** console instance, so `x instanceof VirtualConsole` is unreliable (the native `console` will match too).

Use `isVirtualConsole(value)` (`VIRTUAL_CONSOLE_BRAND`) — see `src/runtime/shared/virtual-console.mjs`.

## Runtime constraints

- `VirtualConsoleMixin(Base, platform)` closes over a per-runtime descriptor (`routing`, `emitNative`; Node also `createStream` / `writeNativeChunk`). Internals are `#` private; there are no overridable public hooks (`emit` / `getRouting` / …).
- Cross-instance `#` access requires **one mixin instantiation per runtime** (Node and browser each import once).
- Pseudo-methods rendered by `emitNative` without a same-named `baseConsole` method live in `PLATFORM_EMITTED_METHODS` (`stdout` / `stderr` / `freshLine`).

## Nested capture & wire

- When a recording child captures, parent and child share that entry instance (`supportsAnsi`, timestamp, lazy `stack`, expansion refs are fixed at the capture layer). A non-recording child hopping to a recording parent lets the **parent** capture.
- Expansion refs are keyed by entry identity (`getExpansionScope(entry)`); repeated `toSegments()` on the same truncated object reuses the same `truncated.ref`.
- The in-process ↔ wire contract is `LogSegment[]`, not a class hierarchy.

## Pipeline

Shape and seam rules live next to the code in `src/runtime/shared/virtual-console.mjs`:

`#dispatch` → (raw hop | stackless `#emit` | `#capture` → `#ingest`(`#record` + `#output`) → `#emit`); streams use `#ingestChunk`.

## Tests

- 入口：`npm test` → `test/runner.mjs`
- 主题套件：`test/runtime.mjs`、`test/console/`（recording / nesting / block / performance）、`test/snapshot.mjs`、`test/wire.mjs`
- 跨运行时子进程：`test/browser/child.mjs`、`test/deno/child.mjs`（由对应 `suite.mjs` spawn，stdout 末行 JSON `{ results }`）
- 共享辅助：`test/helpers.mjs`（`createNullConsole`、`spawnChildJsonResults`、`runCase` / `emitChildResults`）
