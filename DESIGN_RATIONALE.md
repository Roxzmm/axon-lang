# Axon 设计决策详解

本文档解释 Axon 每一个重大设计决策背后的原因，特别是针对 AI Agent 场景的取舍。

---

## 一、为什么不直接用现有语言？

### TypeScript 的问题

TypeScript 是目前 AI agent 框架（LangChain.js、AutoGPT 等）使用最多的语言，但它有结构性缺陷：

```typescript
// TypeScript 的 any 是安全漏洞
function process(data: any): any {  // AI 生成时极易滥用
    return data.transform();  // 编译通过，运行时 crash
}

// 没有 null 安全（strictNullChecks 可选，不是默认）
function getName(user: User): string {
    return user.profile.name;  // user.profile 可能是 null
}
```

**AI 生成 TypeScript 的问题**：AI 在不确定时倾向于使用 `any`，导致类型系统形同虚设。TypeScript 是 JavaScript 的超集，继承了所有 JS 的历史包袱（`typeof null === "object"`，隐式类型转换等）。

### Python 的问题

```python
# Python：简洁，但运行时炸弹
def process_batch(items):
    return [transform(item) for item in items]
    # items 是什么？transform 返回什么？
    # 只有跑起来才知道

# 并发模型混乱：asyncio、threading、multiprocessing 三套体系
# AI 生成时经常混用导致死锁或竞争条件
```

**核心问题**：Python 的动态性是双刃剑。AI 生成大量 Python 代码时，类型错误只能在运行时发现，而 AI Agent 在生产环境中运行时不能依赖运行时的错误反馈来修正代码。

### Rust 的问题

Rust 的安全性是无可挑剔的，但：

```rust
// Rust：每一行都需要精心思考所有权
fn process<'a>(items: &'a [String]) -> Vec<&'a str> {
    items.iter()
         .filter(|s| !s.is_empty())
         .map(|s| s.as_str())
         .collect()
}
// AI 必须同时思考：生命周期、借用规则、所有权转移
// 生成的代码常常无法通过借用检查器
```

**对 AI 的影响**：Rust 的所有权系统需要全局视角才能正确使用。AI 在生成局部代码时往往无法维持全局一致的生命周期关系，导致大量编译错误，反而失去了"编译即正确"的优势。

---

## 二、类型系统设计决策

### 决策：Hindley-Milner 推断而非显式注解

**为什么不用显式注解（TypeScript 风格）？**
AI 写显式注解时会为了通过编译而写错误的类型，特别是在复杂泛型场景下。

**为什么不用全动态（Python 风格）？**
动态类型意味着错误只能在运行时发现，与"编译即正确"原则矛盾。

**Hindley-Milner 的优势**：
- 类型是推断出来的，不是强制标注的
- 当 AI 省略类型注解时，编译器自动推断
- 当类型不一致时，编译器给出精确的错误位置
- AI 只需要在模块边界（公开函数）写类型注解

```axon
// AI 可以省略内部变量的类型
fn process(items: List<String>) -> List<Int> {
    let lengths = items |> map(|s| s.len())  // 推断为 List<Int>
    let filtered = lengths |> filter(|n| n > 0)  // 推断为 List<Int>
    filtered
}
```

### 决策：代数数据类型 + 强制穷举匹配

**消灭 null 的方案**：

```axon
// 没有 null，只有 Option
type Option<T> = Some(T) | None

fn findUser(id: UserId) -> Option<User> { ... }

// 使用时必须处理 None 情况
let name = match findUser(id) {
    Some(user) => user.name
    None       => "Anonymous"
}
// 编译器保证两个分支都处理了
```

**为什么比 TypeScript 的 `?` 操作符更安全**：
TypeScript 允许 `user?.name` 返回 `undefined`，这个 `undefined` 可以在代码中传播，最终在意想不到的地方爆炸。Axon 的 `Option<T>` 在类型层面强制处理。

### 决策：精化类型（Refinement Types）

```axon
type Port     = Int    where n >= 1    and n <= 65535
type Email    = String where valid_email(self)
type NonEmpty<T> = List<T> where len(self) > 0
```

**AI 的收益**：AI 在定义业务域类型时可以内联约束，编译器在调用处自动验证。AI 不再需要在每个函数入口写 `if port < 1 || port > 65535 { error }` 这样的防御代码。

---

## 三、Effect 系统设计决策

### 决策：在类型签名中声明副作用

```axon
fn pureCompute(x: Int) -> Int              // 纯函数，无副作用
fn readFile(p: Path) -> Result<String> | IO    // 有 IO 副作用
fn fetchData(u: URL) -> Result<Data> | Async   // 有异步副作用
fn updateDB(r: Record) -> Unit | IO, State<DB> // 有 IO 和状态副作用
```

**为什么 AI 需要 Effect 系统？**

1. **可审计性**：AI 生成的函数，一眼就能看出它会做什么副作用
2. **组合安全**：编译器阻止在纯函数中调用有副作用的函数
3. **测试友好**：纯函数可以直接单元测试，无需 mock
4. **Agent 隔离**：可以声明 agent 只有特定权限

```axon
// 这个 agent 只有网络权限，没有文件系统权限
agent WebFetcher {
    requires Async, NetworkIO
    // 编译器拒绝任何 FileIO 调用
}
```

### 决策：不用 Monad 而用 Effect Row

Haskell 的 Monad（IO、State 等）对 AI 生成来说太抽象，每次组合都需要 monad transformer。

Axon 使用 Row-based Effect 系统（类似 Koka、Effekt 语言）：
- Effect 可以自然叠加：`| IO, Async, State<S>`
- 无需显式 lift/transformer
- 语法直接，AI 易于生成

---

## 四、内存管理决策

### 决策：默认 GC + Opt-in 线性类型

**为什么不用 Rust 的完整所有权系统？**

Rust 的所有权系统解决了内存安全，但代价是：
- AI 生成代码时需要同时追踪每个值的所有权状态
- 借用检查错误信息复杂，AI 难以一次性修复
- 频繁的 `clone()` 导致性能问题，但避免 clone 需要生命周期注解

**Axon 的方案**：

```axon
// 默认：GC 管理（安全，AI 易于生成）
fn processItems(items: List<Item>) -> List<Result> {
    items |> map(process)  // 自动内存管理
}

// Opt-in：线性类型（对资源使用）
fn writeFile(path: Path, content: String) -> Result<Unit, IOError> | IO {
    let file: File = File.open(path)?  // File 是线性类型
    file.write(content)?               // file 被消费
    file.close()                       // 如果忘记 close，编译器报错
    // 不需要手动 free，但必须显式 close
}
```

**内存安全保证来源**：
1. GC 消灭 use-after-free 和 double-free
2. Option 类型消灭 null 解引用
3. 线性类型确保资源（文件、连接、锁）被正确释放
4. 数组访问默认带边界检查

---

## 五、热更新机制决策

### 决策：语言级别而非框架级别的热更新

Python 有 `importlib.reload()`，但它：
- 不更新已创建的对象实例
- 不处理状态迁移
- 容易导致不一致的模块状态

Node.js 的热更新（如 nodemon）是进程重启，不是真正的热更新。

Erlang/Elixir 有真正的热代码升级（Hot Code Loading），但：
- 需要手动编写 `code_change` 回调
- 语法复杂，不直观

**Axon 的方案**：将热更新和状态迁移作为一等语言特性：

```axon
// 标记模块支持热更新
#[hot]
module AgentLogic

// 声明 Agent 状态的版本和迁移
migrate Counter.State {
    from V1 {
        count: Int
    }
    to V2 {
        count:   Int
        history: List<Timestamped<Int>>  // 新增字段
    }
    with |old| {
        count:   old.count,
        history: []  // 新字段初始化为空
    }
}
```

**运行时行为**：
1. AI 修改代码
2. 增量编译器生成 delta（只编译变更的模块）
3. 运行时找到所有运行中的该 Agent 实例
4. 暂停 Agent 消息队列
5. 执行状态迁移（`with` 函数）
6. 加载新代码
7. 恢复消息队列，Agent 继续运行

---

## 六、Agent 模型决策

### 决策：Actor 模型 + 结构化并发

**为什么选 Actor 模型**：
- 天然隔离：每个 Agent 有独立状态，无共享内存，无数据竞争
- 容错性：一个 Agent 崩溃不影响其他 Agent
- AI 易于推理：只需考虑消息收发，不需要考虑锁/竞争

**为什么加结构化并发**：
Actor 模型的问题是 spawn 的 actor 如果出错会"静默失败"。结构化并发（Structured Concurrency）确保：
- 子任务的生命周期不超过父任务
- 子任务的错误会传播到父任务

```axon
// 结构化并发：所有子任务必须在 scope 内完成
fn processAll(items: List<Item>) -> Result<List<Output>> | Async {
    async.scope |scope| {
        let tasks = items |> map(|item| scope.spawn(|| processOne(item)))
        tasks |> await.all()  // 等待所有完成，任何一个失败则整体失败
    }
}
```

---

## 七、语法设计决策

### 决策：花括号 + 强制格式化

**为什么不用 Python 的缩进语法？**

缩进语法对 AI 来说有一个隐患：AI 在生成嵌套很深的代码时，缩进计数容易出错，而且这种错误在视觉上不明显。

花括号 `{}` 的结构是显式的，即使 AI 搞错了缩进，编译器也能正确解析并报告正确的错误位置。

**为什么有强制格式化（类似 Go/Rust 的 `gofmt`/`rustfmt`）？**

AI 生成的代码风格不一致。强制格式化（通过 `axon fmt`）确保所有代码统一，减少代码审查中的噪音。

### 决策：管道操作符 `|>`

```axon
// 没有管道的写法（嵌套难读）
let result = collect(filter(map(items, transform), isValid))

// 有管道的写法（线性易读，AI 易生成）
let result = items
    |> map(transform)
    |> filter(isValid)
    |> collect()
```

AI 生成链式操作时，管道操作符比嵌套函数调用更不容易出错（括号匹配问题）。

### 决策：`?` 错误传播操作符

```axon
fn readConfig(path: Path) -> Result<Config, IOError> | IO {
    let text   = File.read(path)?   // 如果 Err，直接返回 Err
    let parsed = Json.parse(text)?  // 同上
    let config = Config.from(parsed)?
    Ok(config)
}
```

相比 Rust 的 `?`，Axon 的 `?` 还支持异步上下文和跨 effect 使用，且错误类型自动通过 `From` trait 转换。

---

## 八、关于二进制格式的考量

用户提到"如果考虑到 AI 特性，你觉得使用二进制更好"——这里详细分析：

**二进制格式的优势**：
- 解析速度极快（无需词法/语法分析）
- 无歧义（没有格式问题）
- 紧凑（占用空间小）

**但对 AI Agent 的劣势**：
- AI 无法直接生成二进制（必须先生成文本，再编译）
- 人类无法审查 AI 生成的代码（违背可解释性原则）
- 调试极难

**Axon 的决策**：文本源码 + 二进制中间表示（IR）

```
AI 生成 .axon 文本文件
    ↓ 增量编译器
.axir 二进制 IR（类似 WebAssembly 的紧凑格式）
    ↓ 运行时 JIT
Native code / WASM
```

`.axir` 是给机器用的，`.axon` 是给 AI 和人类用的。两者都一流支持。

---

*Axon 的每一个设计决策，都在问同一个问题：这个决策让 AI 生成的代码更可靠吗？*
