# Axon Effect 系统详解

## 概述

Effect 系统（也叫代数效果，Algebraic Effects）是 Axon 的核心创新之一。它在类型签名中**显式声明**函数的副作用，让编译器追踪和验证副作用的传播。

**核心思想**：副作用不是"污染"，而是类型签名的一部分。

```axon
fn pureFn(x: Int) -> Int              // 纯函数：无副作用，确定性的
fn ioFn(path: Path) -> String | IO    // IO 函数：有 IO 副作用
fn asyncFn(url: URL) -> Data | Async  // 异步函数：有异步副作用
```

---

## 1. 为什么需要 Effect 系统？

### 1.1 Python 的问题

```python
def process(data):
    # 调用者不知道这个函数：
    # - 会读写文件？
    # - 会发网络请求？
    # - 会修改全局状态？
    # - 是否线程安全？
    result = some_library_function(data)
    return result
```

### 1.2 TypeScript 的问题

```typescript
// async 标记了异步，但没有标记 IO、State 等
async function process(data: any): Promise<any> {
    // 可能写文件、发请求、修改全局变量——调用者不知道
}
```

### 1.3 Axon 的解决方案

```axon
// Effect 签名完整描述了函数的"能力"
fn process(data: Data) -> Result<Output, Error> | IO, Async

// 调用者一看签名就知道：
// - 有 IO 副作用（会读写文件/数据库）
// - 有 Async 副作用（非阻塞，需要 await）
// - 可能失败（Result）
```

---

## 2. 内置 Effect 定义

```axon
// 核心 Effect
effect IO {
    // 所有 IO 操作的基础 effect
    // 包含：文件读写、标准输入输出、系统调用
}

effect Async {
    // 异步非阻塞操作
    // 使用 await 关键字等待
}

effect State<S> {
    // 可变状态访问
    // S 是状态的类型
    fn get()    -> S
    fn put(s: S) -> Unit
    fn modify(f: S -> S) -> Unit
}

effect Log {
    // 结构化日志记录
    fn log(level: LogLevel, msg: String, fields: Map<String, Json>) -> Unit
}

effect Trace {
    // 执行追踪（用于调试和性能分析）
    fn span(name: String, f: Unit -> T) -> T
}

effect Random {
    // 可控的随机性（用于测试时可注入固定种子）
    fn next_int(range: Range<Int>) -> Int
    fn next_float() -> Float
}

effect Time {
    // 时钟访问（测试时可注入模拟时钟）
    fn now() -> Timestamp
    fn sleep(duration: Duration) -> Unit | Async
}

// IO 的子集（更细粒度的权限控制）
effect FileIO  <: IO   // FileIO 是 IO 的子效果
effect NetworkIO <: IO  // NetworkIO 是 IO 的子效果
effect DatabaseIO <: IO
effect ProcessIO <: IO   // 子进程
```

---

## 3. Effect 声明语法

### 3.1 基本语法

```axon
fn functionName(params) -> ReturnType | Effect1, Effect2, Effect3 {
    body
}

// 等价写法
fn functionName(params) -> ReturnType
    | Effect1
    , Effect2
    , Effect3
{
    body
}
```

### 3.2 Effect 传播规则

```axon
// 规则：如果你调用了带 Effect E 的函数，
// 你自己也必须声明 E（或处理 E）

fn readLine() -> String | IO { ... }  // 来自标准库

fn greet(name: String) -> Unit | IO {
    let line = readLine()  // readLine 有 IO，所以 greet 也要有 IO
    print("Hello, {name}!")
}

// 错误示例
fn pureFn() -> Unit {
    readLine()  // 编译错误：IO effect 未声明
}
```

### 3.3 Effect 处理（消除 Effect）

```axon
// 可以在函数内"处理"（handle）一个 effect，使其不传播
fn processWithLog(data: Data) -> Result<Output, Error> {
    // 处理 Log effect，消除它（使函数签名不含 Log）
    handle Log {
        log: |level, msg, fields| {
            // 将日志写入内存缓冲区，不实际 IO
            buffer.push(LogEntry { level, msg, fields })
        }
    } in {
        // 这里可以使用 Log effect
        Log.info("Processing data")
        let result = compute(data)
        Log.info("Done")
        result
    }
}

// 常用的 Effect 处理器：测试时注入
fn test_with_fixed_time() {
    handle Time {
        now:   || Timestamp.from_epoch(1000000)  // 固定时间
        sleep: |d| { /* 立即返回，不真正等待 */ }
    } in {
        run_my_time_dependent_code()
    }
}
```

---

## 4. Capability 权限系统

### 4.1 Capability 作为 Effect 的访问控制

```axon
// 声明 Capability（什么操作需要什么权限）
capability FileRead    = allows FileIO where mode == ReadOnly
capability FileWrite   = allows FileIO where mode includes Write
capability FileDelete  = allows FileIO where mode == Delete
capability NetworkHTTP = allows NetworkIO where protocol == HTTP
capability NetworkAny  = allows NetworkIO  // 所有网络权限
capability SpawnAgent  = allows spawning Agents
capability SysAdmin    = allows ProcessIO  // 危险！执行系统命令

// 组合 Capability
capability WebDeveloper = FileRead + FileWrite + NetworkHTTP
```

### 4.2 在 Agent 中声明 Capability

```axon
// Agent 必须声明所需的 capability
// 运行时和编译期都会验证

agent SecureWebScraper {
    requires NetworkHTTP  // 只允许 HTTP 请求，不允许写文件

    state { results: List<String> = [] }

    on Scrape(url: URL) -> Result<String, Error> | Async {
        let content = await http.get(url)?
        results = results |> List.prepend(content)
        Ok(content)
    }

    // 如果这里调用 File.write(...)：
    // 编译错误：FileWrite capability not declared
}
```

### 4.3 Capability 沙箱

```axon
// 在沙箱中运行不受信任的代码
fn runUntrusted(code: CompiledCode) -> Result<Output, SandboxError> | IO {
    Sandbox.run(code,
        capabilities: [FileRead],  // 只给读文件权限
        timeout: 30.sec,
        memory_limit: 256.mb
    )
}
```

---

## 5. Effect 系统的实际应用

### 5.1 纯函数的好处

```axon
// 纯函数：无 Effect，无副作用
fn fibonacci(n: Int) -> Int {
    if n <= 1 { n }
    else { fibonacci(n-1) + fibonacci(n-2) }
}

// 纯函数的优势：
// 1. 可以无限次安全调用
// 2. 可以并发调用（无数据竞争）
// 3. 可以缓存结果（memoize）
// 4. 单元测试不需要 mock
// 5. 编译器可以自由重排、内联
```

### 5.2 Effect 分层设计

```axon
// 推荐模式：业务逻辑 = 纯函数 + Effect 函数的组合

// 第一层：纯数据变换（无副作用）
fn validateUser(data: RawUserData) -> Result<ValidatedUser, ValidationError> {
    // 纯函数：只做验证，不做 IO
    if data.email.contains("@") { Ok(validated) } else { Err(...) }
}

fn buildUserRecord(validated: ValidatedUser, now: Timestamp) -> User {
    // 纯函数：构建用户记录
    User { id: UserId.generate(), created_at: now, ... }
}

// 第二层：IO 操作（带 Effect）
fn saveUser(user: User, db: Database) -> Result<Unit, DBError> | IO {
    db.insert("users", user)
}

fn sendWelcomeEmail(user: User) -> Result<Unit, EmailError> | IO, Async {
    await email.send(to: user.email, template: "welcome")
}

// 第三层：组合（协调 IO 和纯逻辑）
fn registerUser(data: RawUserData) -> Result<User, RegistrationError> | IO, Async, Time {
    let validated = validateUser(data)?
    let now       = Time.now()
    let user      = buildUserRecord(validated, now)
    saveUser(user, db)?
    sendWelcomeEmail(user)?  // 注意：邮件发送失败是否应该回滚注册？
    Ok(user)
}
```

### 5.3 测试友好性

```axon
// 生产代码
fn fetchWeather(city: String) -> Result<Weather, Error> | NetworkIO, Time {
    let resp = await http.get("https://api.weather.com/{city}")?
    Ok(resp.json::<Weather>())
}

// 测试代码：注入模拟 Effect
#[test]
fn test_fetch_weather() {
    let mock_response = Weather { temp: 25.0, condition: Sunny }

    // 注入模拟的 NetworkIO
    handle NetworkIO {
        http_get: |url| Ok(MockResponse.json(mock_response))
    } in {
        let result = fetchWeather("Beijing")
        assert result == Ok(mock_response)
    }
}
```

---

## 6. Effect 多态

```axon
// Effect 多态：函数的 Effect 由参数决定
fn map<T, U, E>(
    items: List<T>,
    f:     T -> U | E    // f 可以有任意 Effect E
) -> List<U> | E         // 结果继承 f 的 Effect
{
    match items {
        []        => []
        [x, ..xs] => [f(x), ..map(xs, f)]
    }
}

// 使用：纯函数的 map
let doubled = map([1, 2, 3], |x| x * 2)  // 返回 List<Int>，无 Effect

// 使用：有 IO 的 map
let results = map(files, |f| readFile(f))  // 返回 List<Result<String>>，有 IO Effect
```

---

## 7. Effect 系统 vs 其他语言

| 特性 | Java/Python 异常 | Haskell Monad | TypeScript Promise | Axon Effect |
|------|-----------------|---------------|-------------------|-------------|
| 副作用可见性 | 无 | 有（但语法重） | 部分（async/await）| 完整 |
| 组合复杂度 | 低 | 高（Monad 变换器）| 中 | 低 |
| 测试友好 | 差（需要 mock）| 好 | 中 | 最好（Effect 处理器）|
| AI 生成难度 | 低 | 高 | 中 | 低 |
| 类型安全 | 弱 | 强 | 中 | 强 |

Axon 的 Effect 系统选择了"**最适合 AI 生成且类型安全**"的点：语法直接（`| IO, Async`），组合自然（传播规则简单），测试友好（Effect 处理器）。
