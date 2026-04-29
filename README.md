# Virtual Console

[![npm version](https://img.shields.io/npm/v/@steve02081504/virtual-console.svg)](https://www.npmjs.com/package/@steve02081504/virtual-console)
[![GitHub issues](https://img.shields.io/github/issues/steve02081504/virtual-console)](https://github.com/steve02081504/virtual-console/issues)

Capture, isolate, and transform `console` output in **Node.js** and the **Browser** without refactoring existing logging code.

`VirtualConsole` is a drop-in proxy around the global `console` with:

- Context-aware capture (`AsyncLocalStorage` in Node.js, scoped stack strategy in Browser)
- Structured log entries (`level`, `args`, `timestamp`, `stack`)
- Plain text and HTML output (`outputs`, `outputsHtml`)
- Optional passthrough to real console while still recording logs

## Installation

```bash
npm install @steve02081504/virtual-console
```

### Imports

```javascript
// Auto-select Node.js / Browser implementation
import { VirtualConsole } from '@steve02081504/virtual-console';
```

```javascript
// Browser CDN usage
import { VirtualConsole } from 'https://esm.sh/@steve02081504/virtual-console';
```

## Quick Start

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

## Practical Examples

### 1) Generate HTML Logs for Web UIs

```javascript
const vc = new VirtualConsole();

await vc.hookAsyncContext(() => {
  console.log('\x1b[31mRed text\x1b[0m');
  console.log('%cBlue title', 'color: blue; font-size: 20px');
  console.log({ status: 'ok' });
});

// Safe HTML, ready for rendering
const html = vc.outputsHtml;
```

### 2) Keep Concurrent Node.js Tasks Isolated

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

// Each instance only contains its own task logs
console.log(vcA.outputs);
console.log(vcB.outputs);
```

### 3) Capture `process.stdout` / `process.stderr` (Node.js)

```javascript
const vc = new VirtualConsole();

await vc.hookAsyncContext(async () => {
  process.stdout.write('raw stdout\n');
  process.stderr.write('raw stderr\n');
});

console.log(vc.outputEntries.map(e => e.level));
// ['stdout', 'stderr']
```

### 4) Build Progress Lines with `freshLine`

```javascript
const vc = new VirtualConsole({ realConsoleOutput: true });

for (let i = 0; i <= 3; i++) {
  vc.freshLine('build', `Building... ${i}/3`);
  await new Promise(resolve => setTimeout(resolve, 120));
}
vc.log('Build complete');
```

In Node.js terminals, repeated `freshLine('build', ...)` updates the same line.  
In Browser consoles, it gracefully falls back to normal line appending.

### 5) Inject Custom Levels with `write_as`

```javascript
const vc = new VirtualConsole();

vc.write_as('log', 'normal');
vc.write_as('custom-level', 'custom payload');
vc.write_as('trace', 'trace marker');

console.log(vc.outputEntries.map(e => e.level));
// ['log', 'custom-level', 'trace']
```

### 6) Bound Memory with `maxLogEntries`

```javascript
const vc = new VirtualConsole({ maxLogEntries: 100 });

await vc.hookAsyncContext(() => {
  for (let i = 0; i < 500; i++) console.log(`line ${i}`);
});

console.log(vc.outputEntries.length); // 100
```

### 7) React to Every New Entry with `on_log_entry`

```javascript
const vc = new VirtualConsole({
  on_log_entry(entry) {
    if (entry.level === 'error') {
      // send alert / metrics
    }
  },
});
```

## API Reference

### `new VirtualConsole(options?)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `realConsoleOutput` | `boolean` | `false` | Also print to the base console |
| `recordOutput` | `boolean` | `true` | Store logs in `outputEntries` |
| `base_console` | `Console` | current global console | Console instance used for passthrough |
| `supportsAnsi` | `boolean` | auto-detected | Node.js only, affects `freshLine` behavior |
| `maxLogEntries` | `number` | `Infinity` | Maximum number of entries kept in memory |
| `on_log_entry` | `(entry) => void` | `null` | Synchronous callback on every appended entry |

### `vc.hookAsyncContext(fn?)`

- `vc.hookAsyncContext(fn)` runs `fn` in this console context and returns its result as a `Promise`.
- `vc.hookAsyncContext()` sets this instance as active for the current context (advanced usage).

### Core Properties

- `vc.outputEntries: LogEntry[]`
  - `entry.level: string`
  - `entry.args: unknown[]`
  - `entry.timestamp: number`
  - `entry.stack: StackFrame[]`
  - `entry.toString(): string`
  - `entry.toHtml(): string`
- `vc.outputs: string` (readonly getter, plain text)
- `vc.outputsHtml: string` (readonly getter, HTML)

### Core Methods

- `vc.freshLine(id, ...args)` updates or appends a progress-style line.
- `vc.clear()` clears all captured entries.
- `vc.write_as(level, ...args)` appends an entry directly without going through `console.*` dispatch.

### Supported Levels

| Level | Source | Environment |
| --- | --- | --- |
| `'log'`, `'info'`, `'warn'`, `'error'`, `'debug'` | `console.*` | Both |
| `'table'`, `'dir'`, `'assert'`, `'count'`, `'countReset'` | `console.*` | Both |
| `'time'`, `'timeLog'`, `'timeEnd'` | `console.*` | Both |
| `'group'`, `'groupCollapsed'`, `'groupEnd'` | `console.*` | Both |
| `'trace'` | `console.trace()` | Both |
| `'stdout'` | `process.stdout.write(...)` | Node.js only |
| `'stderr'` | `process.stderr.write(...)` | Node.js only |
| any string | `write_as(level, ...)` | Both |

## Platform Notes

### Node.js

- Uses `AsyncLocalStorage` for context isolation across async boundaries.
- Proxies `process.stdout` and `process.stderr` to the active virtual context.
- `freshLine` can overwrite terminal lines when ANSI is supported.

### Browser

- Uses scoped context switching; detached macro-tasks (for example standalone `setTimeout`) do not inherit context automatically.
- `freshLine` behaves like regular line append (no terminal cursor control).

## Security

`outputsHtml` is safe to render in HTML contexts:

- Log content is escaped.
- `%c` style strings are sanitized to prevent style-attribute injection.

```javascript
console.log('%cAttempt', '"><script>alert("xss")</script><span style="');
// Rendered output remains escaped/sanitized HTML
```

## Advanced Integration

If your framework has its own context system, bridge it with `setGlobalConsoleReflect`:

```javascript
import { setGlobalConsoleReflect } from '@steve02081504/virtual-console';

setGlobalConsoleReflect(
  (defaultConsole) => defaultConsole,            // resolve current console
  (consoleInstance) => { /* set current */ },    // set current console
  (consoleInstance, fn) => Promise.resolve(fn()) // run fn in your context
);
```
