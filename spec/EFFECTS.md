# Axon Effect System

> See also: `spec/PRINCIPLES.md` §Effect System for the authoritative summary.

---

## Overview

Effect annotations in Axon describe **what side effects a function is permitted to perform**.
They are **upper-bound restrictions**, not mandates.

The key insight: an annotation `| IO` means the compiler will verify this function performs
*at most* IO effects. It does not mean the function *must* perform IO.

---

## The Three Modes

### 1. Unannotated — Effect-polymorphic

```axon
fn process(data: String) -> String {
    let cleaned = trim(data)
    $"processed: {cleaned}"
}
```

An unannotated function is **effect-polymorphic**: it inherits the effect context of its caller.
It can call any function. The compiler does not restrict it.

This is appropriate for:
- General utility functions that you want usable anywhere
- `#[Application]` entry points (they run in the unrestricted Supervisor context)
- Functions called exclusively from other unrestricted contexts

### 2. Annotated — Effect-restricted

```axon
fn fetch_user(id: Int) -> Result<User, String> | IO, Network {
    let resp = http_get($"https://api.example.com/users/{id}")
    // ...
}
```

The compiler verifies that `fetch_user` uses *only* `IO` and `Network` effects.
Calling any function with effects outside `{IO, Network}` is a compile error.

### 3. Pure — No effects

```axon
#[Pure]
fn add(a: Int, b: Int) -> Int {
    a + b
}

// Equivalent explicit form:
fn add(a: Int, b: Int) -> Int | {} {
    a + b
}
```

`#[Pure]` (or empty effect set `| {}`) means the compiler verifies zero side effects.
Any call to an effectful function inside a `#[Pure]` function is a compile error.

---

## Effect Sub-typing

Effects form a hierarchy. Declaring a parent effect covers all child effects.

```
IO
├── FileIO    (file system read/write)
├── Network   (HTTP, TCP, sockets)
├── Env       (environment variables, process args)
└── LLM       (AI model API calls — also child of Network)

Random        (non-deterministic; standalone, not a child of IO)
Async         (concurrent operations)
State<S>      (named mutable state cell)
```

**Consequence**: declaring `| IO` covers `FileIO`, `Network`, `Env`, and `LLM`.
You do not need to write `| IO, FileIO, Network` — just `| IO` suffices.

```axon
// These two are equivalent:
fn do_work() -> Unit | IO { read_file("x"); http_get("y") }
fn do_work() -> Unit | IO, FileIO, Network { read_file("x"); http_get("y") }
```

---

## Effect Checking Rules

The compiler enforces effect restrictions only on **annotated** functions.

```axon
fn helper() -> Unit {
    print("log")         // ✓ — unannotated, effect-polymorphic, no restriction
    http_get("url")      // ✓ — same
}

fn restricted() -> Unit | IO {
    print("log")         // ✓ — IO declared
    http_get("url")      // ✓ — Network ⊆ IO (sub-typing)
    random()             // ✗ — Random is not a sub-effect of IO → compile error
}

#[Pure]
fn compute(x: Int) -> Int {
    x * 2               // ✓
    // print("x")        // ✗ — IO not permitted → compile error
}
```

### Effect checking with `--strict-effects`

By default, unannotated functions are not checked.
With `--strict-effects`, **all** functions are checked (unannotated treated as `| {}`).
This is the recommended mode for production code.

```bash
axon run myfile.axon --strict-effects
axon check myfile.axon --strict-effects
```

---

## Supervisor Context

The Supervisor (the runtime environment that hosts `#[Application]` functions and manages
live agents) runs in an **unrestricted effect context**. It can perform any effect.

This means `#[Application]`-marked functions and top-level statements have no effect
restrictions — they run in the Supervisor's ambient context.

```axon
#[Application]
fn serve() -> Unit {           // No | annotation needed — Supervisor context is unrestricted
    let db = connect_db()      // ✓
    let server = spawn ApiServer
    server.send(Start(db))
    print("Server started")
}
```

---

## Declaring Custom Effects (planned)

Custom effects for user-defined side-effect boundaries:

```axon
effect Database {
    query(sql: String) -> Result<Rows, DbError>
    execute(sql: String) -> Result<Int, DbError>
}

fn find_users() -> List<User> | Database {
    let rows = Database.query("SELECT * FROM users")
    // ...
}
```

Effect handlers (for testing / mocking):

```axon
// In tests: provide a mock Database implementation
handle Database {
    query(sql) => Ok(mock_rows())
    execute(sql) => Ok(0)
} in {
    let users = find_users()    // uses mock database
    assert_eq(list_len(users), 0)
}
```

---

## Built-in Effect Reference

| Effect | Sub-effects | Stdlib functions |
|--------|-------------|-----------------|
| `IO` | FileIO, Network, Env, LLM | parent of all IO |
| `FileIO` | — | `read_file`, `write_file`, `file_exists` |
| `Network` | — | `http_get`, `http_post`, `http_get_json` |
| `Env` | — | `env_get`, `env_set`, `env_all`, `args` |
| `LLM` | — | `llm_call`, `llm_structured`, `agent_tool_loop` |
| `Random` | — | `random`, `random_int`, `random_bool` |
| `Async` | — | `sleep`, async agent operations |
| `State<S>` | — | mutable state cells (planned) |
