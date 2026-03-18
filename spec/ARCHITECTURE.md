# Axon Language — Architecture Specification

> **Version**: 0.6.1  
> **Last Updated**: 2026-03-17  
> **Language**: TypeScript (10,281 lines)

---

## 1. Overview

Axon is a programming language designed for AI Agents. It features:
- **Tree-walking interpreter** as the primary execution engine
- **Bytecode compiler** with stack-based VM for performance
- **WebAssembly backend** for native compilation
- **Effect system** for compile-time side-effect tracking
- **Built-in agent primitives** for concurrent agent communication

---

## 2. Source Code Structure

```
src/
├── main.ts           # CLI entry point (812 lines)
├── lexer.ts          # Tokenizer (560 lines)
├── parser.ts         # Recursive descent parser (1,439 lines)
├── ast.ts            # AST node definitions (230 lines)
├── checker.ts        # Type checker with inference (921 lines)
├── interpreter.ts    # Tree-walking executor (2,342 lines)
├── formatter.ts      # Code formatter (526 lines)
├── hot_reload.ts     # State-preserving hot reload (177 lines)
│
├── compiler/        # Bytecode compilation pipeline
│   ├── bytecode.ts  # OpCode definitions (121 lines)
│   ├── compiler.ts # AST → bytecode (578 lines)
│   ├── vm.ts       # Stack-based VM (262 lines)
│   └── wasm.ts     # WebAssembly backend (237 lines)
│
├── runtime/         # Runtime components
│   ├── value.ts     # AxonValue tagged union (460 lines)
│   ├── env.ts       # Environment & module registry (108 lines)
│   ├── stdlib.ts    # Built-in functions (1,006 lines)
│   ├── agent.ts     # Agent spawn/communication (193 lines)
│   ├── memory.ts    # Memory optimization (146 lines)
│   ├── serializer.ts # Value serialization (89 lines)
│   └── worker_entry.ts # Worker thread entry (74 lines)
│
└── lsp/
    └── server.ts    # LSP implementation
```

**Total**: 10,281 lines of TypeScript

---

## 3. Compilation Pipeline

### 3.1 Interpretation Path (Default)

```
Source (.axon)
    │
    ▼
Lexer (lexer.ts) ──────► Token[]
    │
    ▼
Parser (parser.ts) ────► AST (Program)
    │
    ▼
Type Checker (checker.ts) ──► Validated AST
    │
    ▼
Interpreter (interpreter.ts) ──► Result (AxonValue)
```

### 3.2 Bytecode Compilation Path

```
Source (.axon)
    │
    ▼
Lexer ──► Token[]
    │
    ▼
Parser ──► AST
    │
    ▼
Type Checker ──► Validated AST
    │
    ▼
Bytecode Compiler (compiler.ts) ──► BytecodeProgram
    │
    ├──► VM (vm.ts) ──► Execute bytecode
    │
    └──► WASM (wasm.ts) ──► WebAssembly (.wat)
```

---

## 4. Key Components

### 4.1 Lexer (lexer.ts - 560 lines)

**Purpose**: Tokenize source code into tokens

**Token Categories**:
- Literals: `IntLit`, `FloatLit`, `StringLit`, `BoolLit`, `CharLit`
- Identifiers: `Ident`
- Keywords: `fn`, `let`, `mut`, `if`, `else`, `match`, `for`, `while`, `agent`, `spawn`, `send`, etc.
- Operators: `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`
- Punctuation: `(`, `)`, `{`, `}`, `[`, `]`, `,`, `.`, `->`, `=>`, `=`, `:`, `|`

### 4.2 Parser (parser.ts - 1,439 lines)

**Purpose**: Build AST from tokens using recursive descent

**Supported Constructs**:
- Expressions: literals, identifiers, binary ops, unary ops, lambda, list, tuple, record
- Statements: fn, let, mut, const, if, match, for, while, loop, return, break, continue
- Types: named types, tuple types, function types, refinement types
- Patterns: wildcard, identifier, literal, tuple, list, record, enum, or, range

### 4.3 Type Checker (checker.ts - 921 lines)

**Purpose**: Validate types and perform type inference

**Features**:
- Bidirectional type inference
- Generic type parameters
- Effect system for side-effect tracking
- Pattern exhaustiveness checking
- Refinement types

### 4.4 Interpreter (interpreter.ts - 2,342 lines)

**Purpose**: Execute AST directly (tree-walking)

**Execution Model**:
- Evaluate expressions recursively
- Maintain environment stack for variable scoping
- Support for agent spawning and message passing
- Built-in effect handlers for I/O, HTTP, etc.

### 4.5 Bytecode Compiler (compiler.ts - 578 lines)

**Purpose**: Compile AST to stack-based bytecode

**Bytecode Operations** (see `bytecode.ts`):
- Stack: `POP`, `DUP`, `SWAP`, `ROT`
- Constants: `LOAD_CONST`
- Locals: `LOAD_LOCAL`, `STORE_LOCAL`, `LOAD_GLOBAL`, `STORE_GLOBAL`
- Control Flow: `JUMP`, `JUMP_IF_FALSE`
- Arithmetic: `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `NEG`
- Comparison: `EQ`, `NE`, `LT`, `LE`, `GT`, `GE`
- Logic: `AND`, `OR`, `NOT`
- Function: `CALL`, `CALL_NATIVE`, `RETURN`
- Data: `LIST_NEW`, `LIST_APPEND`, `MAP_NEW`, `INDEX`, `FIELD_ACCESS`

### 4.6 VM (vm.ts - 262 lines)

**Purpose**: Execute bytecode efficiently

**Features**:
- Pre-allocated stack (1024 slots)
- Stack pointer tracking for O(1) operations
- Function call inline cache
- Error handling with stack traces

### 4.7 WASM Backend (wasm.ts - 237 lines)

**Purpose**: Generate WebAssembly for native execution

**Output**: WebAssembly Text Format (.wat)

### 4.8 Runtime (runtime/)

**AxonValue** - Tagged union representing all Axon values:
```
- Int: bigint
- Float: number
- String: string
- Bool: boolean
- List: AxonValue[]
- Tuple: AxonValue[]
- Record: { [key: string]: AxonValue }
- Enum: { typeName, variant, fields }
- Function: { params, body, closure }
- Native: { name, fn }
- Agent: AgentRef
- Channel: ChannelRef
```

**Standard Library** (1,006 lines):
- `len()`, `print()`, `str()`, `int()`, `float()`, `bool()`
- `map()`, `filter()`, `reduce()`, `flatMap()`
- `read_file()`, `write_file()`, `read_dir()`
- `http_request()`
- `regex_match()`, `regex_replace()`
- `json_parse()`, `json_stringify()`
- Channel operations: `chan()`, `send()`, `recv()`, `select()`

---

## 5. Agent System

### 5.1 Agent Primitives

- `spawn agentName { ... }` - Create agent with state
- `send agentName { msg: value }` - Send message to agent
- `ask agentName { msg: value }` - Request-response pattern
- `agentName <- { msg: value }` - Alternative send syntax

### 5.2 Agent State

```axon
agent Counter {
  state: { count: Int }
  
  on Increment { 
    state.count = state.count + 1 
  }
  
  on GetCount -> Int {
    state.count
  }
}
```

---

## 6. Effect System

### 6.1 Effect Declarations

```axon
effect ReadFile {
  read(path: String) -> String
}

effect IO {
  print(msg: String) -> Unit
}
```

### 6.2 Effect Handlers

```axon
handle io_effect = IO {
  print(msg) {
    // Native implementation
  }
}
```

---

## 7. Build & Distribution

### 7.1 Build Commands

```bash
npm run build     # TypeScript → JavaScript
npm run dev       # Development with ts-node
npm run test      # Run test suite
npm run fmt       # Format code
```

### 7.2 CLI Commands

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

## 8. Testing

- **Test Location**: `tests/axon/`
- **Test Count**: 51 test files (54 test cases)
- **Coverage**: Arithmetic, strings, lists, patterns, closures, control flow, recursion, error handling, agents, higher-order functions, maps, custom types, iterators, modules, effects, channels, etc.

---

## 9. Self-Hosted Compiler Status

**Current State**: Partial implementation in `compiler.axon`

**Issues**:
- Top-level `let` statements not supported
- Only supports basic arithmetic expressions

**Required for Full Bootstrap**:
- Implement complete Lexer in Axon
- Implement complete Parser in Axon
- Implement Type Checker in Axon
- Implement Code Generator in Axon
- Implement full VM in Axon
- Estimated: ~4,000 lines of Axon code
