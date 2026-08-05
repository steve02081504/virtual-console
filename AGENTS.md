# Agent notes

## Identifying VirtualConsole

Node's `Console[Symbol.hasInstance]` returns `true` for **any** console instance, so `x instanceof VirtualConsole` is unreliable (the native `console` will match too).

To check whether a value is an instance of this library, use `isVirtualConsole(value)` (`VIRTUAL_CONSOLE_BRAND`); see `src/runtime/shared/virtual-console.mjs`.

## Pipeline seams

`#dispatch → (raw hop | stackless entry → #emit | #capture → #ingest(#record + #output) → #emit)`:

- `#needsEntry`: `recordOutput || (blocked && realConsoleOutput)`. Only then does this layer allocate a stacked `LogEntry` (with an `Error` for lazy stack). Pure passthrough layers hop with `(method, args, skipFrames+1)` or emit a stackless `newLogEntry` (no `Error` / no stack parse).
- `#dispatch(method, args, skipFrames)`: entry point for console methods / `freshLine` / `writeAs`. `skipFrames` starts as `stackFrameSkipCount + CONSOLE_CALL_STACK_SKIP` on the **called** console; each VC→VC hop adds `1`.
- `#ingest(entry)` = `#record` + `#output`. `#record`: push → (when not blocked) trim → notify listeners. `#output`: when `realConsoleOutput`, `#defer(() => #emit(entry))`. Stream path `#record`s then forwards the original chunk itself (or `#emit`s the entry toward a parent VC).
- `#emit(entry)`: if base is a VirtualConsole, `base.#ingest(same entry)` (parent and child share the instance); otherwise updates `#lastFreshLineId` and calls platform `emitNative(entry, { baseConsole, supportsAnsi, lastFreshLineId })`.
- `#defer(callback)`: while `block` is active, enqueues a thunk; otherwise runs immediately. `unblock` at depth 0 runs thunks in order then trims. Clear is just another thunk (`() => baseConsole.clear()`).
- `#ingestChunk`: stream twin of `#dispatch`. Non-recording layers pass the original `chunk` through; recording layers decode once into a `StreamLogEntry`.

## Platform descriptor

`VirtualConsoleMixin(Base, platform)` closes over a per-runtime descriptor (`routing`, `emitNative`, and on Node `createStream` / `writeNativeChunk`). Pseudo-methods that `emitNative` renders without a same-named `baseConsole` method live in shared `PLATFORM_EMITTED_METHODS` (`stdout` / `stderr` / `freshLine`). No overridable public hooks (`emit` / `getRouting` / …)—internals are `#` private.

**Constraint:** cross-instance `#` access requires a single mixin instantiation per runtime (Node and browser each import once).

## Entry-derived state

- Expansion refs are tied to the entry object's lifetime; `getExpansionScope(entry)` reuses a scope per entry identity, so repeated `toSegments()` on the same truncated object reuse the same `truncated.ref`.
- Nested VCs share the same entry when the **child** captured it; `supportsAnsi` / `timestamp` / lazy `stack` / expansion refs across the chain are decided by that capture layer. When a non-recording child hops to a recording parent, the **parent** captures (its own `supportsAnsi`, etc.).
- `LogEntry#stack` is lazy: constructor keeps `stackSource` (`Error`) + `skipFrames`; first read parses via `parseErrorStack` and caches. `StreamLogEntry#stack` additionally trims leading `node:` frames. `toString` / `outputs` / `outputsHtml` do not touch stack (except `trace`, which reads it from `toSegments()`).
- Fresh-line id splitting lives only on `FreshLineLogEntry` (`id` / `displayArgs`); the mixin tracks `#lastFreshLineId` via `entry.id ?? null` and lets Node `emitNative`'s `freshLine` branch decide overwrite.
- The contract between in-process and wire is `LogSegment[]`, not a class inheritance tree.
