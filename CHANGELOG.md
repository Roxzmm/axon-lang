# Changelog

All notable changes to Axon are documented here.

Format: [Semantic Versioning](https://semver.org) — `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking language or API changes
- **MINOR**: New features, new stdlib functions, new CLI flags
- **PATCH**: Bug fixes, documentation corrections, internal refactors

---

## [0.4.1] - 2026-03-06

### Language — Agent Execution Timeout (`spawn Agent timeout(ms)`)

Agents can now be spawned with a per-handler execution timeout:

```axon
let agent = spawn Worker timeout(5000)  // 5-second handler timeout
let result = agent.ask(SlowTask(data))  // RuntimeError if handler > 5000ms
```

**Semantics:**
- `timeout(ms)` specifies the maximum allowed duration for a single message handler
- Timeout is applied via `Promise.race` on each message dispatch in `drainQueue()`
- If the handler exceeds the timeout, the message is rejected with `Error("timeout")`
- The supervisor's `onCrash` callback is triggered (same path as handler crashes)
- Agents without `timeout(...)` behave as before (no change)
- `spawn Agent` and `spawn Agent timeout(ms)` are both valid syntax

### Standard Library — `sleep_ms(ms)`
- `sleep_ms(ms: Int) -> Unit | Async` — async sleep for `ms` milliseconds (uses `setTimeout`)
- Available for use in agents and async functions

### Implementation
- **Lexer**: `KwTimeout = 'timeout'` keyword added
- **AST**: `Spawn` expr gains `timeout: Expr | null` field
- **Parser**: `parsePrimary()` Spawn case: optionally parse `timeout(expr)` on same line
- **Interpreter**: Spawn evaluates timeout expr, passes `timeoutMs` to `AgentRef` constructor
- **value.ts (AgentRef)**: `timeoutMs: number | null` field; `drainQueue()` wraps handler in `Promise.race` when set
- **stdlib.ts**: `sleep_ms` added as async native function
- **checker.ts**: `sleep_ms` registered in known names

### Tests
- Added test 36: `36_agent_timeout.axon` — fast agent with generous timeout, no-timeout agent, fast handler within tight timeout, slow handler within generous timeout, `sleep_ms` accuracy; all 36 tests pass

---

## [0.4.0] - 2026-03-06

### Language — Algebraic Effect Handlers (`handle/in`)

New `handle Effect { ... } in { ... }` expression for intercepting effectful function calls:

```axon
let result = handle IO {
  read_file: |path| { $"mock:{path}" },
  write_file: |path, content| { Ok(()) }
} in {
  some_function_that_does_io()  // read_file/write_file intercepted here
}
```

**Semantics:**
- Handlers are pushed to an interpreter-level stack on entry; popped on exit
- `evalIdent` checks handler stack (innermost first) before env/stdlib lookup
- Enables **dynamic scoping** of effects: transitive calls are also intercepted
- Nested `handle` blocks work correctly (inner handler shadows outer)
- Handler expressions may be lambdas, stored variables, or any expression
- Handler closures capture surrounding lexical scope normally

**Use cases:**
- Mock IO/Network/LLM during testing without modifying tested functions
- Provide deterministic stubs for non-deterministic effects
- Intercept and log/trace all calls to specific functions in a scope

### Implementation
- **Lexer**: `KwHandle = 'handle'` keyword added
- **AST**: `HandleExpr { effect, handlers[], body }` added to `Expr` union
- **Parser**: `parsePrimary()` handles `handle Ident { name: expr, ... } in { body }`
- **Interpreter**: Handler stack (`handlerStack: Map<string,AxonValue>[]`) checked in `evalIdent` before env/stdlib lookup; push/pop via `try/finally` in `HandleExpr` eval
- **Checker**: Checks all handler exprs and body; handler names visible as `Unknown` type in body env

### Tests
- Added test 35: `35_effect_handlers.axon` — 6 scenarios: basic override, multiple handlers, nested handlers, closure capture, lambda variable, block logic in handler body; all 35 tests pass

---

## [0.3.0] - 2026-03-03

### Lexer
- `$"""..."""` — interpolated triple-quoted strings now support `{expr}` interpolation
  (previously `$"""..."""` treated `{` as literal; now consistent with `$"..."`)
- `"""..."""` non-interpolated triple-quoted strings unchanged

### Standard Library — Map (new functions)
- `map_update(m, key, fn) -> Map` — update value at key by applying fn to existing value (Unit if missing)
- `map_merge(a, b) -> Map` — merge two maps; b's keys override a's
- `map_filter(m, fn) -> Map` — keep only entries where `fn(key, value)` returns true (higher-order)
- `map_from_keys(keys, default) -> Map` — create map from list of keys, all with same default value

### Tests
- Added test 34: `34_multiline_and_maps.axon` — covers `$"""` interpolation, map_update, map_merge, map_filter, map_from_keys; all 34 tests pass

---

## [0.2.9] - 2026-03-03

### Standard Library

#### List (new functions)
- `list_index_of(list, item) -> Option<Int>` — first index of matching item
- `list_min(list) -> Option<T>` — minimum value (None for empty)
- `list_max(list) -> Option<T>` — maximum value (None for empty)
- `list_product(list) -> Int|Float` — product of all elements (1 for empty)
- `list_sorted(list) -> List` — sorted copy using default ordering
- `list_count(list, pred) -> Int` — count elements matching predicate
- `list_partition(list, pred) -> (List, List)` — split into (matching, non-matching)
- `list_sum_by(list, fn) -> Int|Float` — sum after applying extractor function
- `list_group_by(list, fn) -> Map` — group elements by key function result

#### String (new functions)
- `string_find(s, sub) -> Option<Int>` — first index of substring
- `string_pad_start(s, width, fill) -> String` — left-pad to width
- `string_pad_end(s, width, fill) -> String` — right-pad to width
- `string_count(s, sub) -> Int` — count non-overlapping occurrences

#### Math (new functions)
- `random() -> Float` — uniform random in [0, 1)
- `random_int(lo, hi) -> Int` — random integer in [lo, hi)
- `sign(n) -> Int|Float` — sign of a number (-1, 0, 1)
- `trunc(n) -> Int` — truncate toward zero
- `fract(n) -> Float` — fractional part

### Tests
- Added test 33: `33_stdlib_expanded.axon` — covers all new functions; all 33 tests pass

---

## [0.2.8] - 2026-03-03

### Parser
- `impl TypeName { fn method(self, ...) -> T { ... } }` — method definitions on named types
- Methods parsed as regular `FnDecl` inside the impl block; `pub` visibility supported per method

### Interpreter
- `methodRegistry: Map<typeName, Map<methodName, AxonValue>>` stores impl methods
- Dispatch priority: agent ops > record field callable > `methodDispatchName` > String methods > **impl methods** > generic defaults (`len`, `to_string`, etc.) > free function fallback
- impl methods receive `obj` as first argument (bound to `self` param)
- Method chaining works: each method returns a new value of the same type; dispatch is via the returned value's `typeName`
- Hot reload: `ImplDecl` re-registers methods (old methods overwritten, new ones added)
- `registerImpl()` also called from `registerTopLevel()` so REPL can define impl blocks

### Type Checker
- `checkTopLevel()` handles `ImplDecl`: type-checks each method body via `checkFn()`
- Methods are NOT registered as global names (they are dispatched by typeName, not identifier)

### Tests
- Added test 32: `32_impl_methods.axon` — Point.distance/scale/translate/magnitude/to_str, method chaining, Rect.area/perimeter/contains; all 32 tests pass

---

## [0.2.7] - 2026-03-03

### Parser
- `if let Pat = Expr { ... } else { ... }` — pattern-matching conditional; bindings scoped to the `then` branch
- `else if let ...` chains work correctly (recursive `parseIf`)
- `while let Pat = Expr { ... }` — loop that breaks when pattern fails to match; supports `break`/`continue`

### Interpreter
- `IfLet` expr: evaluates to then-branch value on match, else-branch (or `Unit`) on no-match
- `WhileLetStmt`: re-evaluates value each iteration, creates fresh child env per iteration for pattern bindings

### Type Checker
- Added `IfLet` case (checks value, then, else_ in correct scopes)
- Added `WhileLetStmt` case

### Tests
- Added test 31: `31_if_let_while_let.axon` — covers Option/Result/ADT patterns, chained `else if let`, `while let` list drain and countdown; all 31 tests pass

---

## [0.2.6] - 2026-03-03

### Parser
- `loop` is now an expression (not just a statement): `let x = loop { break 42 }` works
- `LoopStmt` removed from AST/parser/interpreter/checker — `loop` always produces `Loop` expr wrapped in `ExprStmt`
- Range literals: `1..=5` (inclusive) and `0..n` (exclusive) produce `List<Int>` — usable in `for` loops and pipelines
- Record update syntax: `expr with { field: val, ... }` — produces updated copy, original unchanged
  - Guard: only parsed when `with` is on same line as preceding expression (prevents ambiguity)
  - Range `hi` bound parsed with `parsePostfix()` (not just `parsePrimary`), so `1..foo()` and `1..arr[0]` work

### Type Checker
- Added `Loop` and `Range` expression cases (both return `T_UNKNOWN`)

### Tests
- Added test 30: `30_loop_range_record_update.axon` — covers loop-as-expr, inclusive/exclusive ranges, ranges in `for` and pipelines, record update single and multi-field

---

## [0.2.5] - 2026-03-03

### Parser
- Refinement type syntax: `type Foo = BaseType where predicate` now parses correctly
- Fixed: bare uppercase identifier followed by `where` or `<` no longer incorrectly enters the Enum parse branch (was a latent parser bug for alias types like `type Foo = Bar`)

### Type Checker
- `Refine` TypeDef is treated as `Unknown` (no false errors)

### Interpreter
- Refinement types create a namespace Record with `new` and `refine` callable fields:
  - `TypeName.new(value)` → `Result<T, String>` — validates predicate at runtime
  - `TypeName.refine(value)` → alias for `new`
  - Predicate evaluated with `self` bound to the value being checked
- Record fields that are callable functions can now be invoked as method calls: `rec.field(args)` — enables the namespace pattern for type constructors
- Added test 29: `29_refinement_types.axon` — covers PositiveInt, Port, Email, Percentage, compound predicates, Result chaining

---

## [0.2.4] - 2026-03-03

### Interpreter — True Hot Reload
- `hotReload()` now handles all top-level item kinds:
  - `FnDecl`: updates function body in `globalEnv` (was already working)
  - `AgentDecl`: patches handler maps on all live agent instances while **preserving state** (was already working)
  - `ConstDecl`: evaluates and adds/updates constant in `globalEnv` (new)
  - `#[Application]` fn: **incremental execution** — only statements added since the last run are executed (new); existing statements are skipped to avoid duplicate side effects
- Agent state: new fields added in a reloaded agent declaration are **auto-initialized** with their default values on all live instances (new)
- Added `interpreter_hot_reload(src: String)` builtin for testing: parses a source string and applies hot reload — enables Axon-level tests for reload semantics
- Removed stale README description: hot reload was already doing live patching (not file-restart), not losing agent state
- Added test 28: `28_hot_reload.axon` — verifies function update, handler patch with state preservation, new state field auto-init, multi-instance consistency
- Registered `interpreter_hot_reload` in type checker

---

## [0.2.3] - 2026-03-03

### Type Checker
- Implemented generics: type parameters (`<T>`, `<A, B>`, etc.) on functions and type declarations
  now correctly scope to `Unknown` instead of emitting false type errors
- Save/restore pattern ensures type parameter sets are isolated per declaration (no cross-leaks)
- Generic user-defined types (`type Wrapper<T> { Inner(T) }`) now parse and check without errors
- Stdlib generic types (`Option<T>`, `Result<T,E>`, `List<T>`) work without annotation errors
- Added test 27: `27_generics.axon` — 37 assertions covering generic fns, list ops, custom types,
  and stdlib generics with `Option`, `Result`, `List`

---

## [0.2.2] - 2026-03-02

### Interpreter
- Implemented `#[Application]` as entry point — `axon run` now uses `#[Application]`-annotated
  function as the program entry point; `main()` remains as fallback for backward compatibility
- `#[Application]` takes priority over `main()` when both are present in a file
- Module files loaded via `use` never run their entry points (both `#[Application]` and `main`)
- Added test 26: `26_application_annotation.axon`

---

## [0.2.1] - 2026-03-02

### Interpreter
- Implemented `$"..."` string interpolation syntax in the lexer — breaking change that brings the interpreter in sync with the spec
  - `$"Hello, {name}!"` → interpolated string (expr inside `{...}` evaluated)
  - `"Hello, {name}!"` → plain literal string (`{` is literal text)
- Updated all 25 tests and examples to use `$"..."` where interpolation is required
- Removed "Known Limitation #1" from README — interpolation is now spec-compliant

---

## [0.2.0] - 2026-03-02

### Language & Spec
- Defined `$"..."` string interpolation syntax (C# `$` prefix + Rust `{expr:spec}` inside)
  — regular strings `"..."` treat `{` as literal (spec only; interpreter update pending)
- Replaced `main()` with `#[Application]` annotation — any function can be an entry point
- Replaced `#[hot]` opt-in with `#[NoHot]` opt-out — everything is hot-reloadable by default
- Added `spec/PRINCIPLES.md` as authoritative design axioms document
- Rewrote `spec/EFFECTS.md`: three modes (polymorphic / restricted / `#[Pure]`)
- Rewrote `spec/HOT_RELOAD.md`: Supervisor model with full diff/patch rules table
- Updated `spec/LANGUAGE_SPEC.md` to v0.2

### Interpreter & Type Checker
- Effect sub-typing hierarchy: `FileIO ⊆ IO`, `Network ⊆ IO`, `Env ⊆ IO`, `LLM ⊆ {IO, Network}`
- `--strict-effects` flag: enforces effect declarations on all functions (not just annotated ones)
- `#[tool("desc")]` annotation: auto-registers functions with JSON Schema in `toolRegistry`

### Standard Library
- `tool_call(name, args_map)` — dispatch registered `#[tool]` function by name
- `agent_tool_loop(prompt, tools, max_turns?)` — ReAct loop (LLM ↔ tool calls)
- `llm_structured(prompt, schema, model?)` — LLM with JSON Schema output + retry
- `ask_all(agents, msg)` — concurrent send to all agents, await all results
- `ask_any(agents, msg)` — concurrent send to all agents, return first result
- `json_parse`, `json_stringify`, `json_stringify_pretty`, `json_get`
- `http_get`, `http_post`, `http_get_json` (Node.js `https` module, no external deps)
- `env_get`, `env_set`, `env_all`, `args`
- `llm_call(prompt, model?)` — uses `ANTHROPIC_API_KEY` env var
- Format spec extended: alignment (`<>^`), fill char, sign (`+`), comma (`,`), bases (`b/x/o/e`)

### Tests
- 25 tests passing (up from 15 in v0.1.0)
- Added tests 16–25: named args, JSON, format extensions, file I/O, env vars,
  tool annotations, effect checking, supervisor/concurrent agents, ask_all/ask_any

### Project
- Added `README.md` (English) and `README_ZH.md` (Chinese)
- Added `LICENSE` (MIT)
- Added `.editorconfig`
- Added `.github/workflows/ci.yml` (GitHub Actions: Node 18/20/22)
- Added `.github/ISSUE_TEMPLATE/` and `PULL_REQUEST_TEMPLATE.md`
- Git history: all commits attributed to Roxzmm with GitHub noreply email

---

## [0.1.0] - 2026-02-28

### Initial prototype

- Lexer, parser, AST (recursive descent)
- Bidirectional type checker
- Effect system (compile-time, explicit annotation)
- Effect sub-typing (`FileIO ⊆ IO`) — basic version
- Tree-walking interpreter
- Agent model: `spawn`, `send`, `ask`, handler maps, encapsulated state
- ADT + exhaustive pattern matching
- Closures + higher-order functions
- String interpolation `{expr}` (old syntax)
- Named parameters + default parameters
- Module system: `use Lib.ModuleName` → `lib/module_name.axon`
- REPL with history, `:env`/`:type`/`:load`/`:help` commands
- `axon run` / `axon check` / `axon repl` CLI
- `axon run --watch` (file-restart hot reload, prototype)
- 15 tests passing (arithmetic, strings, lists, patterns, closures, control flow,
  recursion, errors, agents, higher-order functions, maps, custom types,
  iterators, real-world patterns, modules)
