# Virtual Console

[![npm version](https://img.shields.io/npm/v/@steve02081504/virtual-console.svg)](https://www.npmjs.com/package/@steve02081504/virtual-console)
[![GitHub issues](https://img.shields.io/github/issues/steve02081504/virtual-console)](https://github.com/steve02081504/virtual-console/issues)

Capture and inspect `console` output in tests, UIs, and concurrent work—without replacing `console.log` (or other `console` methods) in your own code.

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

The default entry resolves to the correct Node or browser implementation at runtime, but its TypeScript types are always Node-flavoured. Use `/node` or `/browser` when you want types that strictly match your target (`stdout`/`stderr` levels, `AsyncLocalStorage`, browser scoping caveats, etc.).

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
  await new Promise(resolve => setTimeout(resolve, delayMs));
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

console.log(vc.outputEntries.map(e => e.level));
// ['stdout', 'stderr']
```

### Progress with `freshLine`

```javascript
const vc = new VirtualConsole({ realConsoleOutput: true });

for (let i = 0; i <= 3; i++) {
  vc.freshLine('build', `Building... ${i}/3`);
  await new Promise(resolve => setTimeout(resolve, 120));
}
vc.log('Build complete');
```

On an ANSI-capable Node TTY, repeated `freshLine('build', ...)` updates one line. In the browser, `id` is ignored and each call is a normal log line.

### Custom levels: `write_as`

```javascript
const vc = new VirtualConsole();

vc.write_as('log', 'normal');
vc.write_as('custom-level', 'custom payload');
vc.write_as('trace', 'trace marker');

console.log(vc.outputEntries.map(e => e.level));
// ['log', 'custom-level', 'debug'] — method name `'trace'` maps to semantic level `debug`
```

With `realConsoleOutput: true` on Node, `write_as` routes warn/error/trace-style levels to stderr and the rest to stdout, similar to `console`.

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
// later: vc.removeLogEntryListener(onEntry);
```

## Options

| Option              | Default          | Purpose                                                                                                                                                                                                                                                               |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `realConsoleOutput` | `false`          | Also forward to the real / underlying console                                                                                                                                                                                                                         |
| `recordOutput`      | `true`           | When `false`, nothing is stored (passthrough can still run)                                                                                                                                                                                                           |
| `base_console`      | platform default | Console used for `realConsoleOutput` passthrough. When set to another `VirtualConsole`, ANSI settings are inherited from it. Node default: the `VirtualConsole` active in the current async context; browser default: the active virtual console or `defaultConsole`. |
| `supportsAnsi`      | platform auto    | Affects `freshLine`, trace formatting, `toString()` / `toHtml()`. Node: auto-detected via `supports-ansi`; browser: `!!globalThis.chrome`. Inherited from `base_console` when `base_console` is a `VirtualConsole`.                                                   |
| `maxLogEntries`     | `Infinity`       | Drop oldest entries when exceeded                                                                                                                                                                                                                                     |

## Results API

- **`outputEntries`** — Array of captured `LogEntry` objects. Each entry exposes:
  - `level` — semantic level string after routing (`'log'`, `'warn'`, `'error'`, `'debug'`, etc.). Note: `console.trace()` and `write_as('trace', …)` map to **`debug`** (see [Log levels](#log-levels)); use `method === 'trace'` to recognize trace-shaped entries.
  - `method` — originating console/stream method name (`'log'`, `'trace'`, `'dir'`, `'stdout'`, …). Useful when `level` alone is ambiguous (e.g. `dir` → level `log`).
  - `timestamp` — Unix timestamp in milliseconds when the entry was recorded
  - `stack` — parsed call-stack frames, each with `functionName`, `filePath`, `line`, `column`, and `raw`
  - `plainText` — readable text with ANSI/OSC stripped (good for search/filter)
  - `serializeArgs()` — JSON-serializable snapshots of the original arguments (depth-limited)
  - `toSegments()` — structured fragments for UI mapping (`LogSegment[]`)
  - `toString()` / `toHtml()` — render the entry as plain text or HTML

  `console.dir()` produces `DirLogEntry` instances (see `src/core/entries.mjs`): `level` is **`log`**, `method` is **`dir`**; `toString()` / `toHtml()` render the inspected object like `console.dir`, honoring `console.dir` options when provided.

  `console.trace()` calls produce `TraceLogEntry` instances (`level` **`debug`**, `method` **`trace`**), whose `toString()` / `toHtml()` append formatted stack output after the message. They inherit `supportsAnsi` from the host `VirtualConsole` options; when true, `toString()` may embed OSC 8 hyperlink sequences for file/line references.

- **`outputs`** — All captured output joined into a single plain-text string (entries separated by newlines).

- **`outputsHtml`** — All captured output joined into a single HTML string, safe to render directly.

- **`options`** — The resolved configuration object for flags such as `recordOutput`, `realConsoleOutput`, `maxLogEntries`, etc.

- **`base_console`** (Node) — The effective passthrough console instance resolved from the `base_console` option. Readable and writable directly on the instance after construction.

- **`stackFrameSkipCount`** — When you wrap `console` calls inside your own function, increment this before the call and restore it in `finally`. This skips the extra stack frame so `entry.stack` still points at the real caller. See [example below](#accurate-stacks-stackframeskipcount).

## Methods

- **`addLogEntryListener(fn)`** / **`removeLogEntryListener(fn)`** — Register or unregister callbacks invoked synchronously for each new captured entry (including stream-backed `stdout` / `stderr` entries on Node). Multiple listeners are allowed.

- **`hookAsyncContext(callback)`** — Run a function in an isolated async context where `console` is bound to this instance; returns a `Promise` resolving to the function's return value. On Node, isolation is backed by `AsyncLocalStorage.run`, so all child async work inside the callback is captured. In the browser, a save/restore swap is used—macro-tasks spawned inside the callback (e.g. bare `setTimeout` callbacks) may not inherit the context.

- **`hookAsyncContext()`** — No-arg form: activates this instance for the rest of the current context with no automatic teardown. On Node it calls `AsyncLocalStorage.enterWith`; in the browser it sets a module-level variable that affects all subsequent code globally. Use with care.

- **`freshLine(id, ...args)`** — Print a progress line that overwrites the previous line when called again with the same `id`. Works on ANSI-capable Node TTYs; in the browser it behaves like a normal `log` call. See [example above](#progress-with-freshline).

- **`clear()`** — Clears all captured entries and resets the `freshLine` state. Then invokes **`addClearListener`** callbacks synchronously (no synthetic log entry). When `realConsoleOutput` is enabled, also calls `clear()` on the underlying console.

- **`addClearListener(fn)`** / **`removeClearListener(fn)`** — Register/unregister callbacks invoked synchronously after **`clear()`** completes (buffer empty, optional underlying `clear()` already called). Use with **`createLogWireWebSocketHandler`** / **`attachLogWireWebSocket`** for remote UI sync.

- **`write_as(level, ...args)`** — Record an entry at any log level, bypassing `console.*` method routing entirely. Useful for custom levels or injecting synthetic entries. With `realConsoleOutput: true` on Node, warn/error/trace-style levels go to stderr and everything else to stdout.

On Node, `VirtualConsole` extends the built-in `Console`. In the browser, `VirtualConsole` satisfies the `Console` interface via a declaration merge, so it can be used anywhere a `Console` is expected.

## Log levels

Semantic **`level`** (what you read on `entry.level`) vs originating **`method`** (`entry.method`):

| `entry.level`                           | Typical `entry.method` | Source                                     |
| --------------------------------------- | ---------------------- | ------------------------------------------ |
| `log`, `info`, `warn`, `error`, `debug` | same as level          | `console.log` … `console.debug`            |
| `debug`                                 | `trace`                | `console.trace()` → `TraceLogEntry`        |
| `log`                                   | `dir`                  | `console.dir()` → `DirLogEntry`            |
| `log` / `error`                         | `stdout` / `stderr`    | `process.stdout` / `process.stderr` (Node) |
| any string (unchanged)                  | same as level          | `write_as(level, ...)` — `trace` → level `debug`                                                       |

`console.trace()` stacks appear in `toString()` / `toHtml()`. With ANSI on Node, file/line links may use OSC 8.

## Log wire protocol (WebSocket JSON)

For pushing serialized log entries over a WebSocket, this package defines stable `type` strings on **`logWirePayloadTypes`** (`vc_log_*`, `vc_expand_*`). Server and client must use these names only.

| Direction | `type` (`logWirePayloadTypes`) |
| --------- | -------------------- |
| Server → client (initial list) | `vc_log_snapshot` |
| Server → client (one line) | `vc_log_append` |
| Server → client (buffer cleared) | `vc_log_cleared` |
| Server → client (expand reply) | `vc_expand_result` |
| Client → server (expand request) | `vc_expand_request` |
| Client → server (request clear) | `vc_clear_request` |

Wire helpers are **not** re-exported from `@steve02081504/virtual-console`, `@…/node`, or `@…/browser` — import from **`@steve02081504/virtual-console/wire/protocol`**, **`/wire/server`**, and **`/wire/client`** as needed.

Use **`JSON.parse`** on each inbound text frame, then **`dispatchLogWireMessage`** from **`@steve02081504/virtual-console/wire/protocol`**. Snapshot payloads may include extra fields (e.g. `canOpenEditor`); handlers receive them as **`metadata`** (everything except `type` and `entries`). For **`vc_expand_result`**, pass **`onExpandResult`** to **`dispatchLogWireMessage`** only when you parse frames yourself; if you use **`attachLogWireWebSocket`** below, rely on **`requestExpand(ref)`** (Promise) instead — do not duplicate both.

Use **`makeAppendPayload` / `makeSnapshotPayload` / `makeExpandResponse`** from **`@steve02081504/virtual-console/wire/server`** when building messages next to `VirtualConsole`.

On the server, **`handleClientWireMessage`** handles inbound JSON whose `type` is **`vc_expand_request`** and returns a reply object whose `type` is **`vc_expand_result`**. Inbound **`vc_clear_request`** is handled inside **`createLogWireWebSocketHandler`** (not by **`handleClientWireMessage`**).

For Express/`ws`-style apps, **`createLogWireWebSocketHandler(virtualConsole, { getMetadata })`** from **`@steve02081504/virtual-console/wire/server`** registers **`addLogEntryListener`** once, **`addClearListener`** once (broadcasts **`vc_log_cleared`** when the host console **`clear()`** runs), and handles **`vc_clear_request`** from clients by calling **`virtualConsole.clear()`**.

**`connectLogWire`** / **`attachLogWireWebSocket`** are exported from **`@steve02081504/virtual-console/wire/client`**. The returned handle includes **`requestExpand(ref)`** — returns a **`Promise`** resolved with the expanded snapshot — and **`requestClear()`** (sends **`vc_clear_request`** when the socket is open). Pass **`onClear`** to react to **`vc_log_cleared`** from the server.

```javascript
// Lightweight parse-only (CDN-friendly)
import {
  dispatchLogWireMessage,
  logWirePayloadTypes,
} from 'https://esm.sh/@steve02081504/virtual-console/wire/protocol';

// Optional: full WebSocket helper
import { connectLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client';
```

## TypeScript

Use `/node` or `/browser` for the strictest type match with your target environment. Exported types include:

| Type                    | Description                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `LogEntry`              | Single log entry with `level`, `method`, `timestamp`, `stack`, `plainText`, `serializeArgs()`, `toSegments()`, `toString()`, `toHtml()` |
| `TraceLogEntry`         | Extends `LogEntry`; appends stack in `toString()`/`toHtml()`; `supportsAnsi` controls OSC 8 links in plain-text trace output               |
| `DirLogEntry`           | (runtime class in `src/core/entries.mjs`) Used for `console.dir`; formats the inspected object in `toString()`/`toHtml()`                    |
| `StackFrame`            | Single parsed stack frame: `functionName`, `filePath`, `line`, `column`, `raw`                                                            |
| `CommonLogEntryLevel`   | `'log' \| 'info' \| 'warn' \| 'error' \| 'debug' \| 'trace'`                                                                              |
| `BrowserLogEntryLevel`  | Alias for `CommonLogEntryLevel`                                                                                                           |
| `NodeLogEntryLevel`     | `BrowserLogEntryLevel \| 'stdout' \| 'stderr'`                                                                                            |
| `VirtualConsoleOptions` | Constructor options; platform-specific fields differ between `/node` and `/browser`                                                       |
| `GlobalConsoleRouting`    | Object shape returned by `getGlobalConsoleResolver()` — `getActiveConsole`, `setActiveConsole`, `runWithActiveConsole`                    |
| `VirtualStream`         | (Node) Virtual wrapper around `process.stdout`/`process.stderr`; exposes `targetStream`, TTY properties, `getColorDepth()`, `hasColors()` |

The main entry (`@steve02081504/virtual-console`) always exposes Node-flavoured types at compile time. At runtime it resolves to the correct platform bundle.

## Advanced

### Accurate stacks: `stackFrameSkipCount`

When your own function wraps a `console` call, the captured stack points at your wrapper instead of the real caller. Increment `stackFrameSkipCount` before delegating and restore it in `finally` to skip the extra frame:

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

Replace the three routing hooks—**resolve with fallback**, **set active console**, **run in console context**—via **`setGlobalConsoleResolver`**. Read the current hooks with **`getGlobalConsoleResolver()`** (returns **`GlobalConsoleRouting`** with **`getActiveConsole`**, **`setActiveConsole`**, **`runWithActiveConsole`**).

Node’s default wiring:

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

| Export                                                | Role                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consoleAsyncStorage`                                 | The `AsyncLocalStorage` instance that drives `hookAsyncContext` isolation. From the main entry it is typed `AsyncLocalStorage<VirtualConsole> \| undefined`; from `/node` it is always present. |
| `defaultConsole`                                      | The always-on fallback console: passes everything through to the original global `console` without recording                                                                                    |
| `console`                                             | The patched global `console` proxy—delegates all calls to whichever `VirtualConsole` is active in the current async context                                                                     |
| `globalConsoleAdditionalProperties`                   | Plain object merged onto the proxy on every access—assign properties here to extend `globalThis.console` without patching the proxy itself                                                      |
| `setGlobalConsoleResolver` / `getGlobalConsoleResolver` | Replace or read the three routing callbacks that control how the proxy resolves the active instance                                                                                             |
| `VirtualStream` (type)                                | Interface for the virtual wrappers around `process.stdout` / `process.stderr`; exposes `targetStream`, `isTTY`, `columns`, `rows`, `getColorDepth()`, `hasColors()`                             |

## Node vs browser

| Feature                                     | Node                                                           | Browser                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Async isolation                             | `AsyncLocalStorage`; all child async work is captured          | Save/restore swap; macro-tasks spawned inside `hookAsyncContext(fn)` (bare `setTimeout`, etc.) may escape |
| No-arg `hookAsyncContext()`                 | `enterWith` — scopes to the current async context              | Sets a global module variable — affects all subsequent code                                               |
| `process.stdout` / `process.stderr` capture | Yes; writes are captured as `stdout`/`stderr` level entries    | Not available                                                                                             |
| `freshLine` overwrite                       | Yes, on ANSI-capable TTYs                                      | No; behaves like a normal `log` call                                                                      |
| `write_as` with `realConsoleOutput: true`   | Routes warn/error/trace-style levels to stderr, rest to stdout | Only forwards when `base_console` is also a `VirtualConsole`                                              |
| `supportsAnsi` default                      | Auto-detected via `supports-ansi` package                      | `!!globalThis.chrome`                                                                                     |

## Security

`outputsHtml` escapes content and sanitizes `%c` styles so log output is safer to render.

```javascript
console.log('%cAttempt', '"><script>alert("xss")</script><span style="');
// Rendered HTML stays escaped / sanitized
```
