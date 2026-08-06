# Capture, nesting, and wire

Invariants for recording/nesting and the segment wire. Read when changing capture, hop, snapshot expansion, or wire serialization.

## Nested capture

- When a recording child captures, parent and child share that entry instance (`supportsAnsi`, timestamp, lazy `stack`, and expansion refs are fixed at the capture layer).
- A non-recording child hopping to a recording parent lets the **parent** capture.

## Expansion refs

- Expansion refs are keyed by entry identity (`getExpansionScope(entry)`).
- Repeated `toSegments()` on the same truncated object reuses the same `truncated.ref`.

## Wire contract

- The in-process ↔ wire contract is `LogSegment[]`, not a class hierarchy.
