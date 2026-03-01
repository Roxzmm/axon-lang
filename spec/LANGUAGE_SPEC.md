# Axon 语言完整规范 v0.1

**版本**：0.1（设计稿）
**状态**：提案

---

## 目录

1. [词法结构](#1-词法结构)
2. [基本类型](#2-基本类型)
3. [复合类型](#3-复合类型)
4. [表达式](#4-表达式)
5. [语句与绑定](#5-语句与绑定)
6. [函数](#6-函数)
7. [模式匹配](#7-模式匹配)
8. [类型定义](#8-类型定义)
9. [Trait 系统](#9-trait-系统)
10. [Effect 系统](#10-effect-系统)
11. [Agent 模型](#11-agent-模型)
12. [模块系统](#12-模块系统)
13. [热更新](#13-热更新)
14. [标准库概览](#14-标准库概览)

---

## 1. 词法结构

### 1.1 注释

```axon
// 单行注释

/*
  多行注释
  可以嵌套 /* 嵌套注释 */
*/

/// 文档注释（附加到下一个声明）
/// 支持 Markdown 格式
fn myFunction() -> Unit { ... }
```

### 1.2 标识符

```
identifier  ::= [a-zA-Z_][a-zA-Z0-9_]*
type_name   ::= [A-Z][a-zA-Z0-9_]*   // 类型名必须大写开头
effect_name ::= [A-Z][a-zA-Z0-9_]*   // Effect 名必须大写开头
```

### 1.3 关键字

```
// 声明
module  use  fn  type  trait  impl  agent  effect  capability

// 控制流
if  else  match  loop  while  for  break  continue  return

// 绑定
let  mut  const

// 值
true  false  null_never_exists  // 没有 null/nil/undefined

// 类型相关
where  as  in  is

// Agent/并发
spawn  send  ask  await  on  emit  state

// 热更新
migrate  from  to  with  hot

// 错误处理
Ok  Err  Some  None  try  catch

// 可见性
pub  priv  internal
```

### 1.4 操作符

```
// 算术
+  -  *  /  %  **  (幂)

// 比较
==  !=  <  >  <=  >=

// 逻辑
&&  ||  !

// 位操作
&  |  ^  ~  <<  >>

// 管道
|>  (左结合管道)
<|  (右结合管道，较少用)

// 错误传播
?   (Result/Option 展开并提前返回)
!   (强制展开，编译期证明不会失败时使用)

// 范围
..   (不包含上界)
..=  (包含上界)

// 解构/访问
.    (字段访问)
::   (模块路径分隔符)
```

---

## 2. 基本类型

### 2.1 数值类型

```axon
// 整数（默认 Int 是平台原生大小，64位平台上是 Int64）
Int    // 有符号，平台原生
Int8   Int16   Int32   Int64   Int128
UInt   UInt8   UInt16  UInt32  UInt64  UInt128

// 浮点
Float    // 默认 Float64
Float32  Float64

// 字面量
let a: Int    = 42
let b: Int    = 1_000_000   // 下划线分隔符
let c: Int    = 0xFF        // 十六进制
let d: Int    = 0b1010_1010 // 二进制
let e: Int    = 0o755       // 八进制
let f: Float  = 3.14
let g: Float  = 1.5e-10
```

### 2.2 布尔类型

```axon
Bool  // true | false

let x: Bool = true
let y: Bool = !x            // false
let z: Bool = x && y        // false
```

### 2.3 字符与字符串

```axon
Char    // Unicode 标量值（4 字节）
String  // UTF-8 编码的不可变字符串
Bytes   // 原始字节序列

// 字面量
let c: Char   = 'A'
let c2: Char  = '中'
let s: String = "Hello, 世界!"

// 字符串插值
let name = "Axon"
let msg  = "Hello, {name}!"           // "Hello, Axon!"
let expr = "1 + 1 = {1 + 1}"         // "1 + 1 = 2"
let raw  = r"no \n escape here"       // 原始字符串

// 多行字符串
let poem = """
    Line one
    Line two
    Line three
    """  // 自动去除公共缩进
```

### 2.4 Unit 类型

```axon
Unit  // 零信息量的类型，相当于 void
      // 字面量：() 或直接省略

fn doSomething() -> Unit {
    print("done")
    // 隐式返回 ()
}
```

### 2.5 Never 类型

```axon
Never  // 不可能的类型，用于永不返回的函数

fn panic(msg: String) -> Never {
    // 抛出不可恢复错误，终止进程
    runtime.panic(msg)
}

fn infiniteLoop() -> Never {
    loop { }
}
```

---

## 3. 复合类型

### 3.1 Tuple（元组）

```axon
// 固定长度、异构序列
let pair:  (Int, String)       = (42, "hello")
let triple: (Bool, Int, Float) = (true, 1, 3.14)

// 访问
let n: Int    = pair.0
let s: String = pair.1

// 解构
let (a, b) = pair
```

### 3.2 Record（记录/结构体）

```axon
// 命名字段的异构结构
type Point = {
    x: Float
    y: Float
}

type User = {
    id:    UserId
    name:  String
    email: Email
    age:   Int where n >= 0 and n <= 150  // 精化类型
}

// 创建
let p = Point { x: 1.0, y: 2.0 }

// 字段访问
let x = p.x

// 更新语法（不可变更新，返回新值）
let p2 = p with { x: 3.0 }  // p.y 保持不变

// 解构
let Point { x, y } = p
let { x: px, y: py } = p  // 重命名
```

### 3.3 List（不可变链表）

```axon
List<T>  // 不可变持久化链表（共享尾部）

let xs: List<Int> = [1, 2, 3, 4, 5]
let ys = xs |> List.prepend(0)  // [0, 1, 2, 3, 4, 5]，xs 不变

// 模式匹配
match xs {
    []       => "empty"
    [x]      => "singleton: {x}"
    [x, ..rest] => "head: {x}, tail has {rest |> List.len()} items"
}
```

### 3.4 Array（可变数组）

```axon
Array<T>  // 连续内存，可变，O(1) 随机访问

let arr: Array<Int> = Array.new([1, 2, 3])
arr[0] = 10  // 可变，但需要 mut 绑定

let mut arr2 = Array.filled(5, 0)  // [0, 0, 0, 0, 0]
arr2[2] = 99  // arr2 = [0, 0, 99, 0, 0]

// 越界访问返回 Option，不会 panic
let v: Option<Int> = arr2.get(10)  // None
```

### 3.5 Map（不可变哈希映射）

```axon
Map<K, V>  // 不可变持久化哈希映射

let m: Map<String, Int> = Map.from([("a", 1), ("b", 2)])
let m2 = m |> Map.insert("c", 3)  // m 不变

// 访问（返回 Option）
let v: Option<Int> = m.get("a")  // Some(1)
let v2             = m["a"]!     // 1（已知存在时用 !）
```

### 3.6 Set（不可变集合）

```axon
Set<T>

let s = Set.from([1, 2, 3, 2, 1])  // Set { 1, 2, 3 }
let s2 = s |> Set.add(4)
let contains = s.has(2)  // true
```

---

## 4. 表达式

### 4.1 块表达式

```axon
// 块是表达式，最后一个表达式是块的值
let result = {
    let x = compute1()
    let y = compute2(x)
    x + y  // 块的值（无分号）
}
```

### 4.2 条件表达式

```axon
// if-else 是表达式
let label = if score >= 90 { "A" } else if score >= 80 { "B" } else { "C" }

// 没有三元操作符，用 if-else 代替
```

### 4.3 循环表达式

```axon
// loop（无限循环，用 break 返回值）
let result = loop {
    let n = readNext()
    if n > 100 { break n }
}

// while
while condition {
    doSomething()
}

// for（迭代器）
for item in items {
    process(item)
}

// for 带索引
for (i, item) in items |> Iter.enumerate() {
    print("{i}: {item}")
}

// for 带范围
for i in 0..10 {      // 0, 1, ..., 9
    print(i)
}
for i in 0..=10 {     // 0, 1, ..., 10
    print(i)
}
```

### 4.4 管道表达式

```axon
// |> 将左值作为右侧函数的第一个参数
let result = data
    |> validate()         // validate(data)
    |> transform()        // transform(validated)
    |> serialize()        // serialize(transformed)

// 带额外参数
let result2 = items
    |> List.filter(|x| x > 0)    // List.filter(items, |x| x > 0)
    |> List.map(|x| x * 2)
    |> List.take(5)
```

### 4.5 await 表达式

```axon
// await 在 | Async effect 中使用
fn fetchUser(id: UserId) -> Result<User, Error> | Async, IO {
    let resp = await http.get("/users/{id}")?
    let user = await resp.json::<User>()?
    Ok(user)
}

// await.all（并发等待多个）
fn fetchAll(ids: List<UserId>) -> Result<List<User>, Error> | Async, IO {
    let tasks = ids |> List.map(|id| fetchUser(id))
    await.all(tasks)
}

// await.race（返回最快完成的）
fn fastest(tasks: List<Async<T>>) -> T | Async {
    await.race(tasks)
}
```

### 4.6 Lambda 表达式

```axon
// 基本 lambda
let double = |x: Int| x * 2
let add    = |x: Int, y: Int| x + y

// 多行 lambda（块体）
let process = |item: Item| {
    let validated = validate(item)
    transform(validated)
}

// 类型推断（参数类型可省略）
let double = |x| x * 2  // 从上下文推断 x: Int

// 捕获（自动捕获，不需要显式声明）
let multiplier = 3
let triple = |x| x * multiplier  // 自动捕获 multiplier
```

---

## 5. 语句与绑定

### 5.1 let 绑定

```axon
// 不可变绑定（默认）
let x = 42
let y: String = "hello"  // 可选类型注解

// 可变绑定
let mut counter = 0
counter += 1

// 解构绑定
let (a, b)       = (1, 2)
let { name, age } = person
let [head, ..tail] = items

// 忽略部分
let (_, second) = pair
let { name, .. } = person  // 忽略其余字段
```

### 5.2 const 绑定

```axon
// 编译期常量（必须是编译期可求值的表达式）
const MAX_SIZE: Int    = 1024
const PI: Float        = 3.14159265358979
const APP_NAME: String = "MyApp"
```

---

## 6. 函数

### 6.1 函数声明

```axon
// 基本语法
fn name(param1: Type1, param2: Type2) -> ReturnType {
    body
}

// 带 Effect 注解
fn name(params...) -> ReturnType | Effect1, Effect2 {
    body
}

// 无参数
fn hello() -> Unit {
    print("Hello!")
}

// 泛型函数
fn identity<T>(x: T) -> T { x }

fn map<A, B>(list: List<A>, f: A -> B) -> List<B> {
    match list {
        []        => []
        [x, ..xs] => [f(x), ..map(xs, f)]
    }
}
```

### 6.2 函数类型

```axon
// 函数类型语法
A -> B           // 接受 A，返回 B
(A, B) -> C      // 接受 A 和 B，返回 C
A -> B | Effect  // 带 effect 的函数类型

// 高阶函数
fn apply<A, B>(f: A -> B, x: A) -> B { f(x) }
fn compose<A, B, C>(f: B -> C, g: A -> B) -> A -> C {
    |x| f(g(x))
}
```

### 6.3 默认参数与命名参数

```axon
fn connect(
    host:    String,
    port:    Int = 8080,        // 默认参数
    timeout: Duration = 30.sec  // 默认参数
) -> Connection | IO { ... }

// 调用
connect("localhost")                          // port=8080, timeout=30s
connect("localhost", port: 9090)              // 使用命名参数
connect("localhost", timeout: 5.sec)          // 只覆盖 timeout
connect("localhost", port: 9090, timeout: 5.sec)
```

### 6.4 递归与尾调用优化

```axon
// 尾递归自动优化
fn factorial(n: Int, acc: Int = 1) -> Int {
    if n <= 1 { acc }
    else { factorial(n - 1, n * acc) }  // 尾调用，编译为循环
}

// 互递归（用 mutual 声明）
mutual {
    fn isEven(n: Int) -> Bool {
        if n == 0 { true } else { isOdd(n - 1) }
    }

    fn isOdd(n: Int) -> Bool {
        if n == 0 { false } else { isEven(n - 1) }
    }
}
```

---

## 7. 模式匹配

### 7.1 match 表达式

```axon
// 基本语法（必须穷举所有情况）
match value {
    pattern1 => expression1
    pattern2 => expression2
    _        => default_expression  // 通配符
}
```

### 7.2 可用模式

```axon
// 字面量模式
match n {
    0     => "zero"
    1     => "one"
    2..=9 => "small"
    _     => "large"
}

// 枚举模式
match shape {
    Circle { radius }           => Pi * radius * radius
    Rectangle { width, height } => width * height
    Triangle { base, height }   => 0.5 * base * height
}

// 元组模式
match (x, y) {
    (0, 0) => "origin"
    (x, 0) => "on x-axis: {x}"
    (0, y) => "on y-axis: {y}"
    (x, y) => "point ({x}, {y})"
}

// 列表模式
match list {
    []             => "empty"
    [x]            => "one: {x}"
    [x, y]         => "two: {x}, {y}"
    [x, y, ..rest] => "many, first two: {x}, {y}"
}

// Option 模式（常用）
match opt {
    Some(x) => use(x)
    None    => default()
}

// Result 模式（常用）
match result {
    Ok(value) => process(value)
    Err(e)    => handleError(e)
}

// 守卫条件
match value {
    x if x > 0 => "positive"
    x if x < 0 => "negative"
    _           => "zero"
}

// 绑定 + 模式（@ 操作符）
match list {
    all @ [_, _, ..] => "has at least 2: {all}"
    _                => "too short"
}

// 嵌套模式
match user {
    User { name, age: 18..=65, .. } => "working age: {name}"
    User { name, age, .. }          => "{name} is {age}"
}
```

---

## 8. 类型定义

### 8.1 枚举（代数数据类型）

```axon
// 无数据的变体（枚举）
type Direction = North | South | East | West

// 带数据的变体（代数数据类型）
type Shape =
    | Circle    { radius: Float }
    | Rectangle { width: Float, height: Float }
    | Triangle  { base: Float, height: Float }
    | Point                                     // 无数据变体

// 递归类型
type Tree<T> =
    | Leaf
    | Node { value: T, left: Tree<T>, right: Tree<T> }

// 嵌套泛型
type Result<T, E> =
    | Ok(T)
    | Err(E)

type Option<T> =
    | Some(T)
    | None
```

### 8.2 类型别名

```axon
type UserId    = Int where n > 0
type Email     = String where valid_email(self)
type Port      = Int where n >= 1 and n <= 65535
type NonEmpty<T> = List<T> where List.len(self) > 0

// 简单别名（无约束）
type Name    = String
type Age     = Int
type Handler = String -> Result<Unit, Error> | IO
```

### 8.3 精化类型（Refinement Types）

```axon
// 精化类型：在基础类型上附加谓词
// 谓词在创建时编译期验证（静态可知时）或运行时验证

type PositiveFloat = Float where self > 0.0
type Percentage    = Float where self >= 0.0 and self <= 100.0
type NonBlank      = String where String.trim(self) != ""

// 使用精化类型
fn calculateTax(amount: PositiveFloat, rate: Percentage) -> PositiveFloat {
    amount * rate / 100.0  // 编译器证明结果也是 PositiveFloat
}

// 运行时精化类型检查（当值来自外部时）
fn parsePort(s: String) -> Result<Port, ParseError> {
    let n = Int.parse(s)?
    Port.refine(n)  // 返回 Result<Port, RefinementError>
}
```

---

## 9. Trait 系统

### 9.1 Trait 声明

```axon
// Trait 定义行为接口
trait Printable {
    fn print(self) -> Unit | IO
    fn format(self) -> String  // 可以有默认实现
}

trait Comparable<T> {
    fn compare(self, other: T) -> Ordering

    // 默认实现
    fn less_than(self, other: T) -> Bool {
        self.compare(other) == Ordering.Less
    }
    fn greater_than(self, other: T) -> Bool {
        self.compare(other) == Ordering.Greater
    }
}

// Ordering 内置枚举
type Ordering = Less | Equal | Greater
```

### 9.2 Trait 实现

```axon
type Point = { x: Float, y: Float }

impl Printable for Point {
    fn print(self) -> Unit | IO {
        print("Point({self.x}, {self.y})")
    }
    fn format(self) -> String {
        "({self.x}, {self.y})"
    }
}

impl Comparable<Point> for Point {
    fn compare(self, other: Point) -> Ordering {
        let d1 = self.x * self.x + self.y * self.y
        let d2 = other.x * other.x + other.y * other.y
        Float.compare(d1, d2)
    }
}
```

### 9.3 Trait 约束

```axon
// 泛型函数中使用 Trait 约束
fn printAll<T: Printable>(items: List<T>) -> Unit | IO {
    for item in items {
        item.print()
    }
}

// 多约束
fn processAndPrint<T: Comparable<T> + Printable>(items: List<T>) -> Unit | IO {
    let sorted = items |> List.sort()
    printAll(sorted)
}

// where 子句（复杂约束时使用）
fn zipWith<A, B, C>(
    xs: List<A>,
    ys: List<B>,
    f:  (A, B) -> C
) -> List<C>
where A: Clone, B: Clone
{
    ...
}
```

### 9.4 内置核心 Trait

```axon
trait Clone  { fn clone(self) -> Self }
trait Debug  { fn debug(self) -> String }
trait Hash   { fn hash(self) -> UInt64 }
trait Eq     { fn eq(self, other: Self) -> Bool }
trait Ord    { fn compare(self, other: Self) -> Ordering }

trait Show   { fn show(self) -> String }  // 用于字符串插值
trait Parse  { fn parse(s: String) -> Result<Self, ParseError> }

trait Iterator<T> {
    fn next(self) -> Option<(T, Self)>
}

trait Into<T>   { fn into(self) -> T }
trait From<T>   { fn from(val: T) -> Self }
trait TryFrom<T> { fn try_from(val: T) -> Result<Self, ConversionError> }
```

---

## 10. Effect 系统

完整说明见 `EFFECTS.md`，此处为摘要。

### 10.1 内置 Effect

```axon
effect IO          // 文件、标准输入输出、系统调用
effect Async       // 异步操作（非阻塞 I/O）
effect State<S>    // 可变状态
effect Raise<E>    // 可恢复错误（非 panic）
effect Log         // 日志记录
effect Trace       // 执行追踪
effect Random      // 随机数生成（使其纯函数化）
effect Time        // 时钟访问（使其可测试）
effect NetworkIO   // 网络 I/O（IO 的子集）
effect FileIO      // 文件 I/O（IO 的子集）
```

### 10.2 Effect 声明与传播

```axon
// 函数声明带 effect
fn readFile(path: Path) -> Result<String, IOError> | IO

// Effect 自动传播（如果调用了带 effect 的函数，自己也必须声明该 effect）
fn processFile(path: Path) -> Result<Data, Error> | IO {
    let content = readFile(path)?  // readFile 有 IO effect
    // 所以 processFile 也必须声明 | IO
    Ok(parse(content))
}

// 纯函数（无 effect 声明）
fn parseJson(s: String) -> Result<Json, ParseError> {
    // 如果这里调用了有副作用的函数，编译器报错
    ...
}
```

### 10.3 Capability 系统

```axon
// 声明能力
capability FileRead   = allows FileIO where mode == ReadOnly
capability FileWrite  = allows FileIO where mode == Write
capability Network    = allows NetworkIO
capability SpawnAgent = allows spawning new Agents

// Agent 声明所需能力
agent SecureProcessor {
    requires FileRead, Network  // 只有这两种权限

    // 编译器拒绝任何超出 requires 范围的操作
    on Process(data: Data) -> Result<Output, Error> | Async {
        let config = File.read("config.json")?  // OK: FileRead
        let result = await http.post(url, data)?  // OK: Network
        // File.delete("config.json")  // 编译错误：需要 FileWrite 能力
        Ok(result)
    }
}
```

---

## 11. Agent 模型

完整说明见 `AGENT_MODEL.md`。

### 11.1 Agent 声明

```axon
agent AgentName {
    // 可选：能力声明
    requires Capability1, Capability2

    // 状态定义
    state {
        field1: Type1 = default_value1
        field2: Type2 = default_value2
    }

    // 消息处理器
    on MessageType(params...) -> ReturnType | Effects {
        // 处理逻辑
        // 可以访问和修改 state
        // 可以发送消息给其他 agent
    }

    // 生命周期钩子（可选）
    on Start -> Unit {
        // agent 启动时执行
    }

    on Stop -> Unit {
        // agent 停止时执行（清理资源）
    }

    on Error(err: AgentError) -> ErrorAction {
        // 错误处理策略
        Restart  // | Stop | Ignore | Escalate
    }
}
```

### 11.2 使用 Agent

```axon
fn main() -> Unit | Async, IO {
    // 创建 agent（返回 AgentRef<AgentName>）
    let agent: AgentRef<Counter> = spawn Counter

    // 发送消息（fire-and-forget）
    agent.send(Increment)
    agent.send(Increment)

    // 请求响应（ask-response，返回 Future）
    let count: Int = await agent.ask(GetCount)
    print("Count: {count}")

    // 停止 agent
    agent.stop()

    // 监督树
    let supervisor = Supervisor.new(
        strategy: Strategy.OneForOne,
        children: [
            Spec.new(Worker1, name: "w1"),
            Spec.new(Worker2, name: "w2"),
        ]
    )
}
```

### 11.3 Agent 监督

```axon
// 监督策略
type SupervisionStrategy =
    | OneForOne   // 一个子 agent 崩溃，只重启它
    | AllForOne   // 一个子 agent 崩溃，重启所有子 agent
    | RestForOne  // 一个子 agent 崩溃，重启它和它之后定义的 agent

// 错误动作
type ErrorAction =
    | Restart                    // 重启 agent，状态重置
    | RestartWith(State)         // 重启 agent，用指定状态
    | Stop                       // 停止 agent
    | Escalate                   // 将错误传递给监督者
    | Ignore                     // 忽略错误，继续运行
```

---

## 12. 模块系统

### 12.1 模块声明

```axon
// 每个文件是一个模块
// 文件顶部声明模块名（必须与文件路径对应）
module com.example.myapp.UserService

// 导入
use std.io
use std.async.{Async, await}
use com.example.myapp.{User, UserId}
use com.example.db.Database as DB

// 重导出
pub use std.result.{Result, Ok, Err}
```

### 12.2 可见性

```axon
// pub：公开，任何模块可访问
pub fn publicFunction() -> Unit { ... }
pub type PublicType = { ... }

// internal：模块内的同一包（package）可访问
internal fn packageFunction() -> Unit { ... }

// priv（默认）：只有当前模块可访问
priv fn helperFunction() -> Unit { ... }
fn alsoPrivate() -> Unit { ... }  // 没有修饰符 = priv
```

### 12.3 包管理

```axon
// axon.toml（包配置文件）
[package]
name    = "my-agent"
version = "0.1.0"
edition = "2024"

[dependencies]
axon-std    = "1.0"
axon-http   = "2.1"
axon-llm    = "0.5"
```

---

## 13. 热更新

完整说明见 `HOT_RELOAD.md`。

### 13.1 基本热更新

```axon
// 标记模块支持热更新
#[hot]
module MyService

// 被 #[hot] 标记的模块：
// 1. 编译器生成热更新接口
// 2. 运行时注册该模块的热更新钩子
// 3. 当文件变更时，自动触发增量重编译 + 代码注入
```

### 13.2 Agent 状态迁移

```axon
// 当 Agent 的 state 结构变化时，声明如何迁移
migrate MyAgent.State {
    from V1 {
        items: List<Item>
    }
    to V2 {
        items:  List<Item>
        lookup: Map<ItemId, Item>  // 新增缓存
    }
    with |old| {
        items:  old.items,
        lookup: old.items |> List.map(|i| (i.id, i)) |> Map.from()
    }
}
```

### 13.3 热更新 API

```axon
// 手动触发热更新（通常由构建工具自动触发）
HotReload.apply(module: "MyService", delta: compiled_delta)

// 监听热更新事件
HotReload.on_update(|module_name, version| {
    Log.info("Module {module_name} updated to version {version}")
})

// 暂停/恢复热更新（在维护窗口使用）
HotReload.pause()
// ... 批量更新多个模块 ...
HotReload.resume()
```

---

## 14. 标准库概览

### 14.1 核心模块

```axon
std.core    // 基本类型、Result、Option、Ordering 等（自动导入）
std.io      // 文件、标准输入输出
std.async   // 异步原语
std.net     // 网络（TCP、UDP、HTTP）
std.http    // HTTP 客户端/服务器
std.json    // JSON 序列化/反序列化
std.time    // 时间和日期
std.math    // 数学函数
std.random  // 随机数
std.log     // 结构化日志
std.trace   // 执行追踪
```

### 14.2 Agent 相关模块

```axon
std.agent       // AgentRef、spawn、Supervisor
std.channel     // Channel<T>（CSP 风格通信）
std.hot_reload  // 热更新 API
std.capability  // 能力声明和验证
```

### 14.3 AI 相关模块

```axon
std.llm         // LLM 接口（统一的 LLM 调用抽象）
std.prompt      // Prompt 构建和管理
std.embed       // 向量嵌入
std.rag         // 检索增强生成工具
std.tool        // AI Tool Call 定义和注册
```

```axon
// AI 模块示例
use std.llm.{LLM, Model, Message}

fn askGPT(question: String) -> Result<String, LLMError> | Async, IO {
    let client = LLM.connect(Model.Claude3Sonnet)?
    let resp   = await client.complete([
        Message.system("You are a helpful assistant."),
        Message.user(question)
    ])?
    Ok(resp.content)
}

// 结构化输出（类型安全的 LLM 响应）
type Analysis = {
    sentiment: Sentiment
    score:     Float where self >= 0.0 and self <= 1.0
    keywords:  List<String>
}

fn analyzeText(text: String) -> Result<Analysis, LLMError> | Async, IO {
    LLM.structured::<Analysis>(
        prompt: "Analyze: {text}",
        model:  Model.Claude3Sonnet
    )
}
```
