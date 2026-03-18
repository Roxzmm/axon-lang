# Axon Language Specification

> **Version**: 0.6.1  
> **Last Updated**: 2026-03-17  
> **Status**: Active development — TypeScript interpreter, 54 tests passing

For detailed specification, see `spec/LANGUAGE_SPEC_ZH.md` (Chinese).

---

## Quick Reference

### Types
- `Int` (bigint), `Float`, `Bool`, `String`, `Char`, `Unit`
- `List<T>`, `Tuple<T1, T2>`, `{ field: T }`
- `fn(T) -> R`, `Option<T>`, `Result<T, E>`

### Variables
```axon
let x = 42           // immutable
let mut y = 0       // mutable
```

### Functions
```axon
fn add(a: Int, b: Int) -> Int => a + b
let add = |a, b| a + b  // lambda
```

### Control Flow
```axon
if condition { } else { }
match value { pattern => expr }
while condition { }
for x in list { }
```

### Agents
```axon
agent Counter {
  state { count: Int = 0 }
  on Increment -> Int { count = count + 1; count }
}
spawn Counter
send counter { Increment }
let result = ask counter { Get }
```

### Effects
```axon
effect IO {
  print(msg: String) -> Unit
}
handle io = IO { print(msg) { ... } }
```

### Modules
```axon
use std.list
use std.io as io
module MyModule
pub fn public_fn() -> Unit { }
```

---

## Operators

| Category | Operators |
|----------|-----------|
| Arithmetic | `+`, `-`, `*`, `/`, `%`, `**` |
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Logical | `&&`, `||`, `!` |
| Other | `->`, `=>`, `..`, `..=`, `@`, `\|`, `:` |

---

## Keywords

```
fn, let, mut, const, if, else, match, for, while, loop,
break, continue, return, module, use, type, trait, impl,
agent, spawn, send, ask, state, on, effect, handle,
pub, priv, as, is, in, where, with, spawn_parallel
```

---

## CLI Commands

```bash
axon run <file>        # Run program
axon test [dir]        # Run tests
axon check <file>      # Type-check only
axon compile <file>    # Compile to bytecode
axon compile --wasm   # Compile to WebAssembly
axon fmt <file>       # Format code
axon repl             # Interactive REPL
```

---

## See Also

- `spec/ARCHITECTURE.md` - System architecture
- `spec/TYPE_SYSTEM.md` - Type system details
- `spec/AGENT_MODEL.md` - Agent model
- `spec/EFFECTS.md` - Effect system
- `spec/HOT_RELOAD.md` - Hot reload
- `spec/GRAMMAR.ebnf` - Formal grammar
- `spec/PRINCIPLES.md` - Design principles
- `spec/LLM_CODING_GUIDE.md` - AI coding guide
