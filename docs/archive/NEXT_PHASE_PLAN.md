# Axon Language — Feature Comparison, Gap Analysis & Implementation Roadmap
# 对比 Rust/Python/TypeScript，差距分析与下一阶段规划

> 由 Claude Opus 4.6 生成 · 2026-03-02

---

## Section 1: Feature Comparison Matrix

### Axon (current v0.1) vs Rust vs Python vs TypeScript

| Feature Area | Axon (Current v0.1) | Rust | Python | TypeScript |
|---|---|---|---|---|
| **Type System** | | | | |
| Static vs Dynamic | Static in spec, runtime checks in impl | Static, strict | Dynamic (optional hints) | Static (structural) |
| Type Inference | Spec: HM; Impl: minimal checker with `Unknown` fallback | Full HM + borrow checker | N/A (gradual via mypy) | Local inference, structural |
| Generics | Spec: Yes; **Impl: NOT ENFORCED** | Monomorphized generics | None (duck typing) | Full generics with constraints |
| ADTs / Sum Types | **YES — implemented** (parser + interpreter + pattern matching) | `enum` with variants | No (simulated) | Discriminated unions |
| Refinement Types | Spec: Yes; **Impl: NOT IMPLEMENTED** | No (newtype pattern) | No | No |
| Linear/Affine Types | Spec: Yes; **Impl: NOT IMPLEMENTED** | Ownership + borrow checker | No | No |
| Trait System | Spec: Yes; **Impl: NOT IMPLEMENTED** | Full trait system | Protocols (ABC) | Interfaces |
| **Error Handling** | | | | |
| Model | Result/Option + `?` operator **(implemented)** | Result/Option + `?` | Exceptions | Exceptions (try/catch) |
| Exhaustiveness | Spec: yes; Impl: runtime fallthrough only | Compile-time exhaustiveness | N/A | No |
| **Concurrency** | | | | |
| Model | Agent/Actor **(implemented — but synchronous)** | async/await + threads + channels | asyncio + threads + GIL | async/await + event loop |
| Green Threads | Spec: Yes; **Impl: single-threaded JS event loop** | tokio tasks | coroutines | Promises |
| Channels | Spec: CSP channels; **NOT IMPLEMENTED** | mpsc, crossbeam | asyncio.Queue | No native channels |
| Structured Concurrency | Spec: Yes; **NOT IMPLEMENTED** | tokio::JoinSet | trio/anyio | No |
| Supervision Trees | Spec: Yes; **Impl: skeleton, no restart logic** | No built-in | No | No |
| **Standard Library** | | | | |
| Breadth | ~120 built-in functions (IO, strings, lists, maps, math, JSON, HTTP, env, LLM) | Massive | Extremely broad | Moderate std, huge npm |
| Collections | List, Map (immutable), Tuple — all working | Vec, HashMap, BTreeMap… | list, dict, set, tuple | Array, Map, Set |
| Networking | `http_get`, `http_post`, `http_get_json` (async, Node.js built-in) | reqwest, hyper | urllib, requests | fetch, node:http |
| JSON | `json_parse`, `json_stringify`, `json_get` **(implemented)** | serde_json | json module | JSON.parse/stringify |
| **Tooling** | | | | |
| Package Manager | Spec: `axon.toml`; **NOT IMPLEMENTED** | cargo (world-class) | pip/poetry/uv | npm/yarn/pnpm |
| LSP / IDE Support | **NOT IMPLEMENTED** | rust-analyzer | pylsp, pyright | tsserver (excellent) |
| Debugger | **NOT IMPLEMENTED** (runtime errors have file:line:col) | gdb/lldb + IDE | pdb, IDE debuggers | Chrome DevTools, IDE |
| Formatter | **NOT IMPLEMENTED** | rustfmt | black/ruff | prettier |
| Linter | Type checker catches basic Int+String mismatches | clippy | ruff/pylint | eslint |
| REPL | **YES — full-featured** (history, multi-line, `:env`, `:type`, `:load`) | No official | YES (excellent) | ts-node, deno |
| Test Framework | `assert`/`assert_eq`/`assert_ne` built-in; 19 test files | cargo test | pytest/unittest | jest/vitest |
| **AI/Agent-Specific** | | | | |
| LLM Integration | `llm_call()` built-in (Anthropic API) **(implemented)** | None | Via libraries | Via libraries |
| Agent Model | First-class `agent` keyword with `state`, `on`, `spawn`, `.send`, `.ask` **(implemented)** | None | None | None |
| Tool Calling | Spec: `#[tool]` annotation; **NOT IMPLEMENTED** | None | Via frameworks | Via frameworks |
| Capability/Sandbox | Spec: `capability` + `requires`; **NOT IMPLEMENTED** | None | None | None |
| Hot Reload | Spec: `#[hot]` + `migrate`; Impl: basic skeleton in `hot_reload.ts` | None native | importlib.reload | HMR |
| Effect System | Spec: Full algebraic effects; **Impl: parsed but NOT ENFORCED** | No (traits simulate) | None | None |
| **Performance** | | | | |
| Execution Model | Tree-walking interpreter on Node.js | Compiled to native | CPython bytecode interp | V8 JIT |
| Speed (relative) | Very slow (~100-1000x slower than Python) | Fastest (native) | Medium | Fast (V8 JIT) |
| Memory | JS heap + BigInt for all integers | Manual/RAII, zero-cost | GC | GC (V8) |

### Key Insight
Axon's **spec** is ambitious and well-designed. The **implementation** is a tree-walking interpreter prototype where ~40% of the spec features are actually enforced. The type checker catches only basic mismatches; nearly everything resolves to `T_UNKNOWN`.

---

## Section 2: Critical Gaps (Top 15)

| # | Gap | Severity | Effort | Notes |
|---|-----|----------|--------|-------|
| 1 | **No generics enforcement** — type params parsed but ignored | Critical | L | Core type system feature |
| 2 | **Effect system not enforced** — `\| IO, Async` is a comment | Critical | L | Headline feature has zero enforcement |
| 3 | **No trait system** — `trait`/`impl` not parseable or implementable | Critical | XL | Required for polymorphism |
| 4 | **Type checker is mostly T_UNKNOWN** — almost no real inference | Critical | L | Checker catches `Int + String` but little else |
| 5 | **No package manager** — `axon.toml` spec exists, no impl | High | XL | Impossible to share/reuse code |
| 6 | **Performance: tree-walking interpreter** — orders of magnitude slow | High | XL | Need bytecode compiler or transpiler |
| 7 | **No LSP / IDE integration** — no syntax highlighting, no autocomplete | High | L | Critical for developer experience |
| 8 | **Capability system not implemented** — core security model for AI agents | High | M | `requires`/`capability` are spec-only |
| 9 | **Supervision trees incomplete** — no restart logic, no max-restart policy | High | M | Agents die silently |
| 10 | **Agents are synchronous** — `.ask()` calls handler directly, blocking caller | High | L | Agents should run concurrently |
| 11 | **No `#[tool]` calling** — key AI differentiation feature is missing | Medium | M | LLM can't invoke Axon functions as tools |
| 12 | **No formatter / linter** — no `axon fmt` or `axon lint` | Medium | M | Reduces developer confidence |
| 13 | **No `with` statement** — linear types spec, no impl | Medium | M | RAII-like resource management absent |
| 14 | **Module system is limited** — no re-exports, no visibility enforcement | Medium | S | `pub`/`priv`/`internal` parsed but not enforced |
| 15 | **No tail-call optimization** — spec promises TCO, uses JS call stack | Low | M | Recursion limited by JS stack (~10k calls) |

---

## Section 3: Prioritized Implementation Roadmap

### Phase A: Foundation Fixes (~2 weeks)

#### A1. Effect System Enforcement in the Type Checker ⬅ IMMEDIATE PRIORITY
- **Files**: `src/checker.ts`
- **What**: Track declared effects per function. When a function calls an effectful function without declaring that effect, emit a diagnostic.
- **Hints**: Track `currentEffects: Set<string>` in checker state. On `Call` node, check callee's effects are subset of current function's declared effects. Pure functions have empty effect set.
- **Tests**: `tests/axon/20_effects_basic.axon`, `tests/axon/21_effects_propagate.axon`

#### A2. Type Variable Unification (Real Generics)
- **Files**: `src/checker.ts`
- **What**: Replace `Unknown` fallback with unification for generic functions. Add `freshVar()`, `unify(t1, t2)`, `substitute(t, subst)`.
- **Hints**: Union-find data structure. Instantiate fresh type vars for each generic function call. Start with single-type-param generics.
- **Tests**: `tests/axon/22_generics_basic.axon`, `tests/axon/23_generics_list.axon`

#### A3. Supervision Trees with Restart Logic ⬅ IMMEDIATE PRIORITY
- **Files**: `src/runtime/agent.ts`, `src/runtime/value.ts`
- **What**: Supervisor with `OneForOne` strategy, `maxRestarts`, `restartWindow`. Store spawn config for re-spawn.
- **Tests**: `tests/axon/24_supervisor.axon`

#### A4. Async Agent Message Queue (Concurrent Agents) ⬅ IMMEDIATE PRIORITY
- **Files**: `src/runtime/value.ts`, `src/runtime/agent.ts`
- **What**: Replace synchronous `ask()` with async mailbox queue. Agents process messages independently. Use `queueMicrotask` for interleaving.
- **Tests**: `tests/axon/25_concurrent_agents.axon`

---

### Phase B: Language Completeness (~4 weeks)

#### B1. Trait System (Basic)
- **Files**: `src/ast.ts`, `src/parser.ts`, `src/interpreter.ts`, `src/checker.ts`
- **What**: `trait Name { fn method(self, ...) -> T }` + `impl Trait for Type { ... }`
- **Start with**: `Show`, `Eq`, `Ord` traits. Method resolution: look up `(typeof obj, method)` in trait impl registry.
- **Tests**: `tests/axon/26_traits_basic.axon`, `tests/axon/27_traits_constraint.axon`

#### B2. Bytecode Compiler (10-100x performance)
- **Files**: `src/compiler.ts` (new), `src/vm.ts` (new), `src/bytecode.ts` (new)
- **What**: Stack-based bytecode VM. Phase 1: pure expressions. Phase 2: pattern matching. Phase 3: agents.
- **Tests**: All 19 existing tests must produce identical output.

#### B3. LSP Server + VS Code Extension
- **Files**: `src/lsp/server.ts` (new), `editors/vscode/` (new)
- **What**: Diagnostics on save, hover info, completions, TextMate grammar for syntax highlighting.

#### B4. Formatter (`axon fmt`)
- **Files**: `src/formatter.ts` (new)
- **What**: AST pretty-printer, 4-space indent, 100-char line width, Rust-like style.

#### B5. Module Visibility Enforcement
- **Files**: `src/interpreter.ts`, `src/checker.ts`
- **What**: Enforce `pub`/`priv`/`internal`. Support `pub use` re-exports.
- **Tests**: `tests/axon/28_visibility.axon`, `tests/axon/29_pub_use.axon`

---

### Phase C: AI-Native Differentiation (~6 weeks)

#### C1. `#[tool]` Annotation + Tool Registry ⬅ IMMEDIATE PRIORITY (high ROI, low effort)
- **Files**: `src/interpreter.ts`, `src/runtime/stdlib.ts`
- **What**: When `#[tool]` annotated fn is registered, generate JSON Schema from param types. Add `tool_registry()`, `tool_call(name, args)`, `tool_schema(name)`. Add `llm_call_with_tools(prompt, tools)` for Anthropic tool-use API.
- **Tests**: `tests/axon/30_tool_registration.axon`, `tests/axon/31_tool_calling.axon`

#### C2. Capability System Enforcement
- **Files**: `src/checker.ts`, `src/parser.ts`, `src/ast.ts`
- **What**: Parse `requires Cap1, Cap2` in agent declarations. Map capabilities to allowed effects. Verify handler bodies stay within allowed set.
- **Tests**: `tests/axon/32_capabilities.axon`, `tests/axon/33_sandbox.axon`

#### C3. Structured LLM Output (Type-Safe)
- **Files**: `src/runtime/stdlib.ts`, `src/interpreter.ts`
- **What**: `llm_structured(type_schema, prompt, model)` — uses Anthropic tool-use to constrain output to match Axon type. Returns `Result<T, LLMError>`.
- **Tests**: `tests/axon/34_structured_output.axon`

#### C4. Algebraic Effect Handlers (Runtime)
- **Files**: `src/parser.ts`, `src/ast.ts`, `src/interpreter.ts`
- **What**: `handle Effect { op: handler_fn } in { body }`. Dynamic effect handler stack. Override IO/Random/Time/Network for testing without mocks.
- **Tests**: `tests/axon/35_handle_time.axon`, `tests/axon/36_handle_io.axon`, `tests/axon/37_handle_random.axon`

#### C5. Multi-Agent Orchestration Primitives
- **Files**: `src/runtime/agent.ts`, `src/runtime/stdlib.ts`
- **What**: `AgentGroup`, `broadcast`, `ask_all` (Promise.all), `ask_any` (Promise.race), `pipeline(agents, data)`.
- **Tests**: `tests/axon/38_agent_group.axon`, `tests/axon/39_agent_pipeline.axon`

#### C6. Hot Reload with State Migration (Production-Ready)
- **Files**: `src/hot_reload.ts`, `src/parser.ts`, `src/interpreter.ts`
- **What**: File watcher, delta compilation, `migrate Agent.State { ... }` syntax, apply migration function to running agent states.
- **Tests**: `tests/axon/40_hot_reload_state.axon`

---

## Summary Timeline

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| **A: Foundation** | Weeks 1-2 | Effect enforcement, generics in checker, concurrent agents, supervision |
| **B: Completeness** | Weeks 3-6 | Traits, bytecode VM, LSP, formatter, module visibility |
| **C: AI Differentiation** | Weeks 7-12 | Tool calling, capabilities, structured LLM output, effect handlers, multi-agent, hot reload |

## Recommended Immediate Priority (This Week)

1. **A1 — Effect enforcement** — Headline feature currently does nothing; proves language value proposition
2. **A4 — Async agent queue** — Agents don't actually run concurrently; fix makes demos compelling
3. **C1 — `#[tool]` annotation** — High AI-specific value, annotation already parsed, just needs wiring
