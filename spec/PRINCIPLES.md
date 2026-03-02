# Axon Design Principles

> This document is the authoritative source of Axon's design axioms.
> When any other document conflicts with this one, this one wins.

---

## Two Absolute Premises

### 1. Compile success = Safety guarantee

If the Axon compiler accepts a program, that program is safe to run.

Not "probably safe". Not "safe unless the developer does X". **Safe.**

This is enforced jointly by:
- **Static type system** — every value has a known type; no implicit coercions; no `null`
- **Exhaustive pattern matching** — every variant of every type must be handled
- **Effect system** — every side effect a function can perform is visible in its signature
- **Generics with constraints** — no `Unknown` escape hatches; type parameters must be concrete

A program that might panic at runtime cannot pass the compiler. A function that silently swallows errors cannot pass the compiler. A function that performs IO without declaring it cannot pass the compiler (when the caller has restricted effects).

### 2. Safety = Immediate deployment

A change that passes compilation is immediately hot-loaded into the running system.

- No restart
- No manual deployment step
- No state loss
- No downtime

The Supervisor (runtime context) holds the live state of the program. When source changes:
1. Compiler validates the new version
2. If validation passes, Supervisor applies the diff incrementally
3. Running agents receive updated handler logic; their state is preserved
4. If validation fails, nothing changes — the running system is unaffected

---

## One Supporting Premise

### AI writes, humans read

The primary author of Axon code is an AI language model. The primary reader is a human.

This means:
- **Syntax must be unambiguous** — every construct has exactly one parse; no context-dependent precedence traps
- **Regularity over brevity** — consistent patterns beat clever shortcuts
- **Explicit over implicit** — what a function does must be visible in its signature
- **Human readability is required** — variables, functions, types must have meaningful names
- **Human writability is optional** — verbose but correct beats concise but tricky

The grammar should fit on a single page. The type system rules should be stateable in plain English.

---

## Language Style

### Primary reference: Rust

Follow Rust conventions wherever possible:
- `fn`, `let`, `mut`, `const`, `type`, `match`, `enum`, `struct`, `impl`
- `->` for return types, `|` for effect annotations, `?` for error propagation
- `#[attribute]` syntax for annotations
- `::` for namespace resolution
- Snake_case for functions and variables, PascalCase for types and variants

### Secondary reference: C# (when Rust has no equivalent)

Current C# borrowings:
- `$"Hello {name}"` — interpolated string literals (`$` prefix marks the string as interpolated; `{expr}` inside is evaluated; uninterpolated strings treat `{` as literal)

No other style references. The language must look like one language, not three.

---

## Entry Points

There is no special `main` function.

Any function marked `#[Application]` is a valid entry point:

```axon
#[Application]
fn serve() -> Unit | IO {
    let s = spawn HttpServer
    s.send(Listen(8080))
}
```

```bash
axon run server.axon          # finds the #[Application] function
axon run server.axon::serve   # explicit entry point
axon run server.axon::test    # run a specific #[Application]-marked test fn
```

Rules:
- A file may have multiple `#[Application]` functions
- If exactly one exists, it is used automatically
- If multiple exist, the entry point must be specified explicitly
- `#[Application]` cannot be removed during hot reload (the Supervisor keeps it as the live entry)
- The function body CAN be hot-reloaded

---

## Hot Reload Model

The **Supervisor** is the ambient runtime context. It is not a library or a class — it is the execution environment itself.

The Supervisor:
- Holds the global environment (all function bindings, all live agent instances)
- Watches source files for changes
- Applies changes incrementally without program restart

### What "hot reload" means for each construct

| Construct | Hot reload behavior |
|-----------|-------------------|
| Pure function body change | Replace binding in env; next call uses new version |
| Agent handler change | Push new handler map to all live instances of that agent type; state preserved |
| Agent state: new field added | Auto-initialize with default value on all live instances |
| Agent state: field type changed | Require `migrate` declaration; rejected if absent |
| Agent state: field removed | Require `migrate` declaration; rejected if absent |
| New `let`/`const` at top level | Evaluate and add to env |
| New agent type | Available for `spawn`; existing agents unaffected |
| `#[Application]` function body | Incremental: skip already-executed statements, run new ones |
| `#[Application]` annotation removed | **Rejected** — Supervisor keeps the entry point alive |

### `#[NoHot]` — Opt-out of hot reload

```axon
#[NoHot]
fn init_database() -> Connection | IO {
    // Establishes a connection pool — must not be re-executed on reload
}
```

`#[NoHot]` functions are never re-executed during hot reload. They run once on initial load.

### State migration

```axon
agent Worker {
    state {
        count:   Int    = 0
        history: List<String> = []   // new field — auto-initialized on live instances
    }

    on Task(s: String) -> String {
        count = count + 1
        history = list_append(history, s)
        $"done #{count}"
    }
}

// Structural state change requires explicit migration
migrate Worker.state {
    from { count: Int }
    to   { count: Int, name: String }
    with |old| { count: old.count, name: "worker-${old.count}" }
}
```

---

## Effect System

### Effects are upper-bound restrictions, not mandates

An effect annotation `| E1, E2` on a function means:
> "This function may perform at most effects E1 and E2. The compiler verifies this."

An **unannotated** function is **effect-polymorphic**:
> "This function may perform any effects that its call site permits."

```axon
// Effect-polymorphic — can call anything; used freely at top-level / in Supervisor context
fn main_logic() -> Unit {
    print("hello")     // ✓ — polymorphic, inherits caller's effect context
    http_get("...")    // ✓ — same
}

// Effect-restricted — compiler verifies only IO effects are used
fn safe_log(msg: String) -> Unit | IO {
    print(msg)         // ✓ — IO declared
    // http_get("...") // ✗ — Network not declared in | IO
}

// Pure — compiler verifies no effects whatsoever
#[Pure]
fn add(a: Int, b: Int) -> Int {
    a + b              // ✓
    // print("x")      // ✗ — IO not permitted in #[Pure] functions
}
```

The **Supervisor context** is unrestricted — it can perform any effect.

### Effect sub-typing

`FileIO ⊆ IO`, `Network ⊆ IO`, `Env ⊆ IO`, `LLM ⊆ {IO, Network}`

Declaring `| IO` covers all specific IO sub-effects. Declaring `| IO, LLM` covers all of IO and LLM.

### Built-in effects

| Effect | Meaning |
|--------|---------|
| `IO` | General IO (parent of FileIO, Network, Env) |
| `FileIO` | File system read/write |
| `Network` | HTTP, TCP, socket operations |
| `Env` | Environment variables, process args |
| `LLM` | AI model API calls |
| `Random` | Non-deterministic random number generation |
| `Async` | Asynchronous / concurrent operations |
| `State<S>` | Mutation of a named state cell `S` |

---

## Type System Principles

- **No `null`** — `Option<T>` is the only way to represent absence
- **No unchecked casts** — `as` is always safe or a compile error
- **No implicit coercions** — `Int` and `Float` do not silently convert
- **Exhaustive matches** — every `match` must cover all variants
- **Generics** — all stdlib functions are properly generic; no `Unknown` escape hatches
- **Structural typing** — an agent/type satisfies an interface if it has the required message handlers or fields; no explicit `implements` declaration required
- **No class inheritance** — composition and structural typing only

---

## Agent Model

An agent is an actor with encapsulated state and typed message handlers.

```axon
agent Counter {
    state {
        count: Int = 0
    }

    on Increment           { count = count + 1 }
    on Decrement           { count = count - 1 }
    on GetCount -> Int     { count }
    on Reset               { count = 0 }
}

let c = spawn Counter
c.send(Increment)               // fire-and-forget
let n = c.ask(GetCount)         // request-reply
```

Key rules:
- Agents share **no mutable state** — all communication is via message passing
- `send` is non-blocking; `ask` awaits a reply
- Multiple agents of the same type are independent instances
- Agents are hot-reloadable: handler logic updates without losing state

---

## What Axon is NOT

- **Not a general-purpose language** trying to compete with Rust or Go on raw performance
- **Not an AI-specific language** with LLM APIs baked into the syntax — those are library concerns
- **Not a scripting language** — correctness guarantees require a compiler pass
- **Not object-oriented** — no classes, no inheritance, no `this`

Axon is a language for building reliable, long-running, AI-driven agent systems where correctness is non-negotiable and deployment must be frictionless.
