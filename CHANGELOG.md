# Changelog

All notable changes to Axon are documented here.

Format: [Semantic Versioning](https://semver.org) — `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking language or API changes
- **MINOR**: New features, new stdlib functions, new CLI flags
- **PATCH**: Bug fixes, documentation corrections, internal refactors

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
