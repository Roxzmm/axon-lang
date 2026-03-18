# Axon 语言 — 架构规范

> **版本**: 0.6.1  
> **更新日期**: 2026-03-17  
> **语言**: TypeScript (10,281 行)

---

## 1. 概述

Axon 是一种为 AI Agent 设计的编程语言。主要特性：
- **树遍历解释器** 作为主要执行引擎
- **字节码编译器** + 栈式虚拟机以提升性能
- **WebAssembly 后端** 用于原生编译
- **Effect 系统** 编译时副作用追踪
- **内置 Agent 原语** 用于并发 Agent 通信

---

## 2. 源代码结构

```
src/
├── main.ts           # CLI 入口 (812 行)
├── lexer.ts          # 词法分析器 (560 行)
├── parser.ts         # 递归下降解析器 (1,439 行)
├── ast.ts            # AST 节点定义 (230 行)
├── checker.ts        # 类型检查器 (921 行)
├── interpreter.ts    # 树遍历解释器 (2,342 行)
├── formatter.ts      # 代码格式化器 (526 行)
├── hot_reload.ts     # 热重载 (177 行)
│
├── compiler/        # 字节码编译 pipeline
│   ├── bytecode.ts  # OpCode 定义 (121 行)
│   ├── compiler.ts # AST → 字节码 (578 行)
│   ├── vm.ts       # 栈式虚拟机 (262 行)
│   └── wasm.ts     # WebAssembly 后端 (237 行)
│
├── runtime/         # 运行时组件
│   ├── value.ts     # AxonValue 标签联合类型 (460 行)
│   ├── env.ts       # 环境与模块注册 (108 行)
│   ├── stdlib.ts    # 内置函数 (1,006 行)
│   ├── agent.ts     # Agent spawn/通信 (193 行)
│   ├── memory.ts    # 内存优化 (146 行)
│   ├── serializer.ts # 值序列化 (89 行)
│   └── worker_entry.ts # Worker 线程入口 (74 行)
│
└── lsp/
    └── server.ts    # LSP 实现
```

**总计**: 10,281 行 TypeScript

---

## 3. 编译流程

### 3.1 解释执行路径（默认）

```
源文件 (.axon)
    │
    ▼
词法分析 (lexer.ts) ────► Token[]
    │
    ▼
语法分析 (parser.ts) ───► AST (Program)
    │
    ▼
类型检查 (checker.ts) ──► 验证后的 AST
    │
    ▼
解释执行 (interpreter.ts) ──► 结果 (AxonValue)
```

### 3.2 字节码编译路径

```
源文件 (.axon)
    │
    ▼
词法分析 ──► Token[]
    │
    ▼
语法分析 ──► AST
    │
    ▼
类型检查 ──► 验证后的 AST
    │
    ▼
字节码编译器 (compiler.ts) ──► BytecodeProgram
    │
    ├──► 虚拟机 (vm.ts) ──► 执行字节码
    │
    └──► WASM (wasm.ts) ──► WebAssembly (.wat)
```

---

## 4. 核心组件

### 4.1 词法分析器 (lexer.ts - 560 行)

**功能**: 将源代码转换为 Token 序列

**Token 类别**:
- 字面量: `IntLit`, `FloatLit`, `StringLit`, `BoolLit`, `CharLit`
- 标识符: `Ident`
- 关键字: `fn`, `let`, `mut`, `if`, `else`, `match`, `for`, `while`, `agent`, `spawn`, `send` 等
- 运算符: `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`
- 标点: `(`, `)`, `{`, `}`, `[`, `]`, `,`, `.`, `->`, `=>`, `=`, `:`, `|`

### 4.2 解析器 (parser.ts - 1,439 行)

**功能**: 使用递归下降法从 Token 构建 AST

**支持的语法结构**:
- 表达式: 字面量、标识符、二元运算、一元运算、lambda、列表、元组、记录
- 语句: fn, let, mut, const, if, match, for, while, loop, return, break, continue
- 类型: 命名类型、元组类型、函数类型、细化类型
- 模式: 通配符、标识符、字面量、元组、列表、记录、枚举、或、范围

### 4.3 类型检查器 (checker.ts - 921 行)

**功能**: 验证类型并执行类型推断

**特性**:
- 双向类型推断
- 泛型类型参数
- Effect 副作用追踪
- 模式穷举性检查
- 细化类型

### 4.4 解释器 (interpreter.ts - 2,342 行)

**功能**: 直接执行 AST（树遍历）

**执行模型**:
- 递归求值表达式
- 维护环境栈用于变量作用域
- 支持 Agent spawn 和消息传递
- 内置 effect handlers 用于 I/O、HTTP 等

### 4.5 字节码编译器 (compiler.ts - 578 行)

**功能**: 将 AST 编译为栈式字节码

**字节码操作** (见 `bytecode.ts`):
- 栈操作: `POP`, `DUP`, `SWAP`, `ROT`
- 常量: `LOAD_CONST`
- 局部变量: `LOAD_LOCAL`, `STORE_LOCAL`, `LOAD_GLOBAL`, `STORE_GLOBAL`
- 控制流: `JUMP`, `JUMP_IF_FALSE`
- 算术: `ADD`, `SUB`, `MUL`, `DIV`, `MOD`, `NEG`
- 比较: `EQ`, `NE`, `LT`, `LE`, `GT`, `GE`
- 逻辑: `AND`, `OR`, `NOT`
- 函数: `CALL`, `CALL_NATIVE`, `RETURN`
- 数据: `LIST_NEW`, `LIST_APPEND`, `MAP_NEW`, `INDEX`, `FIELD_ACCESS`

### 4.6 虚拟机 (vm.ts - 262 行)

**功能**: 高效执行字节码

**特性**:
- 预分配栈 (1024 槽)
- 栈指针跟踪实现 O(1) 操作
- 函数调用内联缓存
- 带栈追踪的错误处理

### 4.7 WASM 后端 (wasm.ts - 237 行)

**功能**: 生成 WebAssembly 以实现原生执行

**输出**: WebAssembly 文本格式 (.wat)

### 4.8 运行时 (runtime/)

**AxonValue** - 标签联合类型表示所有 Axon 值:
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

**标准库** (1,006 行):
- `len()`, `print()`, `str()`, `int()`, `float()`, `bool()`
- `map()`, `filter()`, `reduce()`, `flatMap()`
- `read_file()`, `write_file()`, `read_dir()`
- `http_request()`
- `regex_match()`, `regex_replace()`
- `json_parse()`, `json_stringify()`
- Channel 操作: `chan()`, `send()`, `recv()`, `select()`

---

## 5. Agent 系统

### 5.1 Agent 原语

- `spawn agentName { ... }` - 创建带状态的 Agent
- `send agentName { msg: value }` - 发送消息给 Agent
- `ask agentName { msg: value }` - 请求-响应模式
- `agentName <- { msg: value }` - 另一种发送语法

### 5.2 Agent 状态

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

## 6. Effect 系统

### 6.1 Effect 声明

```axon
effect ReadFile {
  read(path: String) -> String
}

effect IO {
  print(msg: String) -> Unit
}
```

### 6.2 Effect 处理器

```axon
handle io_effect = IO {
  print(msg) {
    // 原生实现
  }
}
```

---

## 7. 构建与分发

### 7.1 构建命令

```bash
npm run build     # TypeScript → JavaScript
npm run dev       # 使用 ts-node 开发
npm run test      # 运行测试套件
npm run fmt       # 格式化代码
```

### 7.2 CLI 命令

```bash
axon run <file>        # 运行程序
axon test [dir]        # 运行测试
axon check <file>      # 仅做类型检查
axon compile <file>    # 编译为字节码
axon compile --wasm   # 编译为 WebAssembly
axon fmt <file>       # 格式化代码
axon repl             # 交互式 REPL
```

---

## 8. 测试

- **测试位置**: `tests/axon/`
- **测试数量**: 51 个测试文件 (54 个测试用例)
- **覆盖范围**: 算术、字符串、列表、模式、闭包、控制流、递归、错误处理、Agent、高阶函数、映射、自定义类型、迭代器、模块、Effect、Channel 等

---

## 9. 自托管编译器状态

**当前状态**: `compiler.axon` 中的部分实现

**问题**:
- 不支持顶层 `let` 语句
- 仅支持基本算术表达式

**实现完整自举所需**:
- 用 Axon 实现完整词法分析器
- 用 Axon 实现完整解析器
- 用 Axon 实现类型检查器
- 用 Axon 实现代码生成器
- 用 Axon 实现完整虚拟机
- 预计: 约 4,000 行 Axon 代码
