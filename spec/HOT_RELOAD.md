# Axon 热更新机制

## 概述

热更新（Hot Reload）是 Axon 的核心设计之一，专为 AI Agent 的"快速迭代"需求设计。
目标：**AI 修改代码 → 增量编译 → 运行中的 Agent 无缝升级 → 零停机时间**。

```
[AI 生成新代码]
      ↓
[增量编译器：只编译变更的模块]  (< 100ms)
      ↓
[生成 .axir Delta（二进制差分）]
      ↓
[运行时热更新管理器]
      ↓
[暂停相关 Agent 的消息队列]
      ↓
[执行状态迁移函数]
      ↓
[加载新代码]
      ↓
[恢复消息队列，Agent 继续运行]
```

---

## 1. 热更新的三个层次

### 层次 1：函数热更新（最常见）

函数的**逻辑改变，签名和状态不变**：

```axon
// 旧版本
#[hot]
fn formatResponse(data: Data) -> String {
    "Result: {data.value}"
}

// 新版本（AI 改进了格式）
#[hot]
fn formatResponse(data: Data) -> String {
    // 更丰富的格式
    """
    ╔══════════════╗
    ║ Result       ║
    ╟──────────────╢
    ║ {data.value} ║
    ╚══════════════╝
    """
}
```

**运行时行为**：
- 下一次调用 `formatResponse` 时，直接使用新版本
- 不需要重启，不需要状态迁移
- 已在处理中的调用继续使用旧版本（调用级别的一致性）

### 层次 2：模块热更新（常见）

整个模块的代码更新，**Agent 状态结构不变**：

```axon
// agent.axon（修改了消息处理逻辑）
#[hot]
module AgentLogic

agent DataProcessor {
    state { count: Int = 0 }

    // 旧版本
    on Process(data: Data) -> Output {
        count += 1
        simple_transform(data)
    }
}
```

**运行时行为**：
- 所有 `DataProcessor` 实例继续运行
- 新的 `Process` 消息使用新处理逻辑
- `count` 状态保持不变（状态结构未变）

### 层次 3：状态迁移热更新（复杂场景）

Agent 的**状态结构发生变化**，需要迁移：

```axon
// 旧版本 Agent
agent UserCache {
    state {
        users: List<User> = []
    }
}

// 新版本：AI 添加了按 ID 的快速查找
#[hot]
agent UserCache {
    state {
        users:    List<User>         = []
        by_id:    Map<UserId, User>  = Map.empty()  // 新增！
        by_email: Map<Email, User>   = Map.empty()  // 新增！
    }

    on GetById(id: UserId) -> Option<User> {
        by_id.get(id)  // O(1) 而不是 O(n)
    }
}

// 必须声明如何迁移旧状态到新状态
migrate UserCache.State {
    from V1 {
        users: List<User>
    }
    to V2 {
        users:    List<User>
        by_id:    Map<UserId, User>
        by_email: Map<Email, User>
    }
    with |old| {
        users:    old.users,
        by_id:    old.users
                    |> List.map(|u| (u.id, u))
                    |> Map.from(),
        by_email: old.users
                    |> List.map(|u| (u.email, u))
                    |> Map.from()
    }
}
```

---

## 2. `#[hot]` 标注详解

```axon
// 模块级别（整个模块支持热更新）
#[hot]
module MyModule

// 单个函数（即使模块不是 hot 的）
#[hot]
fn specificFunction() -> Unit { ... }

// 禁止热更新（关键路径，不允许运行时变更）
#[cold]
fn cryptographicCore() -> Bytes { ... }

// 带配置的 hot 标注
#[hot(strategy = "drain")]  // 等待当前消息处理完再热更新
#[hot(strategy = "immediate")]  // 立即热更新（默认）
#[hot(strategy = "scheduled", at = "2024-01-01T00:00:00Z")]  // 定时热更新
```

---

## 3. 状态迁移规范

### 3.1 完整语法

```axon
migrate AgentName.State {
    from VersionName {
        field1: Type1
        field2: Type2
    }
    to VersionName {
        field1: Type1
        field2: Type2
        field3: Type3  // 新字段
    }
    with |old_state| {
        field1: transform(old_state.field1),
        field2: old_state.field2,       // 直接保留
        field3: compute_from(old_state) // 从旧状态计算新字段
    }
}
```

### 3.2 迁移链（多版本跳跃）

```axon
// 如果从 V1 跳到 V3，运行时自动链式应用迁移
migrate UserCache.State {
    from V1 { users: List<User> }
    to   V2 { users: List<User>, by_id: Map<UserId, User> }
    with |old| { users: old.users, by_id: build_index(old.users) }
}

migrate UserCache.State {
    from V2 { users: List<User>, by_id: Map<UserId, User> }
    to   V3 { users: List<User>, by_id: Map<UserId, User>, version: Int }
    with |old| { users: old.users, by_id: old.by_id, version: 3 }
}

// 运行时：V1 实例 → 应用 V1→V2 迁移 → 应用 V2→V3 迁移 → V3 实例
```

### 3.3 迁移安全保证

迁移函数有以下编译期检查：
1. **类型完整性**：`to` 块中所有字段都在 `with` 中赋值
2. **旧字段存在性**：`old.field` 中的 `field` 必须在 `from` 块中存在
3. **迁移函数纯洁性**：迁移函数必须是纯函数（不能有 IO 等副作用）

```axon
migrate MyAgent.State {
    from V1 { count: Int }
    to   V2 { count: Int, label: String }
    with |old| {
        count: old.count,
        label: readFileForLabel()  // 编译错误！迁移函数不能有 IO
    }
}
```

---

## 4. 增量编译器

### 4.1 模块依赖图

```
main.axon
├── agent_logic.axon
│   ├── data_model.axon
│   └── transforms.axon
└── http_server.axon
    └── routes.axon
```

当 `transforms.axon` 改变时，增量编译器：
1. 只重新编译 `transforms.axon`
2. 检查 `agent_logic.axon` 是否因接口变化需要重编译
3. 如果接口（类型签名）未变，`agent_logic.axon` 不重编译

**典型增量编译时间**：
- 单文件逻辑改变（签名不变）：10-50ms
- 单文件签名改变（影响依赖）：50-200ms
- 全量编译（首次或大改动）：1-10s

### 4.2 `.axir` 二进制增量格式

```
.axir Delta 文件格式：

[Header]
  magic: 0x41584952  ("AXIR")
  version: u16
  module_id: u64

[Sections]
  [Functions]
    - function_id: u32
    - old_hash: u64    (如果为 0 = 新增函数)
    - new_hash: u64
    - bytecode: bytes

  [Types]
    - type changes...

  [Migrations]
    - state migration code...

  [Metadata]
    - source maps
    - debug info
```

---

## 5. 热更新 API

### 5.1 程序化热更新

```axon
use std.hot_reload.{HotReload, UpdateEvent}

// 监听文件变化并自动热更新
fn startWithHotReload() -> Unit | IO, Async {
    let watcher = FileWatcher.watch("./src/**/*.axon")

    for event in watcher.events() {
        match event {
            FileChanged(path) => {
                let result = await HotReload.reload_file(path)
                match result {
                    Ok(delta)  => Log.info("Updated: {path}, delta size: {delta.size} bytes")
                    Err(error) => Log.error("Hot reload failed: {error}")
                }
            }
            _ => {}
        }
    }
}

// 手动触发更新
fn applyUpdate(module: String, code: String) -> Result<Unit, HotReloadError> | IO {
    let delta = Compiler.compile_delta(module, code)?
    HotReload.apply(delta)
}
```

### 5.2 热更新钩子

```axon
#[hot]
module MyService

// 热更新前的钩子
#[before_hot_reload]
fn beforeReload() -> Unit | IO {
    Log.info("About to hot reload MyService")
    // 可以在这里保存临时状态、通知监控系统等
}

// 热更新后的钩子
#[after_hot_reload]
fn afterReload(old_version: Int, new_version: Int) -> Unit | IO {
    Log.info("MyService updated from v{old_version} to v{new_version}")
    // 可以在这里重新初始化缓存、发送健康检查等
}
```

### 5.3 回滚机制

```axon
// 如果热更新后出现问题，可以回滚
fn safeUpdate(module: String, code: String) -> Result<Unit, Error> | IO, Async {
    let snapshot = HotReload.snapshot()  // 保存当前状态

    let result = HotReload.apply_module(module, code)

    match result {
        Ok(_) => {
            // 等待 5 秒观察是否有错误激增
            await Time.sleep(5.sec)
            let error_rate = Metrics.error_rate_last(5.sec)
            if error_rate > 0.01 {  // > 1% 错误率
                Log.warn("High error rate after update, rolling back")
                HotReload.rollback(snapshot)
                Err(HighErrorRateAfterUpdate)
            } else {
                Ok(())
            }
        }
        Err(e) => {
            HotReload.rollback(snapshot)
            Err(e)
        }
    }
}
```

---

## 6. 与 Erlang/Elixir 热更新对比

| 特性 | Erlang/OTP | Axon |
|------|-----------|------|
| 热更新粒度 | 模块级别 | 函数/模块/Agent |
| 状态迁移 | 手动 `code_change` 回调 | 声明式 `migrate` 块 |
| 多版本并存 | 2个版本（老版/新版） | 完整版本链，支持多跳迁移 |
| 类型检查 | 无（动态语言） | 编译期类型安全 |
| 语法复杂度 | 中等（需要了解 OTP） | 简单（`#[hot]` 注解） |
| AI 生成难度 | 中（需要知道 OTP 约定）| 低（声明式，模式固定）|
| 回滚支持 | 有（但手动）| 有（自动快照 + 一键回滚）|
