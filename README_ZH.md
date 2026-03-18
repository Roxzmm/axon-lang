# Axon

> **专为 AI Agent 编写、供人类阅读的编程语言**

[English README](README.md)

---

## 两条公理

```
编译通过  →  安全保证
安全保证  →  立即部署
```

Axon 建立在两条不可妥协的原则之上：

1. **编译器接受，即可安全运行。** 不是"大概安全"，不是"除非你做了 X"。是安全。类型系统、效果系统和穷举模式匹配共同实现这一目标。

2. **安全意味着部署——立即。** 通过编译的变更可以热加载进运行中的系统，无需重启，无需状态丢失，无需繁琐操作。

这两条原则组合起来，意味着 AI Agent 编写 Axon 代码的 edit→deploy 循环是：**编写 → 编译 → 运行中**。

---

## 为什么需要新语言？

现有语言在 AI Agent 场景下各有缺陷：

| 语言 | 优势 | AI Agent 场景的缺陷 |
|------|------|-------------------|
| TypeScript | 生态大、类型友好 | `any` 逃逸口、运行时惊喜、无效果追踪 |
| Python | 写起来快、动态 | 弱类型、GIL 并发、错误只在运行时暴露 |
| Rust | 极致安全 + 性能 | 所有权系统对 LLM 来说难以生成正确代码 |
| Go | 简单、支持并发 | 类型系统弱、无代数类型、运行时 nil 崩溃 |

Axon 取了不同的权衡点：**编译期可检查性最大化、运行时惊喜最小化、语法足够规整让 LLM 能可靠地生成正确代码。**

人类可读性是必要的。人类*可写性*是可选的——主要作者是 AI。

---

## 快速开始

**依赖：** Node.js 18+

```bash
git clone https://github.com/your-org/axon-lang
cd axon-lang
npm install
npm run build
npm link          # 使 `axon` 命令全局可用
```

```bash
axon run examples/01_hello_world.axon
axon repl
axon check myfile.axon
axon compile myfile.axon           # 编译为字节码
axon compile myfile.axon --wasm    # 编译为 WebAssembly
axon run myfile.axon --watch           # 保存即热更新
axon run myfile.axon --strict-effects  # 强制所有函数声明副作用
```

---

## 语言导览

### Agent — 有状态的 Actor

Agent 是主要的计算单元。它封装状态，只通过带类型的消息通信。

```axon
agent Counter {
    state {
        count: Int = 0
    }

    on Increment {
        count = count + 1
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
    let n = c.ask(GetCount)   // => 2
    print($"Count: {n}")
}
```

Agent 在结构上类似 class：`state` 字段是实例变量，`on X` 处理器是方法。`spawn` 创建实例，`send` 是发送后不等待，`ask` 是请求-响应（等待结果）。

### 类型和模式匹配

```axon
type Shape =
    | Circle(radius: Float)
    | Rect(width: Float, height: Float)
    | Triangle(base: Float, height: Float)

fn area(s: Shape) -> Float {
    match s {
        Circle(r)      => PI * r * r
        Rect(w, h)     => w * h
        Triangle(b, h) => 0.5 * b * h
    }
}
```

匹配是穷举的——漏掉一个变体是编译错误，不是运行时崩溃。

### 错误处理——无异常

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

`Result<T, E>` 和 `Option<T>` 是唯一的错误机制。没有 `try/catch`，没有未受检异常。

### 效果系统

函数声明它使用哪些副作用，编译器验证声明是否完整。

```axon
// 读取文件——必须声明 FileIO（或父效果 IO）
fn load_config(path: String) -> String | IO {
    let r = read_file(path)
    result_unwrap_or(r, "")
}

// 纯函数——无副作用，可以在任何地方安全调用
fn fibonacci(n: Int) -> Int {
    if n <= 1 { n } else { fibonacci(n - 1) + fibonacci(n - 2) }
}
```

**效果子类型**：`FileIO ⊆ IO`，`Network ⊆ IO`，`Env ⊆ IO`。声明 `| IO` 自动覆盖所有具体 IO 效果。

### 多 Agent 编排

```axon
agent Worker {
    state { id: Int = 0 }
    on SetId(n: Int)      { id = n }
    on Process(x: Int) -> Int { id * x }
}

fn main() -> Unit {
    let w1 = spawn Worker
    let w2 = spawn Worker
    w1.send(SetId(10))
    w2.send(SetId(20))

    // 并发发送给所有 agent，等待所有结果
    let results = ask_all([w1, w2], Process(5))
    // results: [50, 100]

    // 竞速：返回最快的响应
    let first = ask_any([w1, w2], Process(2))
}
```

### 工具注解

用 `#[tool]` 标记函数，注册为可按名字调度的工具：

```axon
#[tool("Search the web and return a summary")]
fn web_search(query: String) -> String | IO {
    // ... 实现
    $"results for: {query}"
}

fn main() -> Unit {
    // 按名字 + 参数 Map 调度工具
    let args = map_insert(map_empty(), "query", "Axon language")
    let result = tool_call("web_search", args)
}
```

---

## 当前可用功能

当前实现是 TypeScript 树遍历解释器，用于验证语言设计。**25 个测试全部通过。**

| 功能 | 状态 |
|------|------|
| 词法分析 / 语法分析 | ✅ 完整 |
| 类型检查器（双向） | ✅ 完整 |
| 效果系统（编译期） | ✅ 完整 |
| 效果子类型（FileIO ⊆ IO） | ✅ 完整 |
| `--strict-effects` 模式 | ✅ 完整 |
| Agent（spawn / send / ask） | ✅ 完整 |
| ask_all / ask_any（并发） | ✅ 完整 |
| ADT + 穷举模式匹配 | ✅ 完整 |
| 闭包 + 高阶函数 | ✅ 完整 |
| 字符串插值 + 格式化规范 | ✅ 完整 |
| 命名参数 + 默认参数 | ✅ 完整 |
| JSON 标准库 | ✅ 完整 |
| 文件 IO、环境变量、HTTP | ✅ 完整 |
| `#[tool]` 注解 + tool_call | ✅ 完整 |
| LLM 集成（Anthropic API） | ✅ 完整 |
| 模块系统 | ✅ 完整 |
| REPL（含历史记录） | ✅ 完整 |
| 热更新（文件监视模式） | ⚠️ 部分——见下文 |
| 泛型 | 🔜 下一优先级 |
| 真正 OS 线程并行 | 🔜 规划中 |
| 编译后端 | 🔜 规划中 |

---

## 已知限制

### 1. `$"..."` 插值语法尚未在解释器中实现

规范定义 `$"Hello {name}"` 为字符串插值语法（C# 风格的 `$` 前缀）。普通字符串 `"..."` 没有插值——`{` 是字面字符。

当前解释器原型仍使用旧语法：任何 `"..."` 字符串都将 `{` 视为插值表达式的开始。

```axon
// 规范（目标）:   $"Hello, {name}!"   — 插值字符串
//                "Hello, {name}!"    — 字面文本，无插值

// 当前解释器行为:
// "Hello, {name}!"  — 仍然是插值（旧行为）
```

**原因**：这是一个破坏性变更，需要更新词法分析器。实现直接——在词法器任务列表中排在首位。

**状态**：`examples/` 中的示例使用旧语法，并通过全部 25 项测试。解释器实现 `$"..."` 后将统一更新。

### 2. 热更新是文件重启，不是真正的动态补丁

`axon run --watch` 在文件变更时重新执行整个程序，会丢失 agent 状态。

**原因**：真正的热更新需要 Supervisor 以外科手术方式更新运行中 agent 的处理器映射，而无需重新运行 `#[Application]` 入口点。正确的实现（Erlang/OTP 模型）已在 `spec/HOT_RELOAD.md` 中规定，但尚未完成。

**目标**：保存文件 → 编译通过 → running 中的 agent 收到更新后的处理器，状态保留。无重启，无状态丢失。

### 3. 并发是协作式，不是真正并行

Agent 运行在 Node.js 事件循环上。`ask_all` 是并发（Promise 交错），不是真正并行（不是 OS 线程）。

**原因**：TypeScript/Node.js 原型。真正的并行需要 `worker_threads` 或编译后端。

### 4. 尚无泛型

使用 `Unknown` 作为泛型占位符。类型检查器无法验证类型参数。

**状态**：下一个实现优先级。

### 5. 无继承

这是设计选择，不是限制。

Axon 使用**结构化类型**（通过消息兼容性的隐式接口）、**组合**和**基于效果的约定**代替类继承。

---

## 设计哲学

**AI 编写，人类审阅。** 语言为 LLM 代码生成优化。语法规整无歧义，每个构造只有一种表达方式。

**Agent 而不是对象。** 计算围绕消息传递 Actor 组织。Agent 之间的共享可变状态在构造上是不可能的。

**效果是编译器检查的文档。** 函数签名准确告诉你它对外部世界能做什么。`| IO` 意味着 IO，`| IO, LLM` 意味着 IO 和 LLM 调用，没有 `|` 注解的纯函数两者都不做。

**组合优于继承。** Axon 没有类层次结构。行为通过组合实现，而不是继承。结构化类型意味着接口是隐式的。

---

## 路线图

完整计划见 [NEXT_PHASE_PLAN_V2.md](NEXT_PHASE_PLAN_V2.md)。当前优先级：

1. **泛型** — `List<T>`、`Option<T>`、`Result<T, E>` 具有真正的类型参数
2. **真正热更新** — Supervisor 模型：补丁运行中的 agent 处理器，无重启，无状态丢失
3. **`$"..."` 插值** — 在词法器中实现新语法，更新所有示例
4. **OS 线程 Agent** — `worker_threads` 后端实现真正并行
5. **`#[Application]` 解释器支持** — `axon run` 识别 `#[Application]` 为入口点

---

## 作者

**[Roxzmm](https://github.com/Roxzmm)**

---

*Axon — 编译成功是安全保证。安全是部署许可。*
