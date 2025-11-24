# Virtual Console

[![npm version](https://img.shields.io/npm/v/@steve02081504/virtual-console.svg)](https://www.npmjs.com/package/@steve02081504/virtual-console)
[![GitHub issues](https://img.shields.io/github/issues/steve02081504/virtual-console)](https://github.com/steve02081504/virtual-console/issues)

A powerful and flexible virtual console for **Node.js and the Browser** that allows you to capture, manipulate, redirect, and transform terminal output.

`VirtualConsole` acts as a smart proxy for the global `console`, providing:

- **Async Context Isolation:** Safely capture output per request or task using `AsyncLocalStorage` (Node.js) or stack-based scoping (Browser).
- **HTML Output Generation:** Automatically converts ANSI colors and console formatting (including `%c`) into HTML strings for display in web UIs or reports.
- **Zero-Refactoring:** Works by proxying the global `console`, so you don't need to change your existing logging code.

## Features

- **Universal Compatibility:** Works in both Node.js and Browser environments.
- **Output Recording:** Captures `stdout` and `stderr` to plain text (`outputs`) and **HTML** (`outputsHtml`).
- **ANSI & HTML Support:**
  - Node.js: Preserves ANSI color codes.
  - Browser/HTML: Converts ANSI codes and `%c` CSS styles to inline HTML styles.
- **Concurrency-Safe (Node.js):** Uses `AsyncLocalStorage` to guarantee that output from concurrent async operations is captured independently.
- **Real Console Passthrough:** Optionally prints to the actual console/terminal while capturing.
- **FreshLine (Updatable Lines):** Stateful method for creating overwritable lines (e.g., progress bars).
  - *Node.js:* Uses ANSI escape codes to overwrite lines.
  - *Browser:* Falls back gracefully to standard logging (simulated behavior).
- **Custom Error Handling:** Dedicated interception for `console.error(new Error(...))`.

## Installation

```bash
npm install @steve02081504/virtual-console
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

	// Run inside the hook. All console calls are routed to 'vc'.
	await vc.hookAsyncContext(() => greet('World'));

	assert.ok(vc.outputs.includes('Hello, World!'));
	assert.ok(vc.outputs.includes('Error: Something broke'));
}

test();
```

### 2. Generating HTML Output for Web UIs

One of the most powerful features is `outputsHtml`, which converts console formatting to valid HTML string.

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

// Get the captured output as HTML
const html = vc.outputsHtml;

// Result example:
// <span style="color:rgb(170,0,0)">Red Text</span>
// <span style="color: blue; font-size: 20px">Big Blue Text</span>
// ...
```

### 3. Concurrent Tasks (Node.js)

In Node.js, `VirtualConsole` uses `AsyncLocalStorage` to ensure logs from concurrent tasks don't mix.

```javascript
import { VirtualConsole } from '@steve02081504/virtual-console';

const vc = new VirtualConsole({ realConsoleOutput: true });

async function work(id, duration) {
	console.log(`Starting task ${id}`); // Captured by the specific context
	await new Promise(r => setTimeout(r, duration));
	console.log(`Finished task ${id}`);
}

await Promise.all([
	vc.hookAsyncContext(() => work('A', 100)), // Captured in context A
	vc.hookAsyncContext(() => work('B', 50)),  // Captured in context B
]);
```

## API Reference

### `new VirtualConsole(options?)`

Creates a new `VirtualConsole` instance.

- `options` `<object>`
  - `realConsoleOutput` `<boolean>`: If `true`, output is also sent to the base (real) console. **Default:** `false`.
  - `recordOutput` `<boolean>`: If `true`, output is captured in `outputs` and `outputsHtml`. **Default:** `true`.
  - `base_console` `<Console>`: The console instance to pass through to.
  - `error_handler` `<function(Error): void>`: specific handler for `console.error(err)`.
  - `supportsAnsi` `<boolean>`: Force enable/disable ANSI support (affects `freshLine`).

### `virtualConsole.hookAsyncContext(fn?)`

Hooks the virtual console into the current execution context.

- **`hookAsyncContext(fn)`**: Runs `fn` and routes all `console.*` calls inside it to this instance. Returns a `Promise` with the result of `fn`.
- **`hookAsyncContext()`**: (Advanced) Manually sets this instance as the active console for the current context.

### Properties

- **`vc.outputs`** `<string>`: Captured raw text output (includes ANSI codes in Node.js).
- **`vc.outputsHtml`** `<string>`: Captured output converted to HTML strings. Handles ANSI codes and `%c` styling.

### Methods

- **`console.freshLine(id, ...args)`**:
  Prints a line that can be overwritten by subsequent calls with the same `id`. Useful for progress bars.
  - *Node.js:* Uses ANSI cursor movements.
  - *Browser:* Simulates behavior (appends new lines).
- **`vc.clear()`**: Clears `outputs` and `outputsHtml`.
- **`vc.error(err)`**: Custom error handling if configured.

## Platform Differences

### Node.js

- Implementation relies on `node:async_hooks` (`AsyncLocalStorage`).
- Context isolation works perfectly even across `setTimeout`, `Promise`, and other async boundaries.
- `freshLine` supports real terminal cursor manipulation.

### Browser

- Implementation relies on a global variable stack strategy.
- **Scope Limitation:** `hookAsyncContext(fn)` works for the duration of the function execution. However, strict "async" context propagation (like passing context into a `setTimeout` callback) is mimicked but may not be as robust as Node.js's native hooks.
- `freshLine` cannot erase previous lines in the real browser console limitations, so it appends logs instead.

## Security Considerations

### HTML Injection Protection

`VirtualConsole` is designed to be safe for rendering console output in an HTML context. All console arguments, including those used with `%s`, `%o`, and other format specifiers, are automatically sanitized to prevent Cross-Site Scripting (XSS) attacks.

Specifically:

- **Argument Sanitization:** All string-based inputs are escaped. For example, `<script>alert(1)</script>` becomes `&lt;script&gt;alert(1)&lt;/script&gt;`. This is handled by the underlying `ansi_up` library.
- **CSS Style (`%c`) Sanitization:** When using the `%c` specifier for styling, the provided CSS string is sanitized to prevent it from breaking out of the `style` attribute. Potentially malicious characters like `<`, `>`, and `"` are escaped, ensuring that HTML cannot be injected.

Example of protection:

```javascript
// Malicious input
console.log('%cAttempting injection', '"><script>alert("pwned")</script><span style="');

// Sanitized HTML Output
// The malicious string is safely contained within the style attribute.
// <span style="&quot;>&lt;script>alert(&quot;pwned&quot;)&lt;/script>&lt;span style=&quot;">Attempting injection</span>
```

This ensures that you can safely display logs in a web UI without creating security vulnerabilities.

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
