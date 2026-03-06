# Axon

> **A programming language designed for AI agents to write, and humans to read.**

[中文文档](README_ZH.md)

---

## Two Axioms

```
Compile success  →  Safety guarantee
Safety guarantee →  Immediate deployment
```

Axon is built on two non-negotiable principles:

1. **If the compiler accepts it, it is safe to run.** Not "probably safe". Not "safe unless you do X". Safe. The type system, effect system, and exhaustive pattern matching together make this possible.

2. **Safe means deployed — immediately.** A change that passes compilation can be hot-loaded into a running system without restart, without state loss, without ceremony.

These two principles, combined, mean the edit→deploy loop for an AI agent writing Axon code is: **write → compile → running**.

---

## Why a New Language?

Existing languages fail AI-agent workloads in specific ways:

| Language | Strength | Failure mode for AI agents |
|----------|----------|---------------------------|
| TypeScript | Large ecosystem, decent types | `any` escape hatches; runtime surprises; no effect tracking |
| Python | Fast to write, dynamic | Weak typing; GIL concurrency; errors only at runtime |
| Rust | Maximal safety + performance | Ownership system is hard for LLMs to reason about correctly |
| Go | Simple, concurrent | Weak type system; no algebraic types; runtime nil panics |

Axon targets a different point in the trade-off space: **maximally checkable at compile time, minimally surprising at runtime, and syntactically regular enough that an LLM can reliably generate correct code.**

Human readability is required. Human *writability* is optional — the primary author is an AI.

---

## Quick Start

**Requirements:** Node.js 18+

```bash
git clone https://github.com/your-org/axon-lang
cd axon-lang
npm install
npm run build
npm link          # makes `axon` available globally
```

```bash
axon run examples/01_hello_world.axon
axon repl
axon check myfile.axon
axon run myfile.axon --watch      # hot reload on save
axon run myfile.axon --strict-effects   # enforce effect declarations on all functions
```

---

## Language Tour

### Agents — Actors with State

Agents are the primary unit of computation. They encapsulate state and communicate exclusively through typed messages.

```axon
agent Counter {
    state {
        count: Int = 0
    }

    on Increment {
        count = count + 1
    }

    on Decrement {
        count = count - 1
    }

    on GetCount -> Int {
        count
    }

    on Reset {
        count = 0
    }
}

fn main() -> Unit {
    let c = spawn Counter
    c.send(Increment)
    c.send(Increment)
    c.send(Increment)
    let n = c.ask(GetCount)   // => 3
    c.send(Reset)
    let n2 = c.ask(GetCount)  // => 0
    print($"Count was {n}, now {n2}")
}
```

An agent is structurally similar to a class: `state` fields are instance variables, `on X` handlers are methods. `spawn` creates an instance. `send` is fire-and-forget; `ask` is request-reply (awaits the response).

### Types and Pattern Matching

```axon
type Shape =
    | Circle(radius: Float)
    | Rect(width: Float, height: Float)
    | Triangle(base: Float, height: Float)

fn area(s: Shape) -> Float {
    match s {
        Circle(r)       => PI * r * r
        Rect(w, h)      => w * h
        Triangle(b, h)  => 0.5 * b * h
    }
}
```

Matches are exhaustive — missing a variant is a compile error, not a runtime crash.

### Error Handling — No Exceptions

```axon
fn divide(a: Float, b: Float) -> Result<Float, String> {
    if b == 0.0 {
        Err("division by zero")
    } else {
        Ok(a / b)
    }
}

fn main() -> Unit {
    match divide(10.0, 3.0) {
        Ok(n)  => print($"Result: {n:.2f}")
        Err(e) => print($"Error: {e}")
    }
}
```

`Result<T, E>` and `Option<T>` are the only error mechanism. No `try/catch`, no unchecked exceptions.

### Effect System

Functions declare which effects they use. The compiler verifies declarations are complete.

```axon
// This function reads files — must declare FileIO (or the parent effect IO)
fn load_config(path: String) -> String | IO {
    let r = read_file(path)
    result_unwrap_or(r, "")
}

// Pure function — no effects, always safe to call anywhere
fn fibonacci(n: Int) -> Int {
    if n <= 1 { n } else { fibonacci(n - 1) + fibonacci(n - 2) }
}
```

**Effect sub-typing**: `FileIO ⊆ IO`, `Network ⊆ IO`, `Env ⊆ IO`. Declaring `| IO` covers all specific IO effects.

Use `--strict-effects` to enforce effect declarations on every function in a file.

### Functions and Closures

```axon
fn apply_twice(f: Int -> Int, x: Int) -> Int {
    f(f(x))
}

fn main() -> Unit {
    let double = |x: Int| x * 2
    let result = apply_twice(double, 3)   // => 12
    print(result)

    // Pipeline syntax
    let nums = [1, 2, 3, 4, 5]
    let sum  = nums
        |> list_filter(|n| n % 2 == 0)
        |> list_map(|n| n * n)
        |> list_sum()
    print(sum)   // => 20
}
```

### String Interpolation

```axon
let name = "World"
let n    = 42
let pi   = 3.14159

print($"Hello, {name}!")        // Hello, World!
print($"n = {n}")               // n = 42
print($"pi ≈ {pi:.2f}")        // pi ≈ 3.14
print($"hex: {n:x}")            // hex: 2a
print($"padded: {n:>8}")        // padded:       42
```

### Multi-Agent Orchestration

```axon
agent Worker {
    state { id: Int = 0 }

    on SetId(n: Int) { id = n }
    on Process(x: Int) -> Int { id * x }
}

fn main() -> Unit {
    let w1 = spawn Worker
    let w2 = spawn Worker
    let w3 = spawn Worker

    w1.send(SetId(10))
    w2.send(SetId(20))
    w3.send(SetId(30))

    // Send same message to all agents concurrently, collect all results
    let results = ask_all([w1, w2, w3], Process(5))
    // results: [50, 100, 150]

    // Race: return the first response
    let first = ask_any([w1, w2, w3], Process(2))
    print(results)
    print(first)
}
```

### JSON and Maps

```axon
fn main() -> Unit {
    let m = map_insert(
        map_insert(map_empty(), "name", "Axon"),
        "version", 1
    )
    let s = json_stringify(m)
    // s = '{"name":"Axon","version":1}'

    let parsed = result_unwrap(json_parse(s))
    let name = option_unwrap(json_get(parsed, "name"))
    print(name)  // Axon
}
```

### Tool Annotations

Mark functions with `#[tool]` to register them for LLM tool-use dispatch:

```axon
#[tool("Search the web and return a summary")]
fn web_search(query: String, max_results: Int) -> String | IO {
    // ... implementation
    $"results for: {query}"
}

fn main() -> Unit {
    let tools = tool_list()
    // tools: ["web_search"]

    let schema = tool_schema("web_search")
    // schema: Some({ name: "web_search", description: "...", parameters: { ... } })

    // Dispatch by name with a Map of arguments
    let args = map_insert(map_insert(map_empty(), "query", "Axon language"), "max_results", 5)
    let result = tool_call("web_search", args)
}
```

---

## What Works Today

The current implementation is a TypeScript tree-walking interpreter used to validate the language design. **All 34 tests pass.**

| Feature | Status |
|---------|--------|
| Lexer / Parser | ✅ Complete |
| Type checker (bidirectional) | ✅ Complete |
| Effect system (compile-time) | ✅ Complete |
| Effect sub-typing (FileIO ⊆ IO) | ✅ Complete |
| `--strict-effects` mode | ✅ Complete |
| Agents (spawn / send / ask) | ✅ Complete |
| ask_all / ask_any (concurrent) | ✅ Complete |
| ADTs + exhaustive pattern match | ✅ Complete |
| Closures + higher-order functions | ✅ Complete |
| `$"..."` string interpolation + format specs | ✅ Complete |
| Named arguments + default params | ✅ Complete |
| `#[Application]` entry point | ✅ Complete |
| JSON stdlib | ✅ Complete |
| File IO, env vars, HTTP | ✅ Complete |
| `#[tool]` annotation + tool_call | ✅ Complete |
| LLM integration (Anthropic API) | ✅ Complete |
| Module system | ✅ Complete |
| REPL with history | ✅ Complete |
| Hot reload (live patch, state preserved) | ✅ Complete |
| Generics (`<T>`, `<A,B>`, generic types) | ✅ Complete |
| Refinement types (`type Port = Int where self >= 1`) | ✅ Complete |
| `loop` expression + range literals (`1..=5`, `0..n`) | ✅ Complete |
| Record update (`expr with { field: val }`) | ✅ Complete |
| `if let` / `while let` pattern binding | ✅ Complete |
| `impl` blocks (methods on types, chaining) | ✅ Complete |
| `$"""..."""` interpolated triple-quoted strings | ✅ Complete |
| Algebraic effect handlers (`handle/in`) | ✅ Complete |
| Agent execution timeout (`spawn Foo timeout(ms)`) | ✅ Complete |
| Trace mode (`--trace` / `--trace-file`, JSONL) | ✅ Complete |
| Capability system (`agent requires` + `spawn with [Cap]`) | ✅ Complete |
| Channel primitives (`channel`, `chan_send/recv`, `pipeline`) | ✅ Complete |
| Trace replay (`axon replay <trace.jsonl> <program>`) | ✅ Complete |
| True OS-thread parallelism | 🔜 Planned |
| Compiled backend | 🔜 Planned |

---

## Known Limitations

These are honest descriptions of current limitations, and why they exist.

### 1. Concurrency is Cooperative, Not Parallel

Agents run on the Node.js event loop. `ask_all` is concurrent (interleaved via promises), not truly parallel (not OS threads).

**Why**: TypeScript/Node.js prototype. True parallelism requires either `worker_threads` or a compiled native backend.

**Status**: Planned for the native compilation phase.

### 5. No Inheritance

By design — not a limitation.

Axon uses **structural typing** (implicit interfaces via message compatibility), **composition**, and **effect-based contracts** instead of class inheritance. An agent that handles `on Compute(x: Int) -> Int` is compatible anywhere that message type is expected, with no explicit declaration required.

---

## Architecture

```
src/
├── lexer.ts          # Tokenizer
├── parser.ts         # Recursive descent parser → AST
├── ast.ts            # AST type definitions
├── checker.ts        # Bidirectional type checker + effect enforcer
├── interpreter.ts    # Tree-walking interpreter
├── hot_reload.ts     # File-watch → re-execution (partial implementation)
├── main.ts           # CLI entry point (run / check / repl)
└── runtime/
    ├── value.ts      # AxonValue types, AgentRef, RuntimeError
    ├── env.ts        # Lexical environment, module registry
    ├── agent.ts      # Agent spawning, Supervisor
    └── stdlib.ts     # Standard library (IO, math, string, JSON, HTTP, LLM)

spec/                 # Language specification (authoritative)
tests/axon/           # 25 passing test programs
examples/             # Runnable example programs (01–08)
  # 01 hello world · 02 types & patterns · 03 error handling
  # 04 agents · 05 hot reload · 06 AI assistant
  # 07 integration (all features) · 08 type checking demo
```

---

## Running the Tests

```bash
npm run build
# Run all tests
for f in tests/axon/*.axon; do node dist/main.js run "$f"; done
```

---

## Design Philosophy

**AI writes, humans review.** The language is optimized for LLM code generation. Syntax is regular and unambiguous. Every construct has exactly one way to express it. The grammar fits in a single page.

**Agents, not objects.** Computation is organized around message-passing actors. Shared mutable state between agents is impossible by construction.

**Effects are documentation that the compiler checks.** A function signature tells you exactly what it can do to the outside world. `| IO` means IO. `| IO, LLM` means IO and LLM calls. A pure function with no `|` annotation does neither.

**Composition over inheritance.** Axon has no class hierarchy. Behaviors are composed, not inherited. Structural typing means interfaces are implicit.

**The runtime should be boring.** No garbage collection pauses you have to tune, no lock ordering you have to reason about, no exception propagation you have to trace. The interesting invariants are enforced at compile time.

---

## Roadmap

See [NEXT_PHASE_PLAN_V2.md](NEXT_PHASE_PLAN_V2.md) for the full plan. Current priorities:

1. **Generics** — `List<T>`, `Option<T>`, `Result<T, E>` with real type parameters
2. **True hot reload** — Supervisor model: patch running agent handlers, no restart, no state loss
3. **OS-thread agents** — `worker_threads` backend for true parallelism

---

## Contributing

The language is in active design and prototype phase. The spec (`spec/`) is authoritative. If the interpreter disagrees with the spec, the spec wins.

The test suite in `tests/axon/` is the best current documentation of what actually works.

---

## Author

**[Roxzmm](https://github.com/Roxzmm)**

---

*Axon — compile success is a safety guarantee. Safety is a deployment permission.*
