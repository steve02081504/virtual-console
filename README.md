# Virtual Console

[![npm version](https://img.shields.io/npm/v/@steve02081504/virtual-console.svg)](https://www.npmjs.com/package/@steve02081504/virtual-console)
[![GitHub issues](https://img.shields.io/github/issues/steve02081504/virtual-console)](https://github.com/steve02081504/virtual-console/issues)

A powerful and flexible virtual console for **Node.js and the Browser** that allows you to capture, manipulate, redirect, and transform terminal output.

`VirtualConsole` acts as a smart proxy for the global `console`, providing:

- **Async Context Isolation:** Safely capture output per request or task using `AsyncLocalStorage` (Node.js) or stack-based scoping (Browser).
- **Structured Log Entries:** Every captured log is stored as a `LogEntry` object with level, arguments, timestamp, and (Node.js) call stack.
- **HTML Output Generation:** Automatically converts ANSI colors and console formatting (including `%c`) into HTML strings for display in web UIs or reports.
- **Zero-Refactoring:** Works by proxying the global `console`, so you don't need to change your existing logging code.

## Features

- **Universal Compatibility:** Works in both Node.js and Browser environments.
- **Structured Output:** Captures logs as `LogEntry[]` in `outputEntries`, with convenience getters `outputs` (plain text) and `outputsHtml` (HTML).
- **Typed Log Levels:** TypeScript users get autocomplete for known levels (`'log'`, `'warn'`, `'stdout'`, etc.) while still accepting custom strings.
- **ANSI & HTML Support:**
  - Node.js: Preserves ANSI color codes in `outputs`.
  - Browser/HTML: Converts ANSI codes and `%c` CSS styles to inline HTML styles in `outputsHtml`.
- **Concurrency-Safe (Node.js):** Uses `AsyncLocalStorage` to guarantee that output from concurrent async operations is captured independently.
- **Real Console Passthrough:** Optionally prints to the actual console/terminal while capturing.
- **FreshLine (Updatable Lines):** Stateful method for creating overwritable lines (e.g., progress bars).
  - *Node.js:* Uses ANSI escape codes to overwrite lines.
  - *Browser:* Falls back gracefully to standard logging.
- **Log Entry Limit:** Configurable `maxLogEntries` to cap memory usage.
- **Per-Entry Callback:** `on_log_entry` fires synchronously for every new entry in both environments.
- **`process.stdout`/`stderr` Redirect (Node.js):** Automatically proxied so any direct writes also respect the current async context.

## Installation

```bash
npm install @steve02081504/virtual-console
```

### Browser Import

```javascript
import { VirtualConsole } from 'https://esm.sh/@steve02081504/virtual-console';
```

## Usage

### 1. Basic Testing (Capture Output)

Wrap your function call in `hookAsyncContext` and assert the captured output.

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';
import { strict as assert } from 'node:assert';

function greet(name) {
	console.log(`Hello, ${name}!`);
	console.error(new Error('Something broke'));
}

async function test() {
	const vc = new VirtualConsole();

	await vc.hookAsyncContext(() => greet('World'));

	assert.ok(vc.outputs.includes('Hello, World!'));
	assert.ok(vc.outputs.includes('Error: Something broke'));

	// Access structured entries
	const entry = vc.outputEntries[0]
	console.log(entry.level);      // 'log'
	console.log(entry.timestamp);  // Unix ms
	console.log(entry.toString()); // 'Hello, World!'
	console.log(entry.stack);      // StackFrame[] — call stack (Node.js & Browser)
}

test();
```

### 2. Generating HTML Output for Web UIs

One of the most powerful features is `outputsHtml`, which converts console formatting to valid HTML.

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';

const vc = new VirtualConsole();

await vc.hookAsyncContext(() => {
	// ANSI Colors (Node.js style)
	console.log('\x1b[31mRed Text\x1b[0m');

	// CSS Styling (Browser style - %c)
	console.log('%cBig Blue Text', 'color: blue; font-size: 20px');

	// Objects
	console.log({ foo: 'bar' });
});

// Result example:
// <span style="color:rgb(170,0,0)">Red Text</span>
// <span style="color: blue; font-size: 20px">Big Blue Text</span>
```

### 3. Concurrent Tasks (Node.js)

In Node.js, `VirtualConsole` uses `AsyncLocalStorage` to ensure logs from concurrent tasks don't mix.

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';

const vcA = new VirtualConsole();
const vcB = new VirtualConsole();

async function work(id, duration) {
	console.log(`Starting task ${id}`);
	await new Promise(r => setTimeout(r, duration));
	console.log(`Finished task ${id}`);
}

await Promise.all([
	vcA.hookAsyncContext(() => work('A', 100)),
	vcB.hookAsyncContext(() => work('B', 50)),
]);

// vcA.outputs contains only task A's logs
// vcB.outputs contains only task B's logs
```

### 4. Capping Memory Usage with `maxLogEntries`

```javascript
const vc = new VirtualConsole({ maxLogEntries: 100 });

await vc.hookAsyncContext(() => {
	for (let i = 0; i < 200; i++)
		console.log(`Line ${i}`);
});

console.log(vc.outputEntries.length); // 100 — only the most recent 100 are kept
```

### 5. Per-Entry Callbacks with `on_log_entry`

```javascript
const vc = new VirtualConsole({
	on_log_entry: (entry) => {
		if (entry.level === 'error')
			sendAlert(entry.toString());
	}
});
```

### 6. Capturing `process.stdout` / `process.stderr` (Node.js)

Direct writes to `process.stdout` or `process.stderr` inside `hookAsyncContext` are also captured.

```javascript
const vc = new VirtualConsole({ recordOutput: true });

await vc.hookAsyncContext(async () => {
	process.stdout.write('raw stdout\n');
	process.stderr.write('raw stderr\n');
});

console.log(vc.outputEntries[0].level); // 'stdout'
console.log(vc.outputEntries[1].level); // 'stderr'
```

### 7. Writing Entries Directly with `write_as`

Bypass the normal console method chain and inject a log entry at any level.

```javascript
const vc = new VirtualConsole({ recordOutput: true });

vc.write_as('log', 'injected log');
vc.write_as('custom-level', 'special data');

console.log(vc.outputEntries[0].level); // 'log'
console.log(vc.outputEntries[1].level); // 'custom-level'
```

## API Reference

### `new VirtualConsole(options?)`

Creates a new `VirtualConsole` instance.

- `options` `<object>`
  - `realConsoleOutput` `<boolean>`: If `true`, output is also sent to the base (real) console. **Default:** `false`.
  - `recordOutput` `<boolean>`: If `true`, output is captured in `outputEntries`. **Default:** `true`.
  - `base_console` `<Console>`: The console instance to pass through to.
  - `supportsAnsi` `<boolean>`: Force enable/disable ANSI support (affects `freshLine`). **Node.js only.**
  - `maxLogEntries` `<number>`: Maximum number of log entries to keep. Oldest are dropped first. **Default:** `Infinity`.
  - `on_log_entry` `<function(LogEntry): void>`: Callback invoked synchronously each time a new entry is added (both environments).

### `virtualConsole.hookAsyncContext(fn?)`

Hooks the virtual console into the current execution context.

- **`hookAsyncContext(fn)`**: Runs `fn` and routes all `console.*` calls inside it to this instance. Returns a `Promise` with the result of `fn`.
- **`hookAsyncContext()`**: (Advanced) Manually sets this instance as the active console for the current context.

### Properties

- **`vc.outputEntries`** `<LogEntry[]>`: Array of structured log entries. Each entry has:
  - `.level` `<string>`: The method name (`'log'`, `'warn'`, `'error'`, etc.) or `'stdout'` / `'stderr'` for stream writes (Node.js).
  - `.args` `<unknown[]>`: The original arguments passed to the console method.
  - `.timestamp` `<number>`: Unix timestamp (ms) when the entry was created.
  - `.stack` `<StackFrame[]>`: Call stack at the time of logging. Available in both environments; `trace` entries have an empty array.
  - `.toString()`: Returns the formatted plain-text representation.
  - `.toHtml()`: Returns the formatted HTML representation.
- **`vc.outputs`** `<string>` *(readonly getter)*: All captured output joined as plain text.
- **`vc.outputsHtml`** `<string>` *(readonly getter)*: All captured output joined as HTML.

### Methods

- **`vc.freshLine(id, ...args)`**:
  Prints a line that can be overwritten by subsequent calls with the same `id`. Useful for progress bars.
  - *Node.js:* Uses ANSI cursor movements.
  - *Browser:* Appends a new line (cannot overwrite).
- **`vc.clear()`**: Clears `outputEntries` (and resets `outputs`/`outputsHtml`).
- **`vc.write_as(level, ...args)`**: Records a log entry with the given level without going through the normal console method chain. If `realConsoleOutput` is `true`, writes directly to `stdout`/`stderr` (Node.js) or `base_console.log` (Browser).

### Log Entry Levels

| Level | Source | Environment |
|---|---|---|
| `'log'` `'info'` `'warn'` `'error'` `'debug'` | `console.*` methods | Both |
| `'table'` `'dir'` `'assert'` `'count'` `'countReset'` | `console.*` methods | Both |
| `'time'` `'timeLog'` `'timeEnd'` | `console.*` methods | Both |
| `'group'` `'groupCollapsed'` `'groupEnd'` | `console.*` methods | Both |
| `'trace'` | `console.trace()` | Both |
| `'stdout'` | `process.stdout.write(...)` | Node.js only |
| `'stderr'` | `process.stderr.write(...)` | Node.js only |
| any string | `vc.write_as(level, ...)` | Both |

> In Node.js, `console.trace()` is captured as a `'trace'` entry. The entry's `.stack` field contains the structured call stack, and `.toString()` / `.toHtml()` append the stack text automatically.

## Platform Differences

### Node.js

- Implementation relies on `node:async_hooks` (`AsyncLocalStorage`).
- Context isolation works perfectly even across `setTimeout`, `Promise`, and other async boundaries.
- `freshLine` supports real terminal cursor manipulation via ANSI escape codes.
- `process.stdout` and `process.stderr` are proxied to always point to the current context's streams.
- Each `LogEntry` carries a `.stack: StackFrame[]` field; `file://` paths are automatically resolved to absolute paths.

### Browser

- Implementation relies on a global variable stack strategy.
- **Scope Limitation:** `hookAsyncContext(fn)` works for the duration of the synchronous/awaited execution. Context does *not* propagate into detached `setTimeout` or other macro-task callbacks.
- `freshLine` cannot erase previous lines; it appends logs instead.
- `console.trace()` produces a single `'trace'`-level `TraceLogEntry`. Its `.toString()` / `.toHtml()` append the structured `.stack` frames as readable text, matching native `console.trace` output.
- Each `LogEntry` carries `.stack: StackFrame[]`, captured at log time (same as Node.js).

## Security Considerations

### HTML Injection Protection

`VirtualConsole` is designed to be safe for rendering console output in an HTML context. All console arguments are automatically sanitized to prevent XSS attacks:

- **Argument Sanitization:** All string-based inputs are escaped. For example, `<script>alert(1)</script>` becomes `&lt;script&gt;alert(1)&lt;/script&gt;`. This is handled by the underlying `ansi_up` library.
- **CSS Style (`%c`) Sanitization:** The CSS string is sanitized to prevent it from breaking out of the `style` attribute. Characters like `<`, `>`, and `"` are escaped.

```javascript
// Malicious input
console.log('%cAttempting injection', '"><script>alert("pwned")</script><span style="');

// Sanitized HTML Output — safely contained within the style attribute:
// <span style="&quot;>&lt;script>alert(&quot;pwned&quot;)&lt;/script>&lt;span style=&quot;">Attempting injection</span>
```

## Integration for Library Authors

If you are building a library that manages its own async contexts, you can synchronize with `VirtualConsole` using:

```javascript
import { setGlobalConsoleReflect } from '@steve02081504/virtual-console';

setGlobalConsoleReflect(
	(defaultConsole) => { /* return active console */ },
	(consoleInstance) => { /* set active console */ },
	(consoleInstance, fn) => { /* run fn in context */ }
);
```
