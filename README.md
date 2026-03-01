# Axon 语言

> **专为 AI Agent 设计的系统级编程语言**

```
"编译通过即正确，热更新即上线。"
```

---

## 为什么需要 Axon？

现有语言在 AI Agent 场景下各有致命缺陷：

| 语言 | 优势 | AI Agent 场景的致命缺陷 |
|------|------|------------------------|
| **TypeScript** | 生态大、类型友好 | `any` 漏洞、运行时仍可崩溃、无内存安全 |
| **Python** | 快速迭代、动态 | 类型检查弱、性能差、并发模型混乱 |
| **Rust** | 极致安全、极致性能 | 所有权系统学习曲线陡峭、AI 难以快速生成正确代码 |
| **C++** | 性能极佳 | 手工打磨成本高、不适合 AI 大量生成 |
| **Lisp** | 同像性、宏系统强大 | 类型系统弱、现代工具链缺失 |

**Axon 的答案**：取 Rust 的编译期安全保证 + Python/Lisp 的动态热更新 + Erlang 的 Actor 并发，专门针对 AI 大量生成代码的特性优化语法规整性。

---

## 三大核心设计原则

### 1. 编译即正确 (Correct by Construction)
- **Hindley-Milner 类型推断**：写更少类型注解，编译器自动推断
- **代数数据类型 + 穷举匹配**：消灭 null 指针、未处理的分支
- **Effect 系统**：在类型签名中声明副作用（IO、Async、State），编译器追踪
- **精化类型 (Refinement Types)**：`Int where n > 0`，运行时约束编译期验证
- **线性类型 Lite**：资源（文件、连接）自动管理，无需手动释放

### 2. AI 快速生成 + 热更新上线 (Hot-Reload Native)
- **模块级热更新**：更改代码 → 编译增量 delta → 注入运行中的 agent，无需重启
- **状态迁移声明**：热更新时声明新旧状态如何转换，agent 无缝继续运行
- **增量编译**：只重新编译变更模块，毫秒级反馈
- **REPL + 增量求值**：像 Lisp 一样，也可以逐行求值探索

### 3. 语法规整，AI 可靠生成 (Regular Grammar)
- **零歧义语法**：每个构造都有唯一的解析方式
- **最少关键字**：核心关键字 < 40 个
- **一致性优先**：同类事物总是用同种语法表达
- **人类可读**：优先英语自然表达，不引入晦涩符号

---

## 快速示例

```axon
// Hello, World
module Main

fn main() -> Unit | IO {
    print("Hello, Axon!")
}
```

```axon
// 类型安全的错误处理（无异常）
module FileProcessor

fn readConfig(path: Path) -> Result<Config, IOError> | IO {
    let text = File.read(path)?          // ? 自动传播 Err
    let config = Config.parse(text)?
    Ok(config)
}
```

```axon
// AI Agent 定义
module MyAgent

agent Summarizer {
    state { processed: Int = 0 }

    on Summarize(text: String) -> String | Async, IO {
        let summary = await llm.complete("Summarize: {text}")
        processed += 1
        summary
    }

    on Stats -> AgentStats {
        AgentStats { processed }
    }
}

fn main() -> Unit | Async, IO {
    let agent = spawn Summarizer
    let result = await agent.ask(Summarize("Axon is a new language..."))
    print(result)
}
```

```axon
// 热更新：agent 运行中升级代码
#[hot]
module MyAgent

// 声明状态迁移（旧版本 → 新版本）
migrate Summarizer.State {
    from V1 { processed: Int }
    to   V2 { processed: Int, history: List<String> }
    with |old| { processed: old.processed, history: [] }
}
```

---

## 文档结构

```
spec/
├── LANGUAGE_SPEC.md     # 完整语言规范
├── GRAMMAR.ebnf         # 形式化语法（EBNF）
├── TYPE_SYSTEM.md       # 类型系统详解
├── EFFECTS.md           # Effect 系统详解
├── HOT_RELOAD.md        # 热更新机制
└── AGENT_MODEL.md       # Agent 编程模型

examples/
├── 01_hello_world.axon
├── 02_types_and_patterns.axon
├── 03_error_handling.axon
├── 04_agents.axon
├── 05_hot_reload.axon
└── 06_ai_assistant.axon

DESIGN_RATIONALE.md      # 设计决策详细说明
```

---

## 与竞品对比

```axon
// Rust 中需要写的代码（安全但繁琐）
fn process(items: Vec<String>) -> Result<Vec<Output>, Error> {
    items.iter()
         .map(|item| transform(item))
         .collect::<Result<Vec<_>, _>>()
}

// Python 中需要写的代码（简洁但不安全）
def process(items):
    return [transform(item) for item in items]  # 运行时才知道出错

// Axon 中的写法（简洁 + 安全）
fn process(items: List<String>) -> Result<List<Output>, Error> {
    items |> map(transform) |> collect_result()
}
```

---

*Axon — 让 AI 写的代码和人工审查的代码一样可靠。*
