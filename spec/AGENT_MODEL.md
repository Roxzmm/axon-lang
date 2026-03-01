# Axon Agent 编程模型

## 概述

Axon 的 Agent 模型融合了三种并发理论：
1. **Actor 模型**（Erlang/Akka）：消息传递、状态封装、故障隔离
2. **结构化并发**（Swift Concurrency/Trio）：生命周期层级、错误传播
3. **CSP 通道**（Go）：用于高吞吐量的生产者-消费者场景

**核心理念**：每个 Agent 是一个独立的计算单元，有自己的状态、消息队列和生命周期。Agent 之间**只通过消息通信**，不共享内存。

---

## 1. Agent 基础

### 1.1 最简单的 Agent

```axon
agent HelloAgent {
    on Greet(name: String) -> String {
        "Hello, {name}!"
    }
}

fn main() -> Unit | Async, IO {
    let agent = spawn HelloAgent
    let msg   = await agent.ask(Greet("World"))
    print(msg)  // "Hello, World!"
    agent.stop()
}
```

### 1.2 带状态的 Agent

```axon
agent Counter {
    state {
        count:   Int      = 0
        history: List<Int> = []
    }

    on Increment -> Unit {
        history = history |> List.prepend(count)
        count   = count + 1
    }

    on Decrement -> Unit {
        history = history |> List.prepend(count)
        count   = count - 1
    }

    on Reset -> Unit {
        history = history |> List.prepend(count)
        count   = 0
    }

    on GetCount -> Int {
        count
    }

    on GetHistory -> List<Int> {
        history
    }
}
```

### 1.3 消息定义

消息是 Agent 的"API"。推荐单独定义消息类型：

```axon
// messages.axon
module MyApp.Messages

// Agent 消息类型
type CounterMsg =
    | Increment
    | Decrement
    | Reset
    | GetCount
    | GetHistory

// 使用消息类型约束 Agent（可选，但推荐）
agent TypedCounter : CounterMsg {
    // 编译器验证所有消息都被处理
    ...
}
```

---

## 2. Agent 消息传递

### 2.1 三种通信模式

```axon
// 1. Tell（发送，不等待响应）
agent.send(Increment)    // fire-and-forget

// 2. Ask（发送，等待响应）
let count = await agent.ask(GetCount)   // 阻塞直到响应

// 3. Ask with timeout
let result = await agent.ask(GetCount, timeout: 5.sec)
// result: Result<Int, TimeoutError>
```

### 2.2 批量消息

```axon
// 原子地发送多条消息（都进入队列后才处理）
agent.send_batch([Increment, Increment, Increment])

// 等待批量响应
let results = await agent.ask_batch([GetCount, GetHistory])
// results: (Int, List<Int>)
```

### 2.3 广播

```axon
// Agent 群组广播
let group = AgentGroup.new([worker1, worker2, worker3])
group.broadcast(Process(data))

// 等待所有响应
let results = await group.ask_all(GetStatus)
// results: List<Status>

// 等待第一个响应
let first = await group.ask_any(GetStatus)
// first: Status
```

---

## 3. Agent 生命周期

### 3.1 生命周期钩子

```axon
agent DatabaseAgent {
    state { db: Database }  // 注意：db 没有默认值，需要在 Start 中初始化

    on Start(config: DBConfig) -> Unit | IO {
        // Start 是特殊消息，在 Agent 初始化时发送
        db = Database.connect(config.url, config.pool_size)?
        Log.info("DatabaseAgent started, connected to {config.url}")
    }

    on Stop -> Unit | IO {
        // Stop 是特殊消息，在 Agent 停止时发送
        db.disconnect()
        Log.info("DatabaseAgent stopped, connection closed")
    }

    on Query(sql: String) -> Result<Rows, DBError> | IO {
        db.execute(sql)
    }
}

// 带初始化参数启动 Agent
let db_agent = spawn DatabaseAgent with Start(DBConfig {
    url:       "postgresql://localhost/mydb",
    pool_size: 10
})
```

### 3.2 Agent 引用类型

```axon
// AgentRef<A> 是对 Agent A 的引用（可能在远程节点上）
let local: AgentRef<Counter>  = spawn Counter
let remote: AgentRef<Counter> = cluster.find("counter-1")

// 两种引用使用方式相同（透明远程调用）
let n = await local.ask(GetCount)
let m = await remote.ask(GetCount)  // 自动序列化/网络传输
```

---

## 4. 监督树（Supervision Tree）

### 4.1 监督者定义

```axon
// 监督者管理子 Agent 的生命周期
supervisor AppSupervisor {
    strategy: OneForOne  // 一个崩溃只重启它自己

    children: [
        Spec.permanent(DatabaseAgent, Start(db_config)),  // 永久运行
        Spec.permanent(CacheAgent),
        Spec.transient(WorkerAgent),  // 正常退出不重启
        Spec.temporary(TaskAgent),   // 任何退出都不重启
    ]

    // 重启限制：10秒内最多重启3次，超过则让监督者自己崩溃
    max_restarts: 3
    restart_window: 10.sec
}
```

### 4.2 监督策略详解

```axon
type SupervisionStrategy =
    // 一个崩溃 → 只重启它
    | OneForOne

    // 一个崩溃 → 停止所有子 Agent，然后全部重启
    | AllForOne

    // 一个崩溃 → 重启它以及在它之后定义的所有子 Agent
    // 适用于有依赖顺序的场景
    | RestForOne
```

### 4.3 错误处理策略

```axon
agent WorkerAgent {
    on Error(err: AgentError) -> ErrorAction {
        match err {
            NetworkError(_)  => Restart              // 网络错误：重启
            DatabaseError(e) => {
                Log.error("DB error: {e}")
                RestartWith(State.initial())          // 重置状态后重启
            }
            FatalError(e)    => {
                alert.send("Fatal: {e}")
                Escalate                             // 传递给监督者
            }
            _               => Ignore               // 其他：忽略继续
        }
    }
}
```

---

## 5. Agent 模式

### 5.1 请求-响应（RPC 模式）

```axon
agent CalculatorAgent {
    on Calculate(expr: String) -> Result<Float, ParseError> {
        Expr.parse(expr) |> Result.map(Expr.eval)
    }
}

fn main() -> Unit | Async, IO {
    let calc = spawn CalculatorAgent
    let result = await calc.ask(Calculate("3 * (4 + 2)"))
    print(result)  // Ok(18.0)
}
```

### 5.2 流处理（Stream 模式）

```axon
agent StreamProcessor {
    state { buffer: List<Event> = [] }

    on Event(e: Event) -> Unit {
        buffer = buffer |> List.prepend(e)
        // 每积累 100 个事件，批量处理
        if buffer |> List.len() >= 100 {
            let batch = buffer |> List.reverse()
            buffer = []
            processAndEmit(batch)
        }
    }

    on Flush -> List<ProcessedEvent> {
        let result = buffer |> List.reverse() |> processAll()
        buffer = []
        result
    }

    priv fn processAndEmit(events: List<Event>) -> Unit | IO {
        let processed = events |> List.map(process)
        // 发给下游 Agent
        downstream.send(BatchReady(processed))
    }
}
```

### 5.3 状态机 Agent

```axon
type TrafficLightState = Red | Yellow | Green

agent TrafficLight {
    state { current: TrafficLightState = Red }

    on Next -> TrafficLightState {
        current = match current {
            Red    => Green
            Green  => Yellow
            Yellow => Red
        }
        current
    }

    on GetState -> TrafficLightState {
        current
    }
}
```

### 5.4 聚合器 Agent（收集多个来源）

```axon
agent MetricsAggregator {
    state { metrics: Map<String, Float> = Map.empty() }

    on Report(key: String, value: Float) -> Unit {
        metrics = metrics |> Map.insert(key, value)
    }

    on Snapshot -> Map<String, Float> {
        metrics
    }

    on Reset -> Unit {
        metrics = Map.empty()
    }
}

// 多个 Worker 向同一个 Aggregator 报告
fn runWorkers() -> Unit | Async, IO {
    let agg = spawn MetricsAggregator
    let workers = List.range(0, 10)
        |> List.map(|i| spawn Worker with Start(i, agg))

    // 等待所有 worker 完成
    await workers |> List.map(|w| w.ask(WaitDone)) |> Async.all()

    let snapshot = await agg.ask(Snapshot)
    print("Final metrics: {snapshot}")
}
```

---

## 6. 分布式 Agent

### 6.1 集群配置

```axon
// cluster.axon
module MyApp.Cluster

fn setupCluster() -> Unit | IO {
    Cluster.join(
        self_node:   "node1@192.168.1.1",
        seed_nodes:  ["node2@192.168.1.2", "node3@192.168.1.3"],
        cookie:      SecretKey.env("CLUSTER_COOKIE")
    )
}
```

### 6.2 远程 Agent 引用

```axon
// 在远程节点上启动 Agent
let remote_worker: AgentRef<Worker> = await Cluster.spawn(
    on_node: "node2@192.168.1.2",
    agent:   Worker,
    with:    Start(config)
)

// 使用方式与本地 Agent 完全相同
let result = await remote_worker.ask(Process(data))
```

### 6.3 分布式状态（CRDT）

```axon
// 跨节点共享状态，使用 CRDT（无冲突复制数据类型）
agent DistributedCounter {
    // GCounter：只增不减的分布式计数器
    state { value: GCounter = GCounter.zero() }

    on Increment -> Unit {
        value = value |> GCounter.increment()
        // 自动同步到其他节点
    }

    on GetCount -> Int {
        value |> GCounter.value()  // 返回全局一致的值
    }
}
```

---

## 7. AI Agent 专属功能

### 7.1 LLM Agent

```axon
// 封装 LLM 调用的标准 Agent 模式
agent LLMAgent {
    requires NetworkIO

    state {
        conversation: List<Message> = []
        model:        LLMModel      = LLMModel.ClaudeSonnet
    }

    on Chat(user_msg: String) -> Result<String, LLMError> | Async {
        // 添加用户消息到对话历史
        let user  = Message.user(user_msg)
        conversation = conversation |> List.append(user)

        // 调用 LLM
        let response = await LLM.complete(
            model:    model,
            messages: conversation
        )?

        // 添加助手回复到历史
        let assistant = Message.assistant(response.content)
        conversation = conversation |> List.append(assistant)

        Ok(response.content)
    }

    on ClearHistory -> Unit {
        conversation = []
    }

    on SetModel(m: LLMModel) -> Unit {
        model = m
    }
}
```

### 7.2 工具调用 Agent

```axon
// 注册工具，供 LLM 调用
#[tool]
fn searchWeb(query: String) -> Result<List<SearchResult>, Error> | NetworkIO, Async {
    await SearchEngine.search(query)
}

#[tool]
fn readFile(path: Path) -> Result<String, IOError> | FileIO {
    File.read(path)
}

#[tool]
fn executeCode(language: String, code: String) -> Result<String, ExecError> | ProcessIO {
    Sandbox.run_code(language, code)
}

// Agent 自动注册所有 #[tool] 函数
agent ToolCallingAgent {
    requires NetworkIO, FileIO

    state {
        tools:        ToolRegistry  = ToolRegistry.collect_annotated()
        conversation: List<Message> = []
    }

    on Ask(question: String) -> Result<String, Error> | Async {
        let msg = Message.user(question)
        conversation = conversation |> List.append(msg)

        // LLM 可以调用注册的工具
        let response = await LLM.complete_with_tools(
            messages: conversation,
            tools:    tools
        )?

        // 执行 LLM 请求的工具调用
        let final_response = await executeToolCalls(response)?

        Ok(final_response.content)
    }

    priv fn executeToolCalls(resp: LLMResponse) -> Result<LLMResponse, Error> | Async {
        if resp.tool_calls |> List.is_empty() {
            Ok(resp)
        } else {
            // 执行所有工具调用
            let tool_results = await resp.tool_calls
                |> List.map(|call| tools.execute(call))
                |> Async.all()?

            // 将工具结果返回给 LLM
            await LLM.continue_with_results(
                conversation: conversation,
                tool_results: tool_results
            )
        }
    }
}
```

### 7.3 多 Agent 协作

```axon
// 多 Agent 协作处理复杂任务
agent Orchestrator {
    requires NetworkIO, SpawnAgent

    state {
        researchers: List<AgentRef<ResearchAgent>> = []
        writer:      Option<AgentRef<WriterAgent>>  = None
    }

    on Start -> Unit | Async {
        // 启动专业化的子 Agent
        researchers = List.range(0, 3)
            |> List.map(|_| spawn ResearchAgent)
        writer = Some(spawn WriterAgent)
    }

    on WriteReport(topic: String) -> Result<String, Error> | Async {
        // 并发让多个 researcher 研究不同方面
        let subtopics = splitIntoSubtopics(topic)
        let research_tasks = subtopics
            |> List.zip(researchers)
            |> List.map(|(subtopic, agent)| agent.ask(Research(subtopic)))

        // 等待所有研究完成
        let research_results = await Async.all(research_tasks)?

        // 让 writer 综合成报告
        let w = writer?  // 如果 writer 是 None，返回 Err
        await w.ask(Synthesize(research_results))
    }
}
```
