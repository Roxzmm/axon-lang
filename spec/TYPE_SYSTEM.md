# Axon 类型系统详解

## 概述

Axon 的类型系统基于以下理论基础：
- **Hindley-Milner 类型推断**（ML 系语言的基础）
- **代数数据类型（ADT）**（Haskell/Rust 的枚举模式）
- **精化类型（Refinement Types）**（Liquid Haskell 的启发）
- **行多态 Effect 系统**（Koka/Effekt 的启发）
- **线性类型 Lite**（Rust 所有权系统的简化版）

**核心承诺**：类型系统的设计目标是——**所有类型错误都在编译期发现，运行时零类型错误**。

---

## 1. 类型推断

### 1.1 双向类型推断

Axon 使用双向类型推断（Bidirectional Type Checking），结合：
- **推断（Synthesize）**：从表达式推断出类型
- **检查（Check）**：验证表达式符合期望类型

```axon
// 推断：编译器从右侧推断左侧类型
let x = 42          // x: Int（推断）
let y = "hello"     // y: String（推断）
let z = (1, true)   // z: (Int, Bool)（推断）

// 检查：有注解时，编译器验证
let x: Float = 42   // 检查 42 能否转换为 Float？可以（整数字面量多态）
let y: Int = "hi"   // 错误！String 不是 Int

// 整数字面量多态（numeric literal polymorphism）
let a: Int8   = 100
let b: Int64  = 100
let c: Float  = 100
let d: UInt32 = 100
// 字面量 100 可以是任何数值类型，只要在范围内
```

### 1.2 泛型推断

```axon
// 泛型函数的类型参数自动推断
fn identity<T>(x: T) -> T { x }

let n = identity(42)      // T 推断为 Int
let s = identity("hi")    // T 推断为 String

// 容器类型推断
fn first<T>(xs: List<T>) -> Option<T> {
    match xs {
        [x, ..] => Some(x)
        []      => None
    }
}

let xs: List<String> = ["a", "b", "c"]
let h = first(xs)  // Option<String>，T 推断为 String
```

### 1.3 推断限制（需要显式注解的场景）

```axon
// 1. 模块公开函数（最佳实践：总是写返回类型）
pub fn processUser(id: UserId) -> Result<User, Error> | IO { ... }

// 2. 递归函数（递归基础类型无法纯推断）
fn fib(n: Int) -> Int {  // 需要 -> Int
    if n <= 1 { n } else { fib(n-1) + fib(n-2) }
}

// 3. 空集合字面量
let empty: List<Int> = []  // 需要注解，否则无法推断元素类型
let empty2 = [] : List<Int>  // 另一种写法

// 4. 类型歧义时
let x = parse("42")  // 解析成 Int？Float？需要注解
let x: Int = parse("42")  // 明确
```

---

## 2. 代数数据类型（ADT）

### 2.1 乘积类型（Product Types）

乘积类型表示"A 且 B"——同时包含所有字段：

```axon
// Record（命名字段的乘积类型）
type Person = {
    name: String
    age:  Int
    email: Email
}

// Tuple（位置字段的乘积类型）
type Point2D = (Float, Float)
type RGB = (UInt8, UInt8, UInt8)
```

### 2.2 和类型（Sum Types）

和类型表示"A 或 B"——只是其中一种：

```axon
// 枚举（简单和类型）
type Weekday = Mon | Tue | Wed | Thu | Fri | Sat | Sun

// 带数据的和类型（ADT）
type Json =
    | JsonNull
    | JsonBool(Bool)
    | JsonInt(Int)
    | JsonFloat(Float)
    | JsonString(String)
    | JsonArray(List<Json>)
    | JsonObject(Map<String, Json>)

// 递归 ADT（树结构）
type Expr =
    | Num(Float)
    | Var(String)
    | Add(Expr, Expr)
    | Mul(Expr, Expr)
    | Neg(Expr)
    | If { cond: Expr, then: Expr, else_: Expr }
```

### 2.3 穷举匹配保证

```axon
fn eval(expr: Expr, env: Map<String, Float>) -> Float {
    match expr {
        Num(n)          => n
        Var(name)       => env[name]!  // 已知存在（或运行时 panic）
        Add(left, right) => eval(left, env) + eval(right, env)
        Mul(left, right) => eval(left, env) * eval(right, env)
        Neg(inner)      => -eval(inner, env)
        If { cond, then, else_ } =>
            if eval(cond, env) != 0.0 {
                eval(then, env)
            } else {
                eval(else_, env)
            }
    }
    // 编译器验证：Expr 的所有变体都被覆盖
    // 如果漏掉一个变体，编译错误
}
```

---

## 3. 精化类型（Refinement Types）

### 3.1 基本语法

```axon
// 语法：BaseType where predicate(self)
type T = BaseType where condition

// 常用精化类型
type PositiveInt    = Int    where self > 0
type NonNegativeInt = Int    where self >= 0
type Port           = Int    where self >= 1    and self <= 65535
type Probability    = Float  where self >= 0.0  and self <= 1.0
type NonEmpty<T>    = List<T> where List.len(self) > 0
type Email          = String where String.matches(self, email_regex)
type FilePath       = String where Path.is_valid(self)
```

### 3.2 编译期 vs 运行时验证

精化谓词分为两类：

**编译期可验证（SMT 求解器）**：
- 简单算术比较（`n > 0`，`n < 100`）
- 长度约束（`len > 0`）
- 简单的逻辑组合（`and`、`or`、`not`）

**运行时验证**（来自外部时）：
- 正则表达式检查
- 复杂业务逻辑

```axon
// 编译期验证示例
fn divide(a: Int, b: PositiveInt) -> Int {
    a / b  // 编译器知道 b > 0，安全！
}

divide(10, 2)   // OK：字面量 2 满足 PositiveInt
divide(10, 0)   // 编译错误：0 不满足 self > 0
divide(10, n)   // 需要 n: PositiveInt 或提供证明

// 运行时验证（从外部输入构建精化类型）
fn parsePort(s: String) -> Result<Port, ValidationError> {
    let n = Int.parse(s)?
    Port.refine(n)  // 返回 Result<Port, ValidationError>
    // 如果 n 不在 1-65535，返回 Err
}

// 提升：当你有逻辑证明时
fn double(n: PositiveInt) -> PositiveInt {
    // 编译器推断：n > 0 => n + n > 0
    n + n  // 返回类型仍然是 PositiveInt
}
```

### 3.3 精化类型与函数契约

```axon
// 前置条件和后置条件（通过精化类型表达）
fn sqrt(x: Float where self >= 0.0) -> Float where self >= 0.0 {
    // x 的精化：non-negative（前置条件）
    // 返回值的精化：non-negative（后置条件）
    Float.sqrt(x)
}

// 更复杂的契约
fn binarySearch<T: Ord>(
    arr:    Array<T> where Array.is_sorted(self),  // 必须有序
    target: T
) -> Option<Int where self >= 0 and self < Array.len(arr)> {
    // 返回的 Int 是有效索引（如果存在）
    ...
}
```

---

## 4. 线性类型（Linear Types）

### 4.1 什么是线性类型

线性类型（Linear/Affine Types）：一个值**恰好使用一次**（线性）或**最多使用一次**（仿射）。

Axon 使用仿射类型（可以不使用，但不能使用两次）来管理资源。

### 4.2 线性资源

被 `#[linear]` 标注的类型是线性资源：

```axon
// 标准库中的线性类型示例
#[linear]
type File = ...

#[linear]
type TcpStream = ...

#[linear]
type DatabaseTransaction = ...
```

### 4.3 线性类型的约束

```axon
fn processFile(path: Path) -> Result<String, IOError> | IO {
    let file: File = File.open(path)?  // file 是线性值

    let content = file.read_all()?     // file 被"消费"（移动）

    // 在 read_all 之后，file 不可再用（编译器报错）
    // file.close()  // 错误：file 已被消费

    // read_all 返回新的 file（或者显式 close）
    // 实际上 read_all 的签名是：
    // fn read_all(self: File) -> Result<(String, File), IOError>
    // 或者：
    // fn read_all(self: File) -> Result<String, IOError>  // File 自动 close

    Ok(content)
}

// 正确使用方式
fn processFile2(path: Path) -> Result<String, IOError> | IO {
    let file = File.open(path)?
    let (content, file) = file.read_all_keep()?  // 保留 file
    file.close()?  // 显式 close
    Ok(content)
}

// 或用 RAII 风格的 with 语句
fn processFile3(path: Path) -> Result<String, IOError> | IO {
    with file = File.open(path)? {  // 块结束时自动 close
        file.read_all()
    }
}
```

### 4.4 未使用线性值的警告/错误

```axon
fn bad() -> Unit | IO {
    let file = File.open("data.txt")?
    // 没有使用 file，也没有 close！
    // 编译器：错误，线性值 'file' 未被使用（内存/资源泄漏）
}
```

---

## 5. 类型系统安全保证汇总

| 安全性 | 机制 | 保证级别 |
|--------|------|----------|
| **Null 安全** | `Option<T>` 代替 null | 编译期 |
| **错误处理** | `Result<T, E>` 代替异常 | 编译期 |
| **类型转换** | 无隐式转换，`Into`/`From` trait | 编译期 |
| **整数溢出** | 溢出检查，返回 `Result<Int, Overflow>` | 运行时检查 |
| **数组越界** | 返回 `Option<T>`，`!` 强制解包时 panic | 运行时检查 |
| **Use-after-free** | GC + 线性类型 | 编译期/GC |
| **数据竞争** | Effect 系统追踪状态，Actor 模型隔离 | 编译期 |
| **资源泄漏** | 线性类型强制 close/free | 编译期 |
| **业务约束** | 精化类型 | 编译期（部分运行时）|
| **副作用泄漏** | Effect 系统 | 编译期 |

**结论**：Axon 程序如果能通过编译，可以保证上表中"编译期"级别的所有安全属性。运行时检查的项目会产生明确的错误，而非未定义行为。
