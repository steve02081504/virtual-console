# Virtual Console

[![npm version](https://img.shields.io/npm/v/@steve02081504/virtual-console.svg)](https://www.npmjs.com/package/@steve02081504/virtual-console)
[![GitHub issues](https://img.shields.io/github/issues/steve02081504/virtual-console)](https://github.com/steve02081504/virtual-console/issues)

Capture and inspect `console` output in tests, UIs, and concurrent work while keeping your existing `console.log` (and other `console` methods) calls unchanged.

## Used by

- [async-eval](https://github.com/steve02081504/async-eval)
- [fount](https://github.com/steve02081504/fount)

## Install

```bash
npm install @steve02081504/virtual-console
```

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';

// Prefer these for environment-accurate types:
import { VirtualConsole } from '@steve02081504/virtual-console/node';
import { VirtualConsole } from '@steve02081504/virtual-console/browser';
```

CDN (browser):

```javascript
import { VirtualConsole } from 'https://esm.sh/@steve02081504/virtual-console';
```

The default entry resolves to the correct Node or browser implementation at runtime, but its TypeScript types are always Node-flavoured. Use `/node` or `/browser` when you want types that match your target (`stdout`/`stderr` levels, `AsyncLocalStorage`, browser scoping caveats, etc.).

**Default entry (`.`)** re-exports: `VirtualConsole`, `console`, `defaultConsole`, `consoleAsyncStorage`, `globalConsoleAdditionalProperties`, `setGlobalConsoleResolver`, `getGlobalConsoleResolver`.

For `renderPlain` / `renderAnsi` / `renderHtml`, `WireLogEntry`, `newLogEntry`, `LogEntry`, and related helpers, import from `/node` or `/browser`.

### Subpath entrypoints

Prefer dedicated subpaths for tree-shaking and clearer boundaries:

| Entrypoint             | Contents                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/node`, `/browser`    | Full platform API (`VirtualConsole`, `WireLogEntry`, `renderPlain` / `renderAnsi` / `renderHtml`, stack & snapshot helpers, …) + accurate types |
| `/wire/protocol`       | Wire `type` constants + `dispatchLogWireMessage`                                                                                                |
| `/wire/server`         | `handleClientWireMessage`, `createLogWireWebSocketHandler`                                                                                      |
| `/wire/client`         | `connectLogWire`, `attachLogWire`                                                                                                               |
| `/wire/wire-log-entry` | `WireLogEntry`, `createWireLogEntryFromJson`                                                                                                    |

In-process entries use `entry.toJSON()` for wire transport; clients consume them as `WireLogEntry`. Keep wire-related imports on `/wire/*`.

## Quick start

```javascript
import { strict as assert } from 'node:assert';
import { VirtualConsole } from '@steve02081504/virtual-console';

const vc = new VirtualConsole();

await vc.hookAsyncContext(() => {
  console.log('Hello');
  console.error(new Error('Boom'));
});

assert.equal(vc.outputEntries[0].level, 'log');
assert.equal(vc.outputEntries[1].level, 'error');
assert.ok(vc.outputs.includes('Hello'));
assert.ok(vc.outputs.includes('Error: Boom'));
```

## Examples

### HTML for UIs

```javascript
const vc = new VirtualConsole();

await vc.hookAsyncContext(() => {
  console.log('\x1b[31mRed text\x1b[0m');
  console.log('%cBlue title', 'color: blue; font-size: 20px');
  console.log({ status: 'ok' });
});

const html = vc.outputsHtml; // escaped, safe to render
```

### Concurrent work (Node)

Each `VirtualConsole` only captures logs from the async work passed to `hookAsyncContext`, so parallel jobs stay isolated.

```javascript
const vcA = new VirtualConsole();
const vcB = new VirtualConsole();

async function work(id, delayMs) {
  console.log(`start ${id}`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  console.log(`done ${id}`);
}

await Promise.all([
  vcA.hookAsyncContext(() => work('A', 30)),
  vcB.hookAsyncContext(() => work('B', 10)),
]);

console.log(vcA.outputs);
console.log(vcB.outputs);
```

### Raw `stdout` / `stderr` (Node)

```javascript
const vc = new VirtualConsole();

await vc.hookAsyncContext(async () => {
  process.stdout.write('raw stdout\n');
  process.stderr.write('raw stderr\n');
});

console.log(vc.outputEntries.map((e) => e.level));
// ['stdout', 'stderr']
```

### Progress with `freshLine`

```javascript
const vc = new VirtualConsole({ realConsoleOutput: true });

for (let i = 0; i <= 3; i++) {
  vc.freshLine('build', `Building... ${i}/3`);
  await new Promise((resolve) => setTimeout(resolve, 120));
}
vc.log('Build complete');
```

On an ANSI-capable Node TTY, repeated `freshLine('build', ...)` updates one line. In the browser, `id` is ignored and each call is a normal log line.

### Custom levels: `writeAs`

```javascript
const vc = new VirtualConsole();

vc.writeAs('log', 'normal');
vc.writeAs('trace', 'trace marker');

console.log(vc.outputEntries.map((e) => e.level));
// ['log', 'debug'] — method name `'trace'` maps to semantic level `debug`
```

With `realConsoleOutput: true` on Node, `writeAs` routes warn/error/trace-style levels to stderr and the rest to stdout, similar to `console`.

### Custom indentation and depth (`dir` + `render*`)

```javascript
const vc = new VirtualConsole();

await vc.hookAsyncContext(() => {
  console.dir(
    { user: { profile: { name: 'Ada', skills: ['js', 'ts'] } } },
    { depth: 2 },
  );
});

const entry = vc.outputEntries[0];
const ansi = entry.toString();
const plain = renderPlain(entry.toSegments(), { indent: '  ', maxDepth: 1 });

// Wire entries use the same knobs:
// await wireEntry.renderPlain({ indent: '  ', maxDepth: 1 })
```

`console.dir` options `depth` / `colors` are honored when rendering (on the `value` segment as `dirOptions`, not as an `ArgSnapshot`). `maxDepth` is an additional hard cap at render time (`min(dirOptions.depth, maxDepth)`). `indent` controls multi-line indentation (default: tab).

### Cap memory: `maxLogEntries`

```javascript
const vc = new VirtualConsole({ maxLogEntries: 100 });

await vc.hookAsyncContext(() => {
  for (let i = 0; i < 500; i++) console.log(`line ${i}`);
});

console.log(vc.outputEntries.length); // 100
```

### Stream entries: `addLogEntryListener`

```javascript
const vc = new VirtualConsole();

const onEntry = (entry) => {
  if (entry.level === 'error') {
    // alert, metrics, etc.
  }
};
vc.addLogEntryListener(onEntry);
// later: vc.removeLogEntryListener(onEntry)
```

## Options

| Option              | Default          | Purpose                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `realConsoleOutput` | `false`          | Also forward to the real / underlying console                                                                                                                                                                                                                                                                                              |
| `recordOutput`      | `true`           | When `false`, nothing is stored and listeners are not called (forwarding can still run)                                                                                                                                                                                                                                                    |
| `baseConsole`       | platform default | Console used for passthrough. When set to another `VirtualConsole`, ANSI is inherited and forwarded entries are the **same `LogEntry` instances** (shared `timestamp` / `stack` / expansion refs). Node default: the `VirtualConsole` active in the current async context; browser default: the active virtual console or `defaultConsole` |
| `supportsAnsi`      | platform auto    | Affects `freshLine`, trace formatting, `toString()` / `toHtml()`. Node: via `supports-ansi`; browser: `!!globalThis.chrome`. Inherited when `baseConsole` is a `VirtualConsole`                                                                                                                                                            |
| `maxLogEntries`     | `Infinity`       | Drop oldest entries when exceeded                                                                                                                                                                                                                                                                                                          |

## Results API

- **`outputEntries`** — Captured `LogEntry` objects. Each entry exposes:
  - `level` — semantic level (`'log'`, `'warn'`, `'error'`, `'debug'`, …). `console.trace()` / `writeAs('trace', …)` map to **`debug`**; use `method === 'trace'` to recognize traces
  - `method` — originating method (`'log'`, `'trace'`, `'dir'`, `'stdout'`, …). Useful when `level` alone is ambiguous (e.g. `dir` → level `log`)
  - `args` — original arguments (`stdout` / `stderr` entries store a single-element text array)
  - `timestamp` — Unix ms when recorded
  - `stack` — parsed call-stack frames (`functionName`, `filePath`, `line`, `column`, `raw`)
  - `primaryCallsite` — a single display frame with a usable `filePath` (prefers a root `Error` in args, else first path-bearing `stack` frame); `null` if none
  - `serializeArgs()` — JSON-serializable argument snapshots
  - `toSegments()` — structured fragments (`LogSegment[]`) for UI mapping
  - `toString()` / `toPlainText()` / `toHtml()` — ANSI text, plain text, and HTML

  `console.dir()` → `level: 'log'`, `method: 'dir'`. `console.trace()` → `level: 'debug'`, `method: 'trace'` (stack appended in `toString()` / `toHtml()`; with ANSI on Node, file links may use OSC 8).

- **`outputs`** — Concatenation of each entry’s `toString()`. Console-backed rows end with `\n`; stream-backed `stdout`/`stderr` rows pass through raw bytes.

- **`outputsHtml`** — Concatenation of each entry’s `toHtml()`. Console-backed rows append `<br/>\n`; stream-backed rows do not. Safe to render directly.

- **`options`** — Resolved configuration (`recordOutput`, `realConsoleOutput`, `maxLogEntries`, …).

- **`baseConsole`** (Node) — Effective passthrough console; readable/writable after construction. Nested `VirtualConsole` bases share the same `LogEntry` objects.

- **`blocked`** — `true` while `block()` nesting depth > 0.

- **`stackFrameSkipCount`** — Skip wrapper frames so `entry.stack` points at the real caller. Only the **console instance that was called** applies its count; downstream passthrough layers do not add theirs. See [Accurate stacks](#accurate-stacks-stackframeskipcount).

## Methods

- **`addLogEntryListener(fn)`** / **`removeLogEntryListener(fn)`** — Sync callbacks for each new captured entry (including Node `stdout` / `stderr`). Multiple listeners are allowed.

- **`hookAsyncContext(callback)`** — Run work with `console` bound to this instance; returns a `Promise` of the callback’s result. Node: `AsyncLocalStorage` isolates all child async work. Browser: save/restore swap — bare `setTimeout` (etc.) spawned inside may escape.

- **`hookAsyncContext()`** — No-arg form: activate for the rest of the current context with no teardown. Node: `enterWith`. Browser: sets a module-level global — use with care.

- **`block()`** / **`unblock()`** — Reentrant output gate. While blocked, recording and listeners still run (and may temporarily exceed `maxLogEntries`); nothing is forwarded to `baseConsole`. Each `block()` needs a matching `unblock()`. When nesting returns to zero, deferred output (including deferred `clear`) replays in order, then the buffer is trimmed to `maxLogEntries`. Deferred stream writes are replayed as text (binary chunk fidelity is not preserved). Calling `unblock()` at depth 0 is undefined (no-op flush).

- **`freshLine(id, ...args)`** — Progress line that overwrites the previous line with the same `id` on ANSI-capable Node TTYs; in the browser, behaves like `log`.

- **`clear()`** — Clears captured entries and `freshLine` state, then runs clear listeners synchronously (no synthetic log entry). With `realConsoleOutput`, also clears the underlying console—unless blocked, in which case a clear is queued and replayed (after earlier deferred entries) on the matching `unblock()`.

- **`addClearListener(fn)`** / **`removeClearListener(fn)`** — Sync callbacks after `clear()` (buffer empty; optional underlying `clear()` already called or deferred). Useful with wire helpers for remote UI sync.

- **`writeAs(level, ...args)`** — Record at any level, bypassing `console.*` routing. With `realConsoleOutput: true` on Node, warn/error/trace-style levels go to stderr, the rest to stdout.

On Node, `VirtualConsole` extends the built-in `Console`. In the browser it satisfies the `Console` interface via declaration merge.

## Performance

Practical knobs:

- Set **`recordOutput: false`** on layers that only forward (e.g. a parent with `realConsoleOutput: true` and a child that records).
- Bound memory with **`maxLogEntries`**.
- Prefer cheap fields (`level`, `method`, `args`) until a UI or assertion needs stack / HTML / segments.
- Avoid polling `outputs` / `outputsHtml` in tight loops — cache, or listen with `addLogEntryListener` and format selectively.

Microbenchmarks: `npm run bench`.

## Log levels

| `entry.level`                           | Typical `entry.method` | Source                                          |
| --------------------------------------- | ---------------------- | ----------------------------------------------- |
| `log`, `info`, `warn`, `error`, `debug` | same as level          | `console.log` … `console.debug`                 |
| `debug`                                 | `trace`                | `console.trace()`                               |
| `log`                                   | `dir`                  | `console.dir()`                                 |
| `log` / `error`                         | `stdout` / `stderr`    | `process.stdout` / `process.stderr` (Node)      |
| any string (unchanged)                  | same as level          | `writeAs(level, ...)` — `trace` → level `debug` |

## Log wire protocol (WebSocket JSON)

Stable `type` strings live on **`logWirePayloadTypes`** (`vc_*`). Custom frames use your own `type` plus **`extensionHandlers`** on **`dispatchLogWireMessage`** / **`attachLogWire`**; on the server, **`JSON.stringify`** your payload and **`ws.send`** it (body shape is application-defined).

| Direction                        | `type`              |
| -------------------------------- | ------------------- |
| Server → client (initial list)   | `vc_log_snapshot`   |
| Server → client (one line)       | `vc_log_append`     |
| Server → client (buffer cleared) | `vc_log_cleared`    |
| Server → client (expand reply)   | `vc_expand_result`  |
| Client → server (expand request) | `vc_expand_request` |
| Client → server (request clear)  | `vc_clear_request`  |

Import from `/wire/protocol`, `/wire/server`, `/wire/client`, `/wire/wire-log-entry`.

**Client:** `JSON.parse` each text frame, then `await dispatchLogWireMessage` (callbacks may be `async`: `onSnapshot` → `entries`, `onAppend` → `entry`, `onClear` → zero-arg; `extensionHandlers` for custom `type`, `onUnknown` as fallback). Or use **`attachLogWire`** / **`connectLogWire`**: `requestExpand(ref, maxDepth?)` (Promise), `requestClear()`, `sendJson(obj)` (custom uplink), `close(code, reason)`, `detach()` (rejects pending `requestExpand` with `log_wire_detached`). Options include **`supportsAnsi`** (defaults to `supports-ansi` detection).

**`WireLogEntry`** (from `/wire/client`, or re-exported by `/node` / `/browser`) mirrors in-process display rules: `primaryCallsite` prefers a root `Error` stack frame with a path, else the first path-bearing `stack` frame. After expand resolves `truncated` nodes, `await entry.renderString()` / `renderPlain()` / `renderHtml()` render from the payload’s `segments` (each accepts `{ indent, maxDepth }`). For raw `LogSegment[]`, import `renderPlain` / `renderAnsi` / `renderHtml` from `/node` or `/browser`.

**Server:** `handleClientWireMessage` answers inbound `vc_expand_request` with `vc_expand_result` (optional client `maxDepth` is normalized to a non-negative integer and passed as `(ref, maxDepth)`). **`createLogWireWebSocketHandler(virtualConsole)`** registers `addLogEntryListener` / `addClearListener` once (broadcasts `vc_log_cleared` when the host `clear()` runs), handles `vc_clear_request` by calling `virtualConsole.clear()`, and sends snapshots/appends to clients.

Optional lifecycle hooks:

- **`onClientConnected`** — after snapshot send and registration
- **`onClientDisconnected`** — on `close` / `error`, with reason and current client count
- **`clientMessageHandlers[type]`** / **`onClientMessage`** — custom uplink; returned objects are JSON-replied to the sender

Control plane on the returned handler (in addition to `(ws, req) => void`):

- **`broadcastJson(payload)`** — one custom JSON frame to all OPEN clients
- **`forEachClient(fn)`** — iterate registered clients (OPEN or not)
- **`closeAllWithFinalJson(payload)`** — best-effort final broadcast + close each OPEN client; waits until close settles

```javascript
import {
  dispatchLogWireMessage,
  logWirePayloadTypes,
} from 'https://esm.sh/@steve02081504/virtual-console/wire/protocol';

import { connectLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client';
```

## TypeScript

Use `/node` or `/browser` for the strictest type match. The main entry (`.`) always exposes Node-flavoured types at compile time.

| Type                    | Description                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LogEntry`              | In-process entry: `level`, `method`, `args`, `timestamp`, `stack`, `primaryCallsite`, `serializeArgs()`, `toSegments()`, sync `toString()` / `toPlainText()` / `toHtml()`       |
| `WireLogEntry`          | Wire payload view; `primaryCallsite`; async `renderString()` / `renderPlain()` / `renderHtml()` after `truncated` expansion; import from `/wire/client` or `/node` / `/browser` |
| `CapturedLogLevel`      | Normalized semantic `entry.level` after routing                                                                                                                                 |
| `WriteAsLevelArg`       | Method-style names accepted before routing (`trace`, `dir`, `stdout`, `stderr`, …)                                                                                              |
| `ArgSnapshot`           | JSON-serializable tagged snapshot tree; e.g. `Error` (parsed `stack` frames), `Date` (`value` is ms—`NaN` → `null` on the wire; renderers show ISO or `Invalid Date`)           |
| `LogSegment`            | Discriminated union from `toSegments()` (`text`, `css`, `value`, `trace`)                                                                                                       |
| `StackFrame`            | Parsed stack frame: `functionName`, `filePath`, `line`, `column`, `raw`                                                                                                         |
| `VirtualConsoleOptions` | Constructor options; platform-specific fields differ between `/node` and `/browser`                                                                                             |
| `GlobalConsoleRouting`  | Shape from `getGlobalConsoleResolver()` — `getActiveConsole`, `setActiveConsole`, `runWithActiveConsole`                                                                        |
| `VirtualStream`         | (Node) Wrapper around `process.stdout` / `stderr`; exposes `targetStream`, TTY properties, `getColorDepth()`, `hasColors()`                                                     |

## Advanced

### Accurate stacks: `stackFrameSkipCount`

When your function wraps a `console` call, bump `stackFrameSkipCount` on the **console being called** (not a downstream passthrough) and restore it in `finally` so the captured stack skips the wrapper:

```javascript
function myLog(...args) {
  try {
    console.stackFrameSkipCount++;
    console.log(...args);
  } finally {
    console.stackFrameSkipCount--;
  }
}
```

### Custom context (routers, frameworks)

Replace the three routing hooks—**resolve with fallback**, **set active console**, **run in console context**—via **`setGlobalConsoleResolver`**. Read the current hooks with **`getGlobalConsoleResolver()`** (returns **`GlobalConsoleRouting`**: `getActiveConsole`, `setActiveConsole`, `runWithActiveConsole`).

Node default wiring:

```javascript
import {
  consoleAsyncStorage,
  setGlobalConsoleResolver,
} from '@steve02081504/virtual-console/node';

setGlobalConsoleResolver(
  (fallback) => consoleAsyncStorage.getStore() ?? fallback,
  (instance) => {
    consoleAsyncStorage.enterWith(instance);
  },
  (instance, callback) => consoleAsyncStorage.run(instance, callback),
);
```

In the browser, use custom reflection when you need more than one logical “active” console; see `browser` types for `hookAsyncContext` scoping.

### Node-only exports

| Export                                                  | Role                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `consoleAsyncStorage`                                   | `AsyncLocalStorage` behind `hookAsyncContext` (always present from `/node`; main entry types it as possibly absent) |
| `defaultConsole`                                        | Always-on fallback: forwards to the original global `console`                                                       |
| `console`                                               | Proxy that delegates to the active `VirtualConsole` in the current async context                                    |
| `globalConsoleAdditionalProperties`                     | Plain object merged onto the proxy on every access—extend `globalThis.console` without patching the proxy itself    |
| `setGlobalConsoleResolver` / `getGlobalConsoleResolver` | Replace / read the three active-console routing callbacks                                                           |
| `VirtualStream` (type)                                  | Virtual `stdout` / `stderr` wrappers; `targetStream`, TTY props, `getColorDepth()`, `hasColors()`                   |

## Node vs browser

| Feature                         | Node                                                                      | Browser                                                     |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Async isolation                 | `AsyncLocalStorage`; child async work captured                            | Save/restore; bare `setTimeout` etc. may escape             |
| No-arg `hookAsyncContext()`     | `enterWith`                                                               | Module-level global — affects all subsequent code           |
| `stdout` / `stderr` capture     | Yes (`stdout` / `stderr` levels)                                          | N/A — use console methods                                   |
| `freshLine` overwrite           | ANSI-capable TTYs                                                         | Same as normal `log`                                        |
| `writeAs` + `realConsoleOutput` | Native method when present; else warn/error/trace → stderr, rest → stdout | Forwards to `baseConsole` method (or `log` for `freshLine`) |
| `supportsAnsi` default          | `supports-ansi`                                                           | `!!globalThis.chrome`                                       |

## Development

```bash
npm test
npm run bench
```

## Security

`outputsHtml` escapes content and sanitizes `%c` styles so log output is safer to render.

```javascript
console.log('%cAttempt', '"><script>alert("xss")</script><span style="');
// Rendered HTML stays escaped / sanitized
```
