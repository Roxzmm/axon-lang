# Axon Language Development Roadmap

> **Project Status**: Self-hosted compiler in progress
> **Current Version**: 0.6.1
> **Last Updated**: 2026-03-17

---

## 📊 Overall Progress

```
Completed: ████████████████░░░░░░ 80%
In Progress: ██░░░░░░░░░░░░░░░░░ 20%
```

---

## ✅ Completed Features

### Core Language Features

| Feature | Status | Notes |
|---------|--------|-------|
| Lexer | ✅ Done | Supports all basic tokens |
| Parser | ✅ Done | Recursive descent with precedence |
| Type Checker | ✅ Done | Bidirectional inference |
| Effect System | ✅ Done | Compile-time checking |
| Pattern Matching | ✅ Done | Exhaustive match |
| Agent Messages | ✅ Done | spawn/send/ask |
| Closures | ✅ Done | Higher-order functions |
| Module System | ✅ Done | Import/export |
| Hot Reload | ✅ Done | State-preserving patch |

### Bytecode Compiler (V4 Bootstrap)

| Component | Status | Progress |
|-----------|--------|----------|
| Bytecode Instruction Set | ✅ Done | 100% |
| AST→Bytecode Generator | ✅ Done | 100% |
| Stack-based VM | ✅ Done | 100% |
| Lexer (Axon version) | ✅ Done | 100% |
| Parser (Axon version) | ✅ Done | 100% |
| Generator (Axon version) | ✅ Done | 100% |
| Optimizer (Axon version) | ✅ Done | 100% |
| VM (Axon version) | ✅ Done | 100% |
| **Self-hosting** | ❌ Incomplete | Top-level `let` issue |

### Runtime & Standard Library

| Feature | Status | Version |
|---------|--------|---------|
| File System API | ✅ Done | v0.6 |
| Formatter | ✅ Done | v0.6 |
| Memory Optimization | ✅ Done | v0.6 |
| JSON Support | ✅ Done | All |
| HTTP Client | ✅ Done | All |
| LLM Integration | ✅ Done | Anthropic |
| Regex | ✅ Done | All |
| Thread Parallel | ✅ Done | worker_threads |

---

## 🔄 In Progress

### Self-Hosted Compiler (compiler.axon)

**Current Status**: ✅ Working pipeline (small files)

- **parser.axon**: ✅ Works (fixed immutable variable bugs)
- **generator.axon**: ✅ Loads successfully
- **vm_axon.axon**: ✅ Loads successfully
- **--use-axon flag**: ✅ Works for small files
- **Performance**: Tree-walker ~26000x slower than C

**Bootstrap Pipeline**:
```
Step 1: TS interpreter runs
  main.ts (TS) → run → axon program

Step 2: Self-hosted pipeline
  --use-axon → Lexer → parser.axon → generator.axon → vm_axon.axon

Step 3: Full self-hosting [IN PROGRESS]
  Need: Bytecode VM to compile large programs efficiently
```

---

## 📝 TODO

| Task | Status | Priority |
|------|--------|----------|
| Performance optimization | ⏳ Pending | High |
| LSP support | ⏳ Pending | Medium |
| Remove TS dependency | ⏳ Pending | Low |
| JIT compilation | ⏳ Pending | Low |

**Completed**:
- ✅ Self-hosted pipeline works (small files)
- ✅ Performance benchmark executed (26s vs C 0.001s)
- ✅ All 54 tests pass

---

## 📁 File Structure

```
/mnt/f/Work/ailanguage-opencode/
├── compiler.axon       # Main compiler (monolithic)
│
├── src/               # TypeScript interpreter source
│   ├── lexer.ts       # 560 lines
│   ├── parser.ts      # 1,439 lines
│   ├── checker.ts     # 921 lines
│   ├── compiler.ts    # 578 lines
│   ├── vm.ts         # 262 lines
│   └── ...
│
├── tests/axon/        # Test cases (51 files, 54 tests)
├── examples/          # Example programs
└── spec/              # Specifications
```

---

## 📈 Success Metrics

- [x] Bytecode compiler compiles basic test cases
- [x] `compiler.axon` basic implementation
- [x] Bootstrap: `100 + 200` = `300`
- [x] List literals `[1, 2, 3]`
- [x] `len()` function
- [x] If statement conditional branches
- [x] For loops
- [x] While loops
- [x] Function definitions
- [x] Match expressions
- [ ] Full self-hosting (compiler compiles itself)

---

## Documentation

- `spec/ARCHITECTURE.md` - System architecture (EN)
- `spec/ARCHITECTURE_ZH.md` - 系统架构 (ZH)
- `spec/LANGUAGE_SPEC.md` - Language reference (EN)
- `spec/LANGUAGE_SPEC_ZH.md` - 语言参考 (ZH)
- `spec/TYPE_SYSTEM.md` - Type system details
- `spec/AGENT_MODEL.md` - Agent model
- `spec/EFFECTS.md` - Effect system
- `spec/HOT_RELOAD.md` - Hot reload
- `spec/PRINCIPLES.md` - Design principles

---

**Version**: 0.6.1
**Status**: Active Development
