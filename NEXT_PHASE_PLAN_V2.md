# Axon 下一阶段计划 V2 — AI Agent 聚焦版

> **核心原则**：只实现对 AI Agent 理解、编程和 LLM+代码组合有实质帮助的特性。
> 不追求与 Rust/Python/TS 的特性对等，而是走 AI-native 差异化路线。

---

## 保留并完善（Kept）

| ID | 特性 | 理由 |
|----|------|------|
| K1 | Effect system 执行（已实现基础版） | AI agent 生成代码时，声明式效果是安全沙箱的基础 |
| K2 | Async agent 消息队列（真并发） | Agent 间并发协作是多 agent 系统的核心 |
| K3 | Supervision trees（已实现基础版） | 生产级 agent 必须能自动重启、容错 |
| K4 | Capability system（requires 关键字） | LLM 生成 agent 时可声明能力，运行时沙箱验证 |
| K5 | tool_call() dispatch + agent_tool_loop() | LLM → 工具调用 → 结果反馈 是 agentic 循环核心 |
| K6 | Structured LLM output (llm_structured) | 让 LLM 输出结构化数据，而非 parse 自由文本 |
| K7 | Algebraic effect handlers runtime | 测试时可 mock IO/Network，提升 agent 可测试性 |
| K8 | Multi-agent orchestration primitives | ask_all / ask_any / pipeline 编排多 agent |

## 新增（New）

| ID | 特性 | 理由 |
|----|------|------|
| N1 | --strict-effects 模式 | opt-in 严格检查，强制 LLM 代码声明所有效果 |
| N2 | spawn 时 capability grants | `spawn Agent with [NetworkHTTP]` 运行时授权 |
| N3 | Agent 执行超时 + 资源限制 | 防止 LLM 生成的 agent 无限循环 |
| N4 | 确定性 trace/replay（--trace） | 调试 agent 行为，复现 LLM 决策路径 |

## 明确拒绝（Rejected）

- Trait system / Type classes — 与 AI agent 价值无关
- Bytecode 编译器 / VM — 性能不是当前瓶颈
- LSP / IDE 插件 — 工具链，不是语言核心
- 代码格式化工具 — 辅助工具，延后
- 包管理器 — 可用 npm 生态代替
- 泛型系统 — 延后，先用 Any 替代

---

## 最终路线图（Top 10，按 AI Agent 价值排序）

### 1. Effect enforcement + --strict-effects ✅ 已实现基础版
- [x] `effectsExplicit` 字段，未声明函数不检查
- [x] 声明了 `| IO` 但调用 `read_file`（需 FileIO）报错
- [ ] `--strict-effects` CLI flag：所有函数强制声明
- [ ] Effect 子类型：`FileIO <: IO`（FileIO 自动满足 IO 要求）

### 2. Capability system enforcement
- [ ] 解析 `agent Foo requires [NetworkHTTP, FileRead]`
- [ ] `spawn Foo with [NetworkHTTP]` 运行时 capability grant
- [ ] Capability → Effect set 映射表
- [ ] 违反时 runtime CapabilityError

### 3. Async agent 消息队列（真并发）
- [x] AgentRef 已有 async drainQueue
- [ ] `ask_all([a, b, c], Msg)` — 并发发送，等待所有结果
- [ ] `ask_any([a, b, c], Msg)` — 等待最快响应
- [ ] agent 间 channel 原语

### 4. tool_call() dispatch + agent_tool_loop() ★ 最高实用价值
- [ ] `tool_call(name: String, args: Map<String, Any>) -> Result<Any, String>`
- [ ] `agent_tool_loop(prompt: String, tools: List<String>) -> String` — 标准 ReAct 循环
- [ ] Tool 执行结果自动格式化回 LLM

### 5. Supervision trees wiring ✅ 已实现基础版
- [x] OneForOne 重启策略
- [x] maxRestarts + restartWindow
- [ ] 测试：实际崩溃触发重启验证
- [ ] AllForOne / RestForOne 策略

### 6. Agent 执行超时 + 资源限制
- [ ] `spawn Agent timeout(5000)` — 毫秒超时
- [ ] 超时后自动停止，返回 Err("timeout")
- [ ] 消息队列深度限制

### 7. Structured LLM output
- [ ] `llm_structured(prompt: String, schema: Map) -> Result<Any, String>`
- [ ] 内置 JSON Schema 验证
- [ ] 重试逻辑（最多 3 次）

### 8. Algebraic effect handlers runtime
- [ ] `handle Effect { op: handler } in { body }` 语法解析
- [ ] 测试时 mock IO effect
- [ ] mock_io() / mock_network() 内置 handler

### 9. Multi-agent orchestration primitives
- [ ] `ask_all(agents, msg)` — 并发询问
- [ ] `pipeline([a, b, c], input)` — 顺序链式
- [ ] `race([a, b], msg)` — 最快返回

### 10. Deterministic trace/replay
- [ ] `--trace` CLI flag 输出每条消息到 stderr
- [ ] trace 文件格式（JSONL）
- [ ] `axon replay trace.jsonl` 重放

---

## 当前实现状态（截至 V2 计划）
- 22/22 测试通过
- Tests 01-15: 核心语言特性
- Tests 16-19: Named args / JSON / Format / IO
- Tests 20-22: Tool annotation / Effects / Supervisor

## 下一步执行优先级
1. **K5**: `tool_call()` + `agent_tool_loop()` — 最直接的 AI agent 价值
2. **N1**: `--strict-effects` flag — 小改动，大价值
3. **K6**: `llm_structured()` — 结构化输出
4. **K2**: `ask_all` / `ask_any` — 多 agent 协作
