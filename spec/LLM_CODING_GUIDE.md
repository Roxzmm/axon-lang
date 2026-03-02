# Axon Language — LLM Coding Guide
# Axon 语言 — 大语言模型编程指南

> 本文档专为大语言模型（LLM）阅读设计，提供 Axon 语言的完整语法参考、惯用法和代码模式，
> 使 LLM 能够正确生成 Axon 代码。

---

## 1. 语言概述 / Language Overview

Axon 是专为 AI Agent 开发设计的函数式编程语言。

**文件扩展名**: `.axon`
**运行方式**: `node dist/main.js run <file.axon>`
**设计目标**: 类型安全、热重载、Actor 并发、AI 原生 API

---

## 2. 程序结构 / Program Structure

每个文件必须以 `module` 声明开头，并有一个 `main` 函数：

```axon
module MyApp.Hello          // 模块声明（必须）

fn main() -> Unit {
    print("Hello, World!")
}
```

---

## 3. 类型系统 / Type System

### 基本类型 / Primitive Types

| 类型 | 字面量示例 | 说明 |
|------|-----------|------|
| `Int` | `42`, `-7`, `0` | 整数（大整数支持） |
| `Float` | `3.14`, `-0.5`, `1.0e10` | 浮点数 |
| `Bool` | `true`, `false` | 布尔值 |
| `String` | `"hello"`, `"say \"hi\""` | 字符串（双引号） |
| `Char` | char值由 `char_at` 等返回 | 字符 |
| `Unit` | `()` | 空类型 |

### 复合类型 / Composite Types

```axon
// Tuple（元组）
let p: (Int, Int) = (3, 4)
let x = p[0]               // 索引访问

// List（列表）
let nums: List<Int> = [1, 2, 3]
let head = nums[0]          // 索引访问

// Option（可选值）
let v: Option<Int> = Some(42)
let n: Option<Int> = None

// Result（结果）
let ok: Result<Int, String> = Ok(42)
let err: Result<Int, String> = Err("failed")
```

### 自定义类型 / Custom Types

```axon
// Record 类型（结构体）
type Point {
    x: Int
    y: Int
}

// Enum 类型（代数数据类型）
type Shape {
    Circle(Float)
    Rectangle(Float, Float)
    Triangle(Float, Float, Float)
}

// 使用自定义类型
let p = Point { x: 1, y: 2 }
let c = Circle(5.0)
```

---

## 4. 函数声明 / Function Declarations

```axon
// 基本函数
fn add(a: Int, b: Int) -> Int {
    a + b
}

// 带默认参数
fn greet(name: String, greeting: String = "Hello") -> String {
    "{greeting}, {name}!"
}

// 递归函数
fn factorial(n: Int) -> Int {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

// 高阶函数
fn apply(f: Int -> Int, x: Int) -> Int { f(x) }

// 调用函数
let r1 = greet("World")               // 位置参数
let r2 = greet(name: "Alice")         // 命名参数（使用默认值）
let r3 = greet(greeting: "Hi", name: "Bob")  // 命名参数（乱序）
let r4 = greet("Carol", greeting: "Hey")     // 混合模式
```

---

## 5. 变量绑定 / Variable Bindings

```axon
let x = 42                   // 不可变绑定
let mut y = 0                // 可变绑定
y = y + 1                    // 修改可变变量

const MAX = 100              // 常量
```

---

## 6. 字符串 / Strings

```axon
let name = "Alice"
let n = 42
let pi = 3.14159

// 字符串插值
let s1 = "Hello, {name}!"                // 基本插值
let s2 = "Value: {n}"                    // 整数插值
let s3 = "Pi = {pi:.2f}"                 // 浮点格式化
let s4 = "Pct = {pi:.1%}"               // 百分比格式化

// ⚠ 重要：字符串字面量中的 { 会触发插值
// JSON 对象字符串不能直接写成 "{\"key\": val}"
// 应使用 json_stringify 从 Map 生成 JSON 字符串

// 格式化规范（类 Python mini-language）
let s5 = "{n:>10}"    // 右对齐，宽度 10
let s6 = "{n:<10}"    // 左对齐，宽度 10
let s7 = "{n:^10}"    // 居中，宽度 10
let s8 = "{n:0>6}"    // 填充字符 '0'，右对齐，宽度 6
let s9 = "{n:+}"      // 显示正负号
let s10 = "{n:,}"     // 千位分隔符
let s11 = "{n:b}"     // 二进制
let s12 = "{n:x}"     // 十六进制小写
let s13 = "{n:X}"     // 十六进制大写
let s14 = "{n:o}"     // 八进制
let s15 = "{pi:.3e}"  // 科学计数法
```

### 字符串操作函数

```axon
upper("hello")              // "HELLO"
lower("WORLD")              // "world"
trim("  hi  ")              // "hi"
len("abc")                  // 3
contains("hello", "ell")    // true
starts_with("hi", "h")      // true
ends_with("hi", "i")        // true
split("a,b,c", ",")         // ["a", "b", "c"]
join(["a", "b"], ", ")      // "a, b"
replace("aXb", "X", "-")    // "a-b"
slice("hello", 1, 3)        // "el"
repeat("ab", 3)             // "ababab"
lines("a\nb\nc")            // ["a", "b", "c"]
chars("hi")                 // list of Char
parse_int("42")             // Ok(42)
parse_float("3.14")         // Ok(3.14)
```

---

## 7. 控制流 / Control Flow

```axon
// if/else（返回值）
let result = if x > 0 { "positive" } else { "non-positive" }

// match（模式匹配）
let desc = match shape {
    Circle(r)       => "circle with radius {r}"
    Rectangle(w, h) => "rect {w}x{h}"
    _               => "other shape"
}

// match on Option
let val = match opt {
    Some(v) => v * 2
    None    => 0
}

// match with guard
let label = match n {
    0          => "zero"
    x if x < 0 => "negative"
    _          => "positive"
}

// for loop
for i in list_range(0, 10) {
    print("{i}")
}

// while loop
let mut i = 0
while i < 10 {
    i = i + 1
}

// loop (infinite, use break)
loop {
    if done { break }
}
```

---

## 8. 列表操作 / List Operations

```axon
let nums = [1, 2, 3, 4, 5]

// 基础操作
len(nums)                   // 5
list_head(nums)             // Some(1)
list_tail(nums)             // Some([2,3,4,5])
list_last(nums)             // Some(5)
list_get(nums, 2)           // Some(3)
list_append(nums, 6)        // [1,2,3,4,5,6]
list_prepend(0, nums)       // [0,1,2,3,4,5]
list_concat(nums, [6,7])    // [1,2,3,4,5,6,7]
list_reverse(nums)          // [5,4,3,2,1]
list_take(nums, 3)          // [1,2,3]
list_drop(nums, 2)          // [3,4,5]
list_range(0, 5)            // [0,1,2,3,4]
list_range_inclusive(1, 5)  // [1,2,3,4,5]
list_sum(nums)              // 15
list_contains(nums, 3)      // true
list_enumerate(nums)        // [(0,1),(1,2),(2,3),...]
list_zip([1,2],[3,4])       // [(1,3),(2,4)]
list_flatten([[1,2],[3]])   // [1,2,3]
list_unique([1,2,1,3])      // [1,2,3]

// 高阶函数
list_map(nums, |x| x * 2)          // [2,4,6,8,10]
list_filter(nums, |x| x > 2)       // [3,4,5]
list_fold(nums, 0, |acc, x| acc + x)  // 15
list_any(nums, |x| x > 4)          // true
list_all(nums, |x| x > 0)          // true
list_find(nums, |x| x > 3)         // Some(4)
list_flat_map(nums, |x| [x, x*2])  // [1,2,2,4,...]
list_sort(nums, |a,b| compare(a,b))
```

---

## 9. Map 操作 / Map Operations

```axon
// 创建 Map
let m = map_empty()
let m2 = map_insert(m, "key", 42)
let m3 = map_new([("a", 1), ("b", 2)])   // 从列表创建

// 访问
map_get(m2, "key")          // Some(42)
map_has(m2, "key")          // true
map_len(m2)                 // 1
map_is_empty(m2)            // false

// 修改（返回新 Map，不可变）
let m4 = map_insert(m2, "x", 10)
let m5 = map_remove(m2, "key")

// 遍历
map_keys(m2)                // ["key"]
map_values(m2)              // [42]
map_entries(m2)             // [("key", 42)]
```

---

## 10. Option 和 Result / Option and Result

```axon
// Option
option_is_some(Some(42))           // true
option_is_none(None)               // true
option_unwrap(Some(42))            // 42  （None 时抛异常）
option_unwrap_or(None, 0)          // 0
option_ok_or(None, "missing")      // Err("missing")

// Result
result_is_ok(Ok(42))               // true
result_is_err(Err("bad"))          // true
result_unwrap(Ok(42))              // 42  （Err 时抛异常）
result_unwrap_or(Err("e"), 0)      // 0
result_unwrap_err(Err("msg"))      // "msg"

// ? 运算符（提前返回 Err）
fn parse_and_double(s: String) -> Result<Int, String> {
    let n = parse_int(s)?   // 若 Err 则立即返回 Err
    Ok(n * 2)
}
```

---

## 11. Lambda / 匿名函数

```axon
// 带参数
let double = |x| x * 2
let add = |a, b| a + b

// 无参数
let greet = || print("hi")

// 多行 lambda
let process = |x| {
    let y = x * 2
    y + 1
}

// 管道运算符 |>（Elixir 风格）
let result = [1, 2, 3]
    |> list_map(|x| x * 2)
    |> list_filter(|x| x > 2)
    |> list_sum()
```

---

## 12. 模式匹配 / Pattern Matching

```axon
// 元组解构
let (a, b) = (1, 2)

// List 解构
let [head, ...tail] = [1, 2, 3]

// 记录解构
let Point { x, y } = p

// match 中的模式
match value {
    0                     => "zero"
    n if n > 100          => "large"
    (x, y)                => "tuple"
    [first, ..rest]       => "list"
    Some(v)               => "some: {v}"
    None                  => "none"
    Ok(v)                 => "ok: {v}"
    Err(e)                => "error: {e}"
    Point { x: 0, y }     => "on y-axis"
    _                     => "other"
}

// let 解构
let Some(val) = opt   // 若 None 则 panic
let Ok(data)  = res   // 若 Err 则 panic
```

---

## 13. Agent（并发 Actor）

```axon
// 定义 Agent
agent Counter {
    state count: Int = 0

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

// 使用 Agent
fn main() -> Unit {
    let c = spawn Counter
    c.send(Increment)
    c.send(Increment)
    let n = c.ask(GetCount)   // 同步等待响应
    print("count = {n}")
    c.send(Reset)
}
```

---

## 14. JSON 操作 / JSON Operations

```axon
// 解析 JSON
let result = json_parse("[1, 2, 3]")
if result_is_ok(result) {
    let arr = result_unwrap(result)
    print("parsed: {len(arr)} items")
}

// ⚠ JSON 对象字符串：不能在字面量中用 {，用 stringify 再解析
let m = map_insert(map_insert(map_empty(), "name", "Alice"), "age", 30)
let json_str = json_stringify(m)        // '{"name":"Alice","age":30}'
let parsed   = result_unwrap(json_parse(json_str))
let name_val = option_unwrap(json_get(parsed, "name"))

// 序列化
json_stringify([1, 2, 3])             // "[1,2,3]"
json_stringify("hello")              // '"hello"'
json_stringify(true)                 // "true"
json_stringify_pretty(m)             // 缩进格式

// 访问 JSON 对象字段
json_get(parsed_map, "key")          // Option<Any>
```

---

## 15. HTTP 操作 / HTTP Operations

```axon
// GET 请求（async，返回 Result<String, String>）
let resp = http_get("https://api.example.com/data")
match resp {
    Ok(body) => print("got: {len(body)} bytes")
    Err(e)   => print("error: {e}")
}

// GET + 自动解析 JSON
let data = http_get_json("https://api.example.com/users")
match data {
    Ok(users) => {
        // users 是 Axon List 或 Map
    }
    Err(e) => print("failed: {e}")
}

// POST 请求
let payload = json_stringify(map_insert(map_empty(), "key", "value"))
let result = http_post("https://api.example.com/data", payload, "application/json")
```

---

## 16. 环境变量 / Environment Variables

```axon
// 读取环境变量
let api_key = env_get("API_KEY")
match api_key {
    Some(key) => print("key found: {len(key)} chars")
    None      => print("API_KEY not set")
}

// 设置环境变量
env_set("MY_VAR", "hello")

// 获取所有环境变量（返回 Map<String, String>）
let all = env_all()
let path = option_unwrap_or(map_get(all, "PATH"), "")

// 命令行参数
let cli_args = args()     // List<String>
```

---

## 17. LLM 调用 / LLM Calls

```axon
// 需要设置 ANTHROPIC_API_KEY 环境变量
let response = llm_call("What is 2+2?")
match response {
    Ok(text) => print("LLM says: {text}")
    Err(e)   => print("LLM error: {e}")
}

// 指定模型
let resp2 = llm_call("Explain recursion in one sentence", "claude-opus-4-6")
```

---

## 18. 文件 IO / File IO

```axon
// 读文件
let content = read_file("data.txt")
match content {
    Ok(text) => print("file: {len(text)} chars")
    Err(e)   => print("read error: {e}")
}

// 写文件
let ok = write_file("output.txt", "Hello, World!\n")
assert(result_is_ok(ok), "write failed")

// 检查文件是否存在
if file_exists("config.json") {
    let cfg = result_unwrap(read_file("config.json"))
    // ...
}
```

---

## 19. 数学函数 / Math Functions

```axon
abs(-5)           // 5
sqrt(16.0)        // 4.0
floor(3.7)        // 3
ceil(3.2)         // 4
round(3.5)        // 4
pow(2, 10)        // 1024
min(3, 5)         // 3
max(3, 5)         // 5
clamp(15, 0, 10)  // 10
log(2.718)        // ~1.0
sin(0.0)          // 0.0
cos(0.0)          // 1.0
PI                // 3.14159...
E                 // 2.71828...
```

---

## 20. 工具函数 / Utility Functions

```axon
type_of(42)          // "Int"
type_of("hi")        // "String"
type_of([1,2])       // "List"
uuid()               // "f47ac10b-58cc-4372-..."
now_ms()             // 毫秒时间戳 (Int)
now_s()              // 秒时间戳 (Float)
timestamp()          // "2024-01-15T10:30:00.000Z"
random()             // [0, 1) Float
random_int(1, 6)     // 1-6 的随机整数
random_bool()        // 随机布尔值
exit(0)              // 退出进程
panic("message")     // 抛出不可恢复错误
assert(cond, "msg")  // 断言
assert_eq(a, b, "msg")
```

---

## 21. 模块系统 / Module System

```axon
// 使用标准库模块（PascalCase → snake_case 文件名）
use Lib.MyUtils          // 加载 lib/my_utils.axon

// 模块声明
module MyApp.Utils
```

---

## 22. 效果系统 / Effect System

```axon
// 函数签名中声明副作用
fn read_data() -> String | IO {
    result_unwrap(read_file("data.txt"))
}

fn compute() -> Int | Pure {
    42 * 2
}

fn fetch_user(id: Int) -> Result<String, String> | IO, Async {
    http_get("https://api.example.com/users/{id}")
}
```

---

## 23. 常见惯用法 / Common Idioms

### 处理 Option 链

```axon
// 使用 option_unwrap_or 提供默认值
let val = option_unwrap_or(map_get(config, "timeout"), 30)

// 使用 match 解构
let result = match option_unwrap_or(env_get("PORT"), "8080") {
    port => int(port)
}
```

### 函数式管道

```axon
let top5_words = content
    |> split(" ")
    |> list_map(|w| lower(trim(w)))
    |> list_filter(|w| len(w) > 3)
    |> list_unique()
    |> list_take(5)
```

### 错误处理链

```axon
fn process(path: String) -> Result<Int, String> {
    let content = read_file(path)?          // 传播 IO 错误
    let n = parse_int(trim(content))?       // 传播解析错误
    Ok(n * 2)
}
```

### Agent 模式

```axon
agent TaskQueue {
    state tasks: List<String> = []
    state done: List<String> = []

    on AddTask(task: String) {
        tasks = list_append(tasks, task)
    }

    on ProcessNext -> Option<String> {
        match list_head(tasks) {
            Some(t) => {
                tasks = option_unwrap(list_tail(tasks))
                done = list_append(done, t)
                Some(t)
            }
            None => None
        }
    }

    on GetDone -> List<String> { done }
}
```

---

## 24. ⚠ 已知限制 / Known Limitations

1. **字符串插值与 `{`**: 字符串字面量中的 `{` 会触发插值。
   - 不能写 `"{\"key\": 1}"` 来表示 JSON 对象
   - 解决：用 `json_stringify(map)` 动态生成 JSON 字符串

2. **HTTP 是异步的**: `http_get`/`http_post`/`http_get_json`/`llm_call` 是异步函数

3. **整数是大整数**: `Int` 类型在内部使用 BigInt，数学函数返回 Float 时需显式转换

4. **无继承**: Axon 没有类继承，用组合 + ADT + Agent 替代

---

## 25. 完整示例 / Complete Example

```axon
// AI 助手 Agent 示例
module Examples.AIAssistant

agent AIAssistant {
    state history: List<String> = []
    state model: String = "claude-haiku-4-5-20251001"

    on SetModel(m: String) {
        model = m
    }

    on Ask(question: String) -> Result<String, String> {
        let prompt = if list_is_empty(history) {
            question
        } else {
            let ctx = join(history, "\n")
            "Previous context:\n{ctx}\n\nNew question: {question}"
        }
        let response = llm_call(prompt, model)
        match response {
            Ok(answer) => {
                history = list_append(history, "Q: {question}")
                history = list_append(history, "A: {answer}")
                Ok(answer)
            }
            Err(e) => Err(e)
        }
    }

    on GetHistory -> List<String> { history }
    on ClearHistory { history = [] }
}

fn main() -> Unit {
    let assistant = spawn AIAssistant

    let r1 = assistant.ask(Ask("What is Axon language?"))
    match r1 {
        Ok(answer) => print("Answer: {answer}")
        Err(e)     => print("Error: {e}")
    }

    let history = assistant.ask(GetHistory)
    print("History: {len(history)} entries")
}
```
