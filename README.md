# Virtual Console

[![npm version](https://img.shields.io/npm/v/@steve02081504/virtual-console.svg)](https://www.npmjs.com/package/@steve02081504/virtual-console)
[![GitHub issues](https://img.shields.io/github/issues/steve02081504/virtual-console)](https://github.com/steve02081504/virtual-console/issues)

Capture and inspect `console` output in tests, UIs, and concurrent work while keeping your existing `console.log` (and other `console` methods) calls unchanged.

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

The default entry (`.`) re-exports **`VirtualConsole`**, **`console`**, **`defaultConsole`**, **`consoleAsyncStorage`**, **`globalConsoleAdditionalProperties`**, **`setGlobalConsoleResolver`**, and **`getGlobalConsoleResolver`**. For **`renderPlain`**, **`renderAnsi`**, **`renderHtml`**, **`WireLogEntry`**, **`newLogEntry`**, **`LogEntry`**, stack/snapshot helpers, and other extended symbols, import from **`@steve02081504/virtual-console/node`** or **`@steve02081504/virtual-console/browser`**.

### Subpath entrypoints (recommended for tree-shaking)

| Subpath                                                   | Purpose                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@steve02081504/virtual-console/node` / `…/browser`       | Full platform API (`VirtualConsole`, `WireLogEntry`, `renderPlain` / `renderAnsi` / `renderHtml`, stack & snapshot helpers, etc.) + environment-accurate types. |
| `@steve02081504/virtual-console/wire/protocol`            | Log wire `type` constants + `dispatchLogWireMessage`.                                                                                                           |
| `@steve02081504/virtual-console/wire/server`              | Server-side payload helpers + `createLogWireWebSocketHandler`.                                                                                                  |
| `@steve02081504/virtual-console/wire/client`              | `connectLogWire` / `attachLogWire`.                                                                                                                             |
| `@steve02081504/virtual-console/wire/serialize-log-entry` | `serializeLogEntryForWire` only (flat DTO for WebSocket JSON: `segments`, stack metadata; no raw `args`).                                                       |

Import **`serializeLogEntryForWire`** from **`@steve02081504/virtual-console/wire/serialize-log-entry`**, or compose payloads with **`makeAppendPayload` / `makeSnapshotPayload`** from **`wire/server`**. Keep wire-related imports on dedicated **`/wire/*`** entrypoints for clearer boundaries and tree-shaken builds.

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
vc.writeAs('custom-level', 'custom payload');
vc.writeAs('trace', 'trace marker');

console.log(vc.outputEntries.map((e) => e.level));
// ['log', 'custom-level', 'debug'] — method name `'trace'` maps to semantic level `debug`
```

With `realConsoleOutput: true` on Node, `writeAs` routes warn/error/trace-style levels to stderr and the rest to stdout, similar to `console`.

### Custom indentation and depth (`dir` + `render*`)

```javascript
const vc = new VirtualConsole();

await vc.hookAsyncContext(() => {
  console.dir(
    { user: { profile: { name: 'Ada', skills: ['js', 'ts'] } } },
    { depth: 2 }, // capture-side depth hint (like native console.dir)
  );
});

const entry = vc.outputEntries[0];

// Local log entries:
const ansi = entry.toString(); // default formatting
const plain = renderPlain(entry.toSegments(), { indent: '  ', maxDepth: 1 });

// Wire entries use the same knobs:
// await wireEntry.renderPlain({ indent: '  ', maxDepth: 1 });
```

`depth` in `console.dir(value, { depth })` is preserved in the entry’s `value` segment and respected by renderers. `maxDepth` is an additional hard cap at render time; effective depth is `min(dirOptions.depth, maxDepth)`. `indent` controls multi-line indentation (default: tab).

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
| `baseConsole`       | platform default | Console used for `realConsoleOutput` passthrough. When set to another `VirtualConsole`, ANSI settings are inherited from it. Node default: the `VirtualConsole` active in the current async context; browser default: the active virtual console or `defaultConsole`. |
| `supportsAnsi`      | platform auto    | Affects `freshLine`, trace formatting, `toString()` / `toHtml()`. Node: auto-detected via `supports-ansi`; browser: `!!globalThis.chrome`. Inherited from `baseConsole` when `baseConsole` is a `VirtualConsole`.                                                     |
| `maxLogEntries`     | `Infinity`       | Drop oldest entries when exceeded                                                                                                                                                                                                                                     |

## Results API

- **`outputEntries`** — Array of captured `LogEntry` objects. Each entry exposes:
  - `level` — semantic level string after routing (`'log'`, `'warn'`, `'error'`, `'debug'`, etc.). Note: `console.trace()` and `writeAs('trace', …)` map to **`debug`** (see [Log levels](#log-levels)); use `method === 'trace'` to recognize trace-shaped entries.
  - `method` — originating console/stream method name (`'log'`, `'trace'`, `'dir'`, `'stdout'`, …). Useful when `level` alone is ambiguous (e.g. `dir` → level `log`).
  - `args` — original captured arguments in-process (`stdout` / `stderr` entries store a single-element text array)
  - `timestamp` — Unix timestamp in milliseconds when the entry was recorded
  - `stack` — parsed call-stack frames, each with `functionName`, `filePath`, `line`, `column`, and `raw`
  - `serializeArgs()` — JSON-serializable snapshots of the original arguments (depth-limited)
  - `toSegments()` — structured fragments for UI mapping (`LogSegment[]`)
  - `toString()` / `toPlainText()` / `toHtml()` — ANSI terminal text, unescaped plain text, and HTML respectively

  `console.dir()` produces **`LogEntry`** instances with `level` **`log`** and `method` **`dir`**; `toString()` / `toHtml()` render the inspected object like `console.dir`, honoring `console.dir` options (for example `depth`) when provided. For explicit render-time control, render from `toSegments()` via `renderPlain` / `renderAnsi` / `renderHtml` with `indent` / `maxDepth`.

  `console.trace()` produces **`LogEntry`** instances with `level` **`debug`** and `method` **`trace`**; `toString()` / `toHtml()` append formatted stack output after the message. They inherit `supportsAnsi` from the host `VirtualConsole` options; when true, `toString()` may embed OSC 8 hyperlink sequences for file/line references.

- **`outputs`** — Concatenation of each entry’s `toString()`: typical console-backed **`LogEntry`** rows end with `\n` per line; **`stdout`**/**`stderr`** stream-backed **`LogEntry`** rows pass through raw stream bytes without an extra delimiter.

- **`outputsHtml`** — Concatenation of each entry’s `toHtml()`. Console-backed **`LogEntry`** rows (including `dir` / `trace`) append `<br/>\n`; stream-backed **`LogEntry`** rows from **`stdout`**/**`stderr`** and raw wire line payloads do not, safe to render directly.

- **`options`** — The resolved configuration object for flags such as `recordOutput`, `realConsoleOutput`, `maxLogEntries`, etc.

- **`baseConsole`** (Node) — The effective passthrough console instance resolved from the `baseConsole` option. Readable and writable directly on the instance after construction.

- **`stackFrameSkipCount`** — When you wrap `console` calls inside your own function, increment this before the call and restore it in `finally`. This skips the extra stack frame so `entry.stack` still points at the real caller. See [example below](#accurate-stacks-stackframeskipcount).

## Methods

- **`addLogEntryListener(fn)`** / **`removeLogEntryListener(fn)`** — Register or unregister callbacks invoked synchronously for each new captured entry (including stream-backed `stdout` / `stderr` entries on Node). Multiple listeners are allowed.

- **`hookAsyncContext(callback)`** — Run a function in an isolated async context where `console` is bound to this instance; returns a `Promise` resolving to the function's return value. On Node, isolation is backed by `AsyncLocalStorage.run`, so all child async work inside the callback is captured. In the browser, a save/restore swap is used—macro-tasks spawned inside the callback (e.g. bare `setTimeout` callbacks) may not inherit the context.

- **`hookAsyncContext()`** — No-arg form: activates this instance for the rest of the current context with no automatic teardown. On Node it calls `AsyncLocalStorage.enterWith`; in the browser it sets a module-level variable that affects all subsequent code globally. Use with care.

- **`freshLine(id, ...args)`** — Print a progress line that overwrites the previous line when called again with the same `id`. Works on ANSI-capable Node TTYs; in the browser it behaves like a normal `log` call. See [example above](#progress-with-freshline).

- **`clear()`** — Clears all captured entries and resets the `freshLine` state. Then invokes **`addClearListener`** callbacks synchronously (no synthetic log entry). When `realConsoleOutput` is enabled, also calls `clear()` on the underlying console.

- **`addClearListener(fn)`** / **`removeClearListener(fn)`** — Register/unregister callbacks invoked synchronously after **`clear()`** completes (buffer empty, optional underlying `clear()` already called). Use with **`createLogWireWebSocketHandler`** / **`attachLogWire`** for remote UI sync.

- **`writeAs(level, ...args)`** — Record an entry at any log level, bypassing `console.*` method routing entirely. Useful for custom levels or injecting synthetic entries. With `realConsoleOutput: true` on Node, warn/error/trace-style levels go to stderr and everything else to stdout.

On Node, `VirtualConsole` extends the built-in `Console`. In the browser, `VirtualConsole` satisfies the `Console` interface via a declaration merge, so it can be used anywhere a `Console` is expected.

## Log levels

Semantic **`level`** (what you read on `entry.level`) vs originating **`method`** (`entry.method`):

| `entry.level`                           | Typical `entry.method` | Source                                          |
| --------------------------------------- | ---------------------- | ----------------------------------------------- |
| `log`, `info`, `warn`, `error`, `debug` | same as level          | `console.log` … `console.debug`                 |
| `debug`                                 | `trace`                | `console.trace()` → **`LogEntry`**              |
| `log`                                   | `dir`                  | `console.dir()` → **`LogEntry`**                |
| `log` / `error`                         | `stdout` / `stderr`    | `process.stdout` / `process.stderr` (Node)      |
| any string (unchanged)                  | same as level          | `writeAs(level, ...)` — `trace` → level `debug` |

`console.trace()` stacks appear in `toString()` / `toHtml()`. With ANSI on Node, file/line links may use OSC 8.

## Log wire protocol (WebSocket JSON)

Stable `type` strings live on **`logWirePayloadTypes`** (`vc_*`). Custom frames (shutdown, app events, etc.) use your own `type` plus **`extensionHandlers`** on **`dispatchLogWireMessage`** / **`attachLogWire`**; on the server, **`JSON.stringify`** your payload and **`ws.send`** it (body shape is application-defined).

| Direction                        | `type` (`logWirePayloadTypes`) |
| -------------------------------- | ------------------------------ |
| Server → client (initial list)   | `vc_log_snapshot`              |
| Server → client (one line)       | `vc_log_append`                |
| Server → client (buffer cleared) | `vc_log_cleared`               |
| Server → client (expand reply)   | `vc_expand_result`             |
| Client → server (expand request) | `vc_expand_request`            |
| Client → server (request clear)  | `vc_clear_request`             |

Wire protocol modules live on dedicated imports: **`@steve02081504/virtual-console/wire/protocol`**, **`/wire/server`**, **`/wire/client`**, and **`/wire/serialize-log-entry`**, which also keep tree-shaken builds focused.

Use **`JSON.parse`** on each inbound text frame, then **`await dispatchLogWireMessage`** (callbacks may be `async`). **`onSnapshot`** receives **`entries`**, **`onAppend`** receives **`entry`**, and **`onClear`** is a zero-arg callback. Use **`extensionHandlers`** for custom `type` values (with **`onUnknown`** as fallback). If you use **`attachLogWire`**, handle expand flows through **`requestExpand(ref, maxDepth?)`** (Promise); parsing frames manually is optional.

Use **`makeAppendPayload` / `makeSnapshotPayload` / `makeExpandResponse` / `makeExpandErrorResponse`** from **`@steve02081504/virtual-console/wire/server`** when building messages next to `VirtualConsole`.

Use **`parseClientExpandMessage`** / **`parseClientClearMessage`** for low-level frame parsing when you need to branch before full dispatch.

On the server, **`handleClientWireMessage`** handles inbound **`vc_expand_request`** and returns **`vc_expand_result`**. When a client includes `maxDepth`, it is normalized to a non-negative integer and passed to your expand handler as `(ref, maxDepth)`. For clear flows, use **`createLogWireWebSocketHandler`**, which processes inbound **`vc_clear_request`** and applies `virtualConsole.clear()`.

For Express/`ws`-style apps, **`createLogWireWebSocketHandler(virtualConsole)`** registers **`addLogEntryListener`** once, **`addClearListener`** once (broadcasts **`vc_log_cleared`** when the host **`clear()`** runs), and handles **`vc_clear_request`** from clients by calling **`virtualConsole.clear()`**.

**`connectLogWire`** / **`attachLogWire`** pass **`WireLogEntry[]`** to **`onSnapshot`**, a single **`WireLogEntry`** to **`onAppend`**, and use a zero-arg **`onClear`** callback. Import **`WireLogEntry`** from **`/wire/client`** (or from **`/node`** / **`/browser`**, which re-export the same class). After **`vc_expand_*`** resolves **`truncated`** nodes, **`await entry.renderString()`** (ANSI), **`await entry.renderPlain()`**, and **`await entry.renderHtml()`** render from the payload’s **`segments`**; each render method accepts `{ indent, maxDepth }`. Options include **`supportsAnsi`** (defaults to **`supports-ansi`** detection). The returned client handle also includes **`sendJson(obj)`** (custom uplink), **`requestClear()`** (sends **`vc_clear_request`**), **`close(code, reason)`**, and **`detach()`** (removes listeners and rejects pending `requestExpand` promises with `log_wire_detached`). For raw **`LogSegment[]`** rendering, import low-level **`renderPlain`** / **`renderAnsi`** / **`renderHtml`** from **`/node`** or **`/browser`**.

`createLogWireWebSocketHandler(virtualConsole, wireOptions)` also supports server lifecycle hooks:

- **`onClientConnected`** — called after snapshot send and registration.
- **`onClientDisconnected`** — called on `close` / `error` with reason and current client count.
- **`clientMessageHandlers[type]`** and **`onClientMessage`** — custom uplink handling for non-built-in message types; returned objects are JSON-replied to the sender.

The returned handler exposes a control plane in addition to `(ws, req) => void`:

- **`broadcastJson(payload)`** — send one custom JSON frame to all OPEN clients.
- **`forEachClient(fn)`** — iterate currently registered clients (OPEN or not).
- **`closeAllWithFinalJson(payload)`** — best-effort final broadcast + close each OPEN client, waits until close settles.

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

| Type                    | Description                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LogEntry`              | Single log entry with `level`, `method`, `args`, `timestamp`, `stack`, `serializeArgs()`, `toSegments()`; sync **`toString()`** (ANSI), **`toPlainText()`**, **`toHtml()`**                         |
| `WireLogEntry`          | Wire-side view of a JSON payload: async **`renderString()`** / **`renderPlain()`** / **`renderHtml()`** after `truncated` expansion; import from **`/wire/client`** or **`/node`** / **`/browser`** |
| `CapturedLogLevel`      | Normalized semantic `entry.level` after routing (extends built-in levels with custom strings when needed)                                                                                           |
| `WriteAsLevelArg`       | Method-style names accepted before routing (`trace`, `dir`, `stdout`, `stderr`, …)                                                                                                                  |
| `ArgSnapshot`           | JSON-serializable snapshot shape used in segments and `serializeArgs()`                                                                                                                             |
| `LogSegment`            | Discriminated union from `toSegments()` (`text`, `css`, `value`, `trace`)                                                                                                                           |
| `StackFrame`            | Single parsed stack frame: `functionName`, `filePath`, `line`, `column`, `raw`                                                                                                                      |
| `VirtualConsoleOptions` | Constructor options; platform-specific fields differ between `/node` and `/browser`                                                                                                                 |
| `GlobalConsoleRouting`  | Object shape returned by `getGlobalConsoleResolver()` — `getActiveConsole`, `setActiveConsole`, `runWithActiveConsole`                                                                              |
| `VirtualStream`         | (Node) Virtual wrapper around `process.stdout`/`process.stderr`; exposes `targetStream`, TTY properties, `getColorDepth()`, `hasColors()`                                                           |

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

| Export                                                  | Role                                                                                                                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consoleAsyncStorage`                                   | The `AsyncLocalStorage` instance that drives `hookAsyncContext` isolation. From the main entry it is typed `AsyncLocalStorage<VirtualConsole> \| undefined`; from `/node` it is always present. |
| `defaultConsole`                                        | The always-on fallback console: forwards all output directly to the original global `console`                                                                                                   |
| `console`                                               | The patched global `console` proxy—delegates all calls to whichever `VirtualConsole` is active in the current async context                                                                     |
| `globalConsoleAdditionalProperties`                     | Plain object merged onto the proxy on every access—assign properties here to extend `globalThis.console` without patching the proxy itself                                                      |
| `setGlobalConsoleResolver` / `getGlobalConsoleResolver` | Replace or read the three routing callbacks that control how the proxy resolves the active instance                                                                                             |
| `VirtualStream` (type)                                  | Interface for the virtual wrappers around `process.stdout` / `process.stderr`; exposes `targetStream`, `isTTY`, `columns`, `rows`, `getColorDepth()`, `hasColors()`                             |

## Node vs browser

| Feature                                     | Node                                                           | Browser                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Async isolation                             | `AsyncLocalStorage`; all child async work is captured          | Save/restore swap; macro-tasks spawned inside `hookAsyncContext(fn)` (bare `setTimeout`, etc.) may escape |
| No-arg `hookAsyncContext()`                 | `enterWith` — scopes to the current async context              | Sets a global module variable — affects all subsequent code                                               |
| `process.stdout` / `process.stderr` capture | Yes; writes are captured as `stdout`/`stderr` level entries    | Browser logging uses standard console method capture (`log`/`info`/`warn`/`error`/`debug`)                |
| `freshLine` overwrite                       | Yes, on ANSI-capable TTYs                                      | Browser treats `freshLine` as regular line-by-line logging                                                |
| `writeAs` with `realConsoleOutput: true`    | Routes warn/error/trace-style levels to stderr, rest to stdout | Only forwards when `baseConsole` is also a `VirtualConsole`                                               |
| `supportsAnsi` default                      | Auto-detected via `supports-ansi` package                      | `!!globalThis.chrome`                                                                                     |

## Development

```bash
npm test
```

## Security

`outputsHtml` escapes content and sanitizes `%c` styles so log output is safer to render.

```javascript
console.log('%cAttempt', '"><script>alert("xss")</script><span style="');
// Rendered HTML stays escaped / sanitized
```
