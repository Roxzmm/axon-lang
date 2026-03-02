# Axon Hot Reload

> See also: `spec/PRINCIPLES.md` §Hot Reload Model for the authoritative summary.

---

## The Core Guarantee

**Save file → compiler accepts → running system updated. No restart. No state loss.**

This is not an approximation. It is a design requirement. Any implementation that restarts
the program, loses agent state, or requires manual intervention is incorrect.

---

## The Supervisor

The **Supervisor** is the ambient runtime context — not a class, not a library, but the
execution environment itself.

It maintains:
- `globalEnv`: all function and constant bindings, updated atomically on reload
- `liveAgents`: all running agent instances, indexed by type and ID
- `entryPoints`: the set of `#[Application]`-marked functions currently active

The Supervisor watches source files. On change:

```
File saved
  │
  ▼
Parse + Type-check new version
  │
  ├─ Fails → Report error to developer. Running system unchanged.
  │
  └─ Passes → Compute diff against running version
                │
                ▼
              Apply diff incrementally (see table below)
```

---

## Diff and Patch Rules

| What changed | Action |
|-------------|--------|
| Pure function body | Replace binding in `globalEnv`. Next call uses new version. In-flight calls complete with old version. |
| Agent handler body | For every live instance of that agent type: replace the handler entry in its `handlerMap`. Next message processed uses new version. |
| Agent state: new field | Auto-initialize with the field's default value on all live instances. |
| Agent state: field removed | Require `migrate` block. Rejected without one. |
| Agent state: field type changed | Require `migrate` block. Rejected without one. |
| New function declared | Add to `globalEnv`. Immediately available for calls. |
| New agent type declared | Register in agent registry. Available for `spawn`. Existing agents unaffected. |
| New top-level `let`/`const` | Evaluate and add to `globalEnv`. |
| `#[Application]` body changed | Incremental execution: already-executed statements are skipped (tracked by the Supervisor); new statements are executed. |
| `#[Application]` annotation removed | **Rejected.** The Supervisor keeps the entry point alive. Cannot remove a running entry point. |
| `#[NoHot]` function changed | Ignored during hot reload. The function runs once on initial load only. |

---

## Entry Points: `#[Application]`

There is no `main()` function. Any function can be an entry point.

```axon
#[Application]
fn serve() -> Unit | IO {
    let server = spawn HttpServer
    server.send(Listen(8080))
    print("Listening on :8080")
}
```

```bash
axon run server.axon            # auto-finds the single #[Application] fn
axon run server.axon::serve     # explicit entry point
axon run server.axon --watch    # hot reload mode
```

### Hot reloading `#[Application]` functions

The `#[Application]` function body is treated as a sequence of initialization statements.
The Supervisor tracks which statements have been executed.

```axon
// Version 1 — initial load
#[Application]
fn serve() -> Unit {
    let server = spawn HttpServer     // ← executed, Supervisor records: server → AgentRef#1
    server.send(Listen(8080))         // ← executed
}

// Version 2 — hot reload
#[Application]
fn serve() -> Unit {
    let server = spawn HttpServer     // ← SKIP: server already bound
    server.send(Listen(8080))         // ← SKIP: already executed
    let metrics = spawn MetricsAgent  // ← NEW: execute now → MetricsAgent spawned
    metrics.send(Start)               // ← NEW: execute now
}
```

Result: `HttpServer` continues running uninterrupted. `MetricsAgent` is added to the live system.

---

## `#[NoHot]` — Opt-out

Functions marked `#[NoHot]` run exactly once (on initial load) and are never re-executed
during hot reload.

```axon
#[NoHot]
fn init_connection_pool() -> Pool | IO {
    // Opens database connections — must not be repeated on reload
    Pool.open(config.database_url, max: 10)
}

#[Application]
fn serve() -> Unit {
    let pool = init_connection_pool()   // runs once; reload won't call this again
    let server = spawn ApiServer
    server.send(Start(pool))
}
```

---

## State Migration

When agent state structure changes, a `migrate` declaration is required.

### Adding a field (automatic — no migrate needed)

```axon
// Old
agent Worker {
    state { count: Int = 0 }
    on Work -> Int { count = count + 1; count }
}

// New — added `label` field
agent Worker {
    state {
        count: Int    = 0
        label: String = "worker"   // auto-initialized on live instances
    }
    on Work -> Int      { count = count + 1; count }
    on Label -> String  { label }
}
```

New fields with a default value are auto-initialized on all live instances. No `migrate` needed.

### Structural change (migrate required)

```axon
// Old state shape
agent Session {
    state { user_id: Int = 0 }
}

// New state shape — different type, plus new field
agent Session {
    state {
        user_id:   String = ""     // Int → String: breaking change
        logged_in: Bool   = false
    }
}

// Required migration declaration
migrate Session.state {
    from { user_id: Int }
    to   { user_id: String, logged_in: Bool }
    with |old| {
        user_id:   str(old.user_id)   // convert Int to String
        logged_in: old.user_id != 0   // infer from old state
    }
}
```

The migration function receives the old state and returns the new state.
The compiler verifies the types match.

---

## Implementation Note (Current Prototype)

The current TypeScript prototype implements a simplified version:
- `axon run --watch` re-parses and re-executes on file change
- **Does not yet implement** true Supervisor-based incremental patching
- Agent state is lost on reload in the current prototype

The correct Supervisor model is the specification. The prototype is an approximation.
Correct implementation is a priority milestone.

---

## Why No `#[hot]` Per-Function

An earlier design required developers to mark each hot-reloadable function with `#[hot]`.
This was reversed: **everything is hot-reloadable by default**.

The `#[NoHot]` annotation marks the exception (initialization code that must not repeat).
This follows the principle of encoding the uncommon case, not the common case.
