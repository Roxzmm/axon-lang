// ============================================================
// Axon Language — Tree-Walking Interpreter
// ============================================================

import type {
  Program, TopLevel, FnDecl, TypeDecl, AgentDecl, ConstDecl, ImplDecl,
  Expr, Stmt, Pattern, LitExpr, MatchArm, CallArg, Param,
  TypeVariant, TypeVariantField, StateField, AgentHandler,
} from './ast';
import { Environment, ModuleRegistry } from './runtime/env';
import {
  AxonValue, ValueTag, AgentRef, AgentHandlerFn, ChannelRef,
  mkInt, mkFloat, mkString, mkBool, mkList, mkTuple, mkRecord, mkEnum,
  mkNative, mkOk, mkErr, mkSome, mkNone, mkChannel,
  UNIT, TRUE, FALSE, displayValue, debugValue, valuesEqual,
  ReturnSignal, BreakSignal, ContinueSignal, TrySignal, RuntimeError,
  mkNativeAsync,
} from './runtime/value';
import { registerStdlib, toolRegistry as stdlibToolRegistry, httpRequest, jsToAxon, axonToJs } from './runtime/stdlib';
import { spawnAgent, hotUpdateAgent, listAgents, AgentSpawnConfig } from './runtime/agent';
import { parse } from './parser';

// ─── Helper: extract message type + args from a message value ─

function extractMsg(msg: AxonValue | undefined): [string, AxonValue[]] {
  if (!msg) return ['', []];
  // Parameterless message: registered as a String value
  if (msg.tag === ValueTag.String) return [msg.value, []];
  // Parameterized message: registered as __msg__ Enum with variant = msgType
  if (msg.tag === ValueTag.Enum && msg.typeName === '__msg__') return [msg.variant, msg.fields];
  // Fallback: use display string
  return [displayValue(msg), []];
}

// ─── Type registry (for ADT construction and matching) ───────

interface TypeInfo {
  variants: Map<string, TypeVariant>;
}

// ─── REPL result type ────────────────────────────────────

export type ReplResult =
  | { kind: 'value';  value: AxonValue }
  | { kind: 'let';    name: string; mutable: boolean; value: AxonValue }
  | { kind: 'fn';     name: string }
  | { kind: 'type';   name: string }
  | { kind: 'agent';  name: string }
  | { kind: 'const';  name: string; value: AxonValue }
  | { kind: 'none' };

// ─── Tool Registry helpers (for #[tool] annotated functions) ─

function axonTypeToJsonSchema(ty: import('./ast').TypeExpr | null): any {
  if (!ty) return {};
  switch (ty.kind) {
    case 'NameType':
      switch (ty.name) {
        case 'Int':    return { type: 'integer' };
        case 'Float':  return { type: 'number' };
        case 'String': return { type: 'string' };
        case 'Bool':   return { type: 'boolean' };
        case 'Unit':   return { type: 'null' };
        case 'List':   return { type: 'array', items: axonTypeToJsonSchema(ty.params[0] ?? null) };
        default:       return { type: 'object' };
      }
    case 'UnitType': return { type: 'null' };
    default:         return {};
  }
}

export class Interpreter {
  public  globalEnv: Environment;
  private typeRegistry = new Map<string, TypeInfo>();
  private agentDeclRegistry = new Map<string, AgentDecl>();
  // impl blocks: typeName → methodName → fn value
  private methodRegistry = new Map<string, Map<string, AxonValue>>();
  // Effect handler stack: each entry is a map from fn-name → handler value.
  // Handlers are checked (top-to-bottom) before env/stdlib lookup in evalIdent.
  private handlerStack: Map<string, AxonValue>[] = [];
  private moduleRegistry = new ModuleRegistry();
  private builtinNames = new Set<string>();
  // Capability stack: when inside an agent handler with granted caps, restrict operations
  // null entry = unconstrained (spawned without `with [...]`)
  private capabilityStack: Array<Set<string> | null> = [];
  // Trace support: when set, emit JSONL trace events for effectful operations
  private tracer: ((event: Record<string, unknown>) => void) | null = null;
  // Functions that are interesting enough to trace (effectful/impure)
  private static readonly TRACE_FNS = new Set([
    'read_file', 'write_file', 'file_exists', 'append_file',
    'http_get', 'http_post', 'http_get_json', 'http_delete',
    'llm_call', 'llm_structured', 'agent_tool_loop', 'tool_call',
    'env_get', 'env_set', 'env_all', 'args',
    'sleep_ms', 'sleep', 'now_ms', 'now_s', 'timestamp',
    'print', 'println', 'eprint', 'eprintln',
    'random', 'random_int', 'random_bool',
    'json_parse', 'json_stringify', 'json_stringify_pretty',
    'ask_all', 'ask_any', 'tool_list', 'tool_schema',
  ]);

  // Capability → required capability name mapping (function name → cap name)
  private static readonly CAPABILITY_MAP: Record<string, string> = {
    'http_get':          'NetworkHTTP',
    'http_post':         'NetworkHTTP',
    'http_get_json':     'NetworkHTTP',
    'http_delete':       'NetworkHTTP',
    'read_file':         'FileRead',
    'file_exists':       'FileRead',
    'write_file':        'FileWrite',
    'append_file':       'FileWrite',
    'llm_call':          'LLMAccess',
    'llm_structured':    'LLMAccess',
    'agent_tool_loop':   'LLMAccess',
    'env_get':           'EnvRead',
    'env_all':           'EnvRead',
    'args':              'EnvRead',
    'env_set':           'EnvWrite',
  };

  private checkCapability(fnName: string): void {
    if (this.capabilityStack.length === 0) return;  // not in agent handler context
    const topCaps = this.capabilityStack[this.capabilityStack.length - 1];
    if (topCaps === null) return;  // unconstrained agent (spawned without `with`)
    const required = Interpreter.CAPABILITY_MAP[fnName];
    if (required && !topCaps.has(required)) {
      throw new RuntimeError(
        `CapabilityError: '${fnName}' requires capability '${required}', ` +
        `but this agent was only granted: [${[...topCaps].join(', ')}]`
      );
    }
  }

  enableTrace(traceFile?: string): void {
    if (traceFile) {
      const fs = require('fs') as typeof import('fs');
      const stream = fs.createWriteStream(traceFile, { flags: 'a' });
      this.tracer = (event) => stream.write(JSON.stringify(event) + '\n');
    } else {
      this.tracer = (event) => process.stderr.write(JSON.stringify(event) + '\n');
    }
  }

  private emitTrace(event: Record<string, unknown>): void {
    if (this.tracer) this.tracer({ ts: Date.now(), ...event });
  }
  // Module system: maps resolved module path → exported env
  private loadedModules = new Map<string, Environment>();
  private currentFile: string | null = null;
  // Tracks how many statements of each #[Application] fn have been executed (for incremental reload)
  private applicationExecCounts = new Map<string, number>();

  constructor() {
    this.globalEnv = new Environment();
    this.registerBuiltins();
  }

  // ── Setup ─────────────────────────────────────────────────

  private registerBuiltins(): void {
    registerStdlib(this.globalEnv, (name, val) => this.globalEnv.define(name, val));

    // Higher-order list functions (async-aware, support user-defined lambdas)
    const call = (fn: AxonValue, args: AxonValue[]) => this.callValueAsync(fn, args);

    this.globalEnv.define('list_map', mkNativeAsync('list_map', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_map: expected list');
      const results: AxonValue[] = [];
      for (const item of list.items) results.push(await call(fn, [item]));
      return mkList(results);
    }));
    this.globalEnv.define('list_filter', mkNativeAsync('list_filter', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_filter: expected list');
      const results: AxonValue[] = [];
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Bool ? r.value : true) results.push(item);
      }
      return mkList(results);
    }));
    this.globalEnv.define('list_fold', mkNativeAsync('list_fold', async (list, init, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_fold: expected list');
      let acc = init;
      for (const item of list.items) acc = await call(fn, [acc, item]);
      return acc;
    }));
    this.globalEnv.define('list_reduce', mkNativeAsync('list_reduce', async (list, fn) => {
      if (list.tag !== ValueTag.List || list.items.length === 0) throw new RuntimeError('list_reduce: empty list');
      let acc = list.items[0];
      for (const item of list.items.slice(1)) acc = await call(fn, [acc, item]);
      return acc;
    }));
    this.globalEnv.define('list_any', mkNativeAsync('list_any', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_any: expected list');
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Bool && r.value) return mkBool(true);
      }
      return mkBool(false);
    }));
    this.globalEnv.define('list_all', mkNativeAsync('list_all', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_all: expected list');
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Bool && !r.value) return mkBool(false);
      }
      return mkBool(true);
    }));
    this.globalEnv.define('list_find', mkNativeAsync('list_find', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_find: expected list');
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Bool && r.value) return mkSome(item);
      }
      return mkNone();
    }));
    this.globalEnv.define('list_sort', mkNativeAsync('list_sort', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_sort: expected list');
      const items = [...list.items];

      function defaultCmp(a: AxonValue, b: AxonValue): number {
        if (a.tag === ValueTag.Int    && b.tag === ValueTag.Int)    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
        if (a.tag === ValueTag.Float  && b.tag === ValueTag.Float)  return a.value - b.value;
        if (a.tag === ValueTag.String && b.tag === ValueTag.String) return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
        return 0;
      }

      if (fn && fn.tag !== ValueTag.Unit) {
        // Async-safe insertion sort — calls user comparator via await
        for (let i = 1; i < items.length; i++) {
          const key = items[i];
          let j = i - 1;
          while (j >= 0) {
            const cmpVal = await call(fn, [items[j], key]);
            const cmp = cmpVal.tag === ValueTag.Int   ? Number(cmpVal.value)
                      : cmpVal.tag === ValueTag.Float ? cmpVal.value
                      : defaultCmp(items[j], key);
            if (cmp <= 0) break;
            items[j + 1] = items[j];
            j--;
          }
          items[j + 1] = key;
        }
      } else {
        items.sort(defaultCmp);
      }
      return mkList(items);
    }));
    this.globalEnv.define('list_flat_map', mkNativeAsync('list_flat_map', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_flat_map: expected list');
      const result: AxonValue[] = [];
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.List) result.push(...r.items);
        else result.push(r);
      }
      return mkList(result);
    }));
    this.globalEnv.define('list_count', mkNativeAsync('list_count', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_count: expected list');
      let count = 0n;
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Bool && r.value) count++;
      }
      return mkInt(count);
    }));
    this.globalEnv.define('list_partition', mkNativeAsync('list_partition', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_partition: expected list');
      const yes: AxonValue[] = [], no: AxonValue[] = [];
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Bool && r.value) yes.push(item); else no.push(item);
      }
      return mkTuple([mkList(yes), mkList(no)]);
    }));
    this.globalEnv.define('list_group_by', mkNativeAsync('list_group_by', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_group_by: expected list');
      const groups = new Map<string, AxonValue[]>();
      const keyVals = new Map<string, AxonValue>();
      for (const item of list.items) {
        const key = await call(fn, [item]);
        const k = displayValue(key);
        if (!groups.has(k)) { groups.set(k, []); keyVals.set(k, key); }
        groups.get(k)!.push(item);
      }
      const fields = new Map<string, AxonValue>();
      for (const [k, items] of groups) fields.set(k, mkList(items));
      return { tag: ValueTag.Record, typeName: 'Map', fields } as AxonValue;
    }));
    this.globalEnv.define('list_sum_by', mkNativeAsync('list_sum_by', async (list, fn) => {
      if (list.tag !== ValueTag.List) throw new RuntimeError('list_sum_by: expected list');
      let sumI = 0n, sumF = 0, isFloat = false;
      for (const item of list.items) {
        const r = await call(fn, [item]);
        if (r.tag === ValueTag.Float) { isFloat = true; sumF += r.value; }
        else if (r.tag === ValueTag.Int) { sumI += r.value; sumF += Number(r.value); }
      }
      return isFloat ? mkFloat(sumF) : mkInt(sumI);
    }));
    this.globalEnv.define('result_map', mkNativeAsync('result_map', async (result, fn) => {
      if (result.tag === ValueTag.Enum && result.variant === 'Ok')
        return mkOk(await call(fn, [result.fields[0]]));
      return result;
    }));
    this.globalEnv.define('result_map_err', mkNativeAsync('result_map_err', async (result, fn) => {
      if (result.tag === ValueTag.Enum && result.variant === 'Err')
        return mkErr(await call(fn, [result.fields[0]]));
      return result;
    }));
    this.globalEnv.define('result_and_then', mkNativeAsync('result_and_then', async (result, fn) => {
      if (result.tag === ValueTag.Enum && result.variant === 'Ok')
        return call(fn, [result.fields[0]]);
      return result;
    }));
    this.globalEnv.define('option_map', mkNativeAsync('option_map', async (opt, fn) => {
      if (opt.tag === ValueTag.Enum && opt.variant === 'Some')
        return mkSome(await call(fn, [opt.fields[0]]));
      return opt;
    }));
    this.globalEnv.define('option_and_then', mkNativeAsync('option_and_then', async (opt, fn) => {
      if (opt.tag === ValueTag.Enum && opt.variant === 'Some')
        return call(fn, [opt.fields[0]]);
      return opt;
    }));
    this.globalEnv.define('map_update', mkNativeAsync('map_update', async (m, k, fn) => {
      if (m.tag !== ValueTag.Record) throw new RuntimeError('map_update: expected map');
      const key = displayValue(k);
      const existing = m.fields.get(key) ?? UNIT;
      const newVal = await call(fn, [existing]);
      const newFields = new Map(m.fields);
      newFields.set(key, newVal);
      return { tag: ValueTag.Record, typeName: 'Map', fields: newFields } as AxonValue;
    }));
    this.globalEnv.define('map_filter', mkNativeAsync('map_filter', async (m, fn) => {
      if (m.tag !== ValueTag.Record) throw new RuntimeError('map_filter: expected map');
      const newFields = new Map<string, AxonValue>();
      for (const [k, v] of m.fields) {
        const keep = await call(fn, [mkString(k), v]);
        if (keep.tag === ValueTag.Bool && keep.value) newFields.set(k, v);
      }
      return { tag: ValueTag.Record, typeName: 'Map', fields: newFields } as AxonValue;
    }));

    // Async timing
    this.globalEnv.define('sleep', mkNativeAsync('sleep', async (ms) => {
      const millis = ms?.tag === ValueTag.Int ? Number(ms.value)
                   : ms?.tag === ValueTag.Float ? ms.value : 0;
      await new Promise(resolve => setTimeout(resolve, millis));
      return UNIT;
    }));

    // ── tool_call: dispatch a registered #[tool] function by name + args map ──
    this.globalEnv.define('tool_call', mkNativeAsync('tool_call', async (nameVal, argsVal) => {
      if (nameVal.tag !== ValueTag.String) throw new RuntimeError('tool_call: first arg must be String');
      const name = nameVal.value;
      const tool = stdlibToolRegistry.get(name);
      if (!tool?.fn) return mkErr(mkString(`tool_call: unknown tool '${name}'`));

      // Build positional arg list from the named-args map
      const fnValue = tool.fn;
      const callArgs: AxonValue[] = [];
      if (fnValue.tag === ValueTag.Function && argsVal.tag === ValueTag.Record) {
        for (const param of fnValue.params) {
          const v = argsVal.fields.get(param.name);
          callArgs.push(v ?? UNIT);
        }
      } else if (argsVal.tag === ValueTag.List) {
        callArgs.push(...argsVal.items);
      }

      try {
        const result = await call(tool.fn, callArgs);
        return mkOk(result);
      } catch (e) {
        return mkErr(mkString(String(e)));
      }
    }));

    // ── agent_tool_loop: standard ReAct agentic loop (LLM ↔ tools) ──────────
    this.globalEnv.define('agent_tool_loop', mkNativeAsync('agent_tool_loop', async (promptVal, toolNamesVal, maxTurnsVal) => {
      const prompt   = promptVal.tag === ValueTag.String ? promptVal.value : displayValue(promptVal);
      const model    = 'claude-haiku-4-5-20251001';
      const maxTurns = maxTurnsVal?.tag === ValueTag.Int ? Number(maxTurnsVal.value) : 10;
      const apiKey   = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return mkErr(mkString('agent_tool_loop: ANTHROPIC_API_KEY not set'));

      // Collect tool names and build Anthropic tool definitions
      const toolNames: string[] = [];
      if (toolNamesVal?.tag === ValueTag.List) {
        for (const t of toolNamesVal.items) {
          if (t.tag === ValueTag.String) toolNames.push(t.value);
        }
      }
      const toolDefs = toolNames
        .map(n => stdlibToolRegistry.get(n))
        .filter(Boolean)
        .map(t => ({ name: t!.name, description: t!.description, input_schema: t!.parameters }));

      const messages: any[] = [{ role: 'user', content: prompt }];

      for (let turn = 0; turn < maxTurns; turn++) {
        try {
          const reqBody = JSON.stringify({ model, max_tokens: 1024, tools: toolDefs, messages });
          const raw = await httpRequest('https://api.anthropic.com/v1/messages', 'POST', reqBody, 'application/json');
          const resp: any = JSON.parse(raw);
          if (resp.error) return mkErr(mkString(resp.error.message ?? String(resp.error)));

          // Append assistant turn
          messages.push({ role: 'assistant', content: resp.content });

          const toolUses = (resp.content ?? []).filter((b: any) => b.type === 'tool_use');
          const textBlocks = (resp.content ?? []).filter((b: any) => b.type === 'text');

          if (toolUses.length === 0 || resp.stop_reason === 'end_turn') {
            return mkOk(mkString(textBlocks.map((b: any) => b.text).join('')));
          }

          // Execute each tool call and collect results
          const toolResults: any[] = [];
          for (const block of toolUses) {
            let resultStr: string;
            const tool = stdlibToolRegistry.get(block.name);
            if (!tool?.fn) {
              resultStr = `Error: unknown tool '${block.name}'`;
            } else {
              try {
                const fnValue = tool.fn;
                const callArgs: AxonValue[] = [];
                if (fnValue.tag === ValueTag.Function) {
                  for (const param of fnValue.params) {
                    const v = block.input[param.name];
                    callArgs.push(v !== undefined ? jsToAxon(v) : UNIT);
                  }
                }
                const result = await call(fnValue, callArgs);
                resultStr = displayValue(result);
              } catch (e) {
                resultStr = `Error: ${e}`;
              }
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultStr });
          }
          messages.push({ role: 'user', content: toolResults });
        } catch (e) {
          return mkErr(mkString(String(e)));
        }
      }
      return mkErr(mkString('agent_tool_loop: max turns exceeded'));
    }));

    // ── ask_all: send same message to all agents concurrently, return all results ──
    this.globalEnv.define('ask_all', mkNativeAsync('ask_all', async (agentListVal, msgVal) => {
      if (agentListVal.tag !== ValueTag.List) throw new RuntimeError('ask_all: first arg must be List<Agent>');
      const [msgType, msgArgs] = extractMsg(msgVal);
      const results = await Promise.all(
        agentListVal.items.map(agentVal => {
          if (agentVal.tag !== ValueTag.Agent) throw new RuntimeError('ask_all: expected Agent in list');
          return agentVal.ref.ask(msgType, msgArgs);
        })
      );
      return mkList(results);
    }));

    // ── ask_any: send to all agents, return first response ───────────────────
    this.globalEnv.define('ask_any', mkNativeAsync('ask_any', async (agentListVal, msgVal) => {
      if (agentListVal.tag !== ValueTag.List) throw new RuntimeError('ask_any: first arg must be List<Agent>');
      const [msgType, msgArgs] = extractMsg(msgVal);
      return await Promise.race(
        agentListVal.items.map(agentVal => {
          if (agentVal.tag !== ValueTag.Agent) throw new RuntimeError('ask_any: expected Agent in list');
          return agentVal.ref.ask(msgType, msgArgs);
        })
      );
    }));

    // ── Channel primitives ────────────────────────────────────────────────────
    this.globalEnv.define('channel', mkNative('channel', (capVal?) => {
      const cap = capVal && capVal.tag === ValueTag.Int ? Number(capVal.value) : 0;
      return mkChannel(cap);
    }));

    this.globalEnv.define('chan_send', mkNativeAsync('chan_send', async (chVal, val) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_send: expected Channel');
      await chVal.ref.send(val);
      return UNIT;
    }));

    this.globalEnv.define('chan_recv', mkNativeAsync('chan_recv', async (chVal) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_recv: expected Channel');
      return chVal.ref.recv();
    }));

    this.globalEnv.define('chan_try_recv', mkNative('chan_try_recv', (chVal) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_try_recv: expected Channel');
      return chVal.ref.tryRecv();
    }));

    this.globalEnv.define('chan_try_send', mkNative('chan_try_send', (chVal, val) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_try_send: expected Channel');
      return mkBool(chVal.ref.trySend(val));
    }));

    this.globalEnv.define('chan_close', mkNative('chan_close', (chVal) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_close: expected Channel');
      chVal.ref.close();
      return UNIT;
    }));

    this.globalEnv.define('chan_is_closed', mkNative('chan_is_closed', (chVal) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_is_closed: expected Channel');
      return mkBool(chVal.ref.isClosed());
    }));

    this.globalEnv.define('chan_size', mkNative('chan_size', (chVal) => {
      if (chVal.tag !== ValueTag.Channel) throw new RuntimeError('chan_size: expected Channel');
      return mkInt(chVal.ref.size());
    }));

    // ── pipeline: pass output of each agent as input to next ──────────────
    this.globalEnv.define('pipeline', mkNativeAsync('pipeline', async (agentsVal, inputVal) => {
      if (agentsVal.tag !== ValueTag.List) throw new RuntimeError('pipeline: first arg must be List<Agent>');
      let current = inputVal;
      for (const agentVal of agentsVal.items) {
        if (agentVal.tag !== ValueTag.Agent) throw new RuntimeError('pipeline: list must contain Agents');
        current = await agentVal.ref.ask('Process', [current]);
      }
      return current;
    }));

    // ── interpreter_hot_reload: test helper — reload program from source string ──
    this.globalEnv.define('interpreter_hot_reload', mkNativeAsync('interpreter_hot_reload', async (src) => {
      if (src.tag !== ValueTag.String) throw new RuntimeError('interpreter_hot_reload: expected String');
      const prog = parse(src.value);
      await this.hotReload(prog);
      return UNIT;
    }));

    // Snapshot builtin names so :env can filter them out
    for (const { name } of this.globalEnv.entries()) {
      this.builtinNames.add(name);
    }
  }

  // Return user-defined bindings (excludes builtins and REPL internals)
  getReplUserBindings(): Array<{ name: string; value: AxonValue; mutable: boolean }> {
    return this.globalEnv.entries().filter(
      e => !this.builtinNames.has(e.name) && e.name !== '__repl__',
    );
  }

  // ── Execute Program ───────────────────────────────────────

  async execute(program: Program, filePath?: string, runEntryPoint = true): Promise<void> {
    const prevFile = this.currentFile;
    if (filePath) this.currentFile = filePath;

    // First pass: handle use declarations, register types and functions
    for (const item of program.items) {
      if (item.kind === 'UseDecl') {
        await this.handleUseDecl(item);
      } else {
        this.registerTopLevel(item);
      }
    }

    // Second pass: evaluate initializers and find entry point
    // Priority: #[Application] annotation > function named 'main'
    let mainFn: AxonValue | undefined;
    let applicationFn: AxonValue | undefined;
    let entryDecl: FnDecl | undefined;
    for (const item of program.items) {
      if (item.kind === 'ConstDecl') {
        const val = await this.evalExpr(item.value, this.globalEnv);
        this.globalEnv.define(item.name, val);
      }
      if (item.kind === 'FnDecl') {
        if (item.annots.some(a => a === 'Application' || a.startsWith('Application('))) {
          applicationFn = this.globalEnv.tryGet(item.name);
          entryDecl = item;
        }
        if (item.name === 'main') {
          mainFn = this.globalEnv.tryGet('main');
          if (!entryDecl) entryDecl = item;
        }
      }
    }

    this.currentFile = prevFile;

    // Run entry point: #[Application] takes priority over main()
    if (runEntryPoint) {
      const entryFn = applicationFn ?? mainFn;
      if (entryFn) {
        await this.callValueAsync(entryFn, []);
        // Record stmt count for incremental reload of #[Application] fn
        if (entryDecl?.body?.kind === 'Block') {
          this.applicationExecCounts.set(entryDecl.name, entryDecl.body.stmts.length);
        }
      }
    }
  }

  private async handleUseDecl(decl: import('./ast').UseDecl): Promise<void> {
    // Convert PascalCase segments to snake_case for file resolution
    // e.g. Lib.MathUtils → lib/math_utils.axon
    const toSnake = (s: string) => s.replace(/([A-Z])/g, (m, g, i) => (i > 0 ? '_' : '') + g.toLowerCase());
    const modPath = decl.path.map(toSnake).join('/') + '.axon';
    let filePath: string | null = null;

    if (this.currentFile) {
      const dir = require('path').dirname(this.currentFile);
      const candidate = require('path').join(dir, modPath);
      if (require('fs').existsSync(candidate)) {
        filePath = candidate;
      }
    }

    // Also try relative to process.cwd()
    if (!filePath) {
      const candidate = require('path').resolve(modPath);
      if (require('fs').existsSync(candidate)) {
        filePath = candidate;
      }
    }

    if (!filePath) {
      // Module not found — try to find by module name in registry
      // (silently skip if not found; module may be built-in or optional)
      return;
    }

    const resolved = require('path').resolve(filePath);
    const cacheKey = resolved;

    // Load module if not cached
    if (!this.loadedModules.has(cacheKey)) {
      const source = require('fs').readFileSync(resolved, 'utf-8');
      const modProgram = parse(source, resolved);

      // Execute module in a separate env to capture its exports
      const modEnv = new Environment(this.globalEnv);
      const modInterpreter = new Interpreter();
      // Share registries
      modInterpreter.typeRegistry = this.typeRegistry;
      modInterpreter.agentDeclRegistry = this.agentDeclRegistry;
      await modInterpreter.execute(modProgram, resolved, false); // don't run entry point in modules

      // Collect exported (pub) definitions
      const exports = new Environment();
      for (const item of modProgram.items) {
        if (item.kind === 'FnDecl' && item.name !== 'main') {
          const val = modInterpreter.globalEnv.tryGet(item.name);
          if (val !== undefined) exports.define(item.name, val);
        } else if (item.kind === 'TypeDecl') {
          // Export type constructors
          for (const { name } of modInterpreter.globalEnv.entries()) {
            if (!modInterpreter['builtinNames'].has(name) && name !== 'main') {
              const val = modInterpreter.globalEnv.tryGet(name);
              if (val !== undefined) exports.define(name, val);
            }
          }
        } else if (item.kind === 'ConstDecl') {
          const val = modInterpreter.globalEnv.tryGet(item.name);
          if (val !== undefined) exports.define(item.name, val);
        }
      }
      this.loadedModules.set(cacheKey, exports);
    }

    const exports = this.loadedModules.get(cacheKey)!;

    // Import names into current global env
    if (decl.items) {
      // Selective import: use Foo { a, b, c }
      for (const name of decl.items) {
        const val = exports.tryGet(name);
        if (val !== undefined) {
          this.globalEnv.define(name, val);
        }
      }
    } else if (decl.alias) {
      // Module alias: use Foo as F  — import all under the alias namespace (simplified: import all)
      for (const { name, value } of exports.entries()) {
        this.globalEnv.define(`${decl.alias}.${name}`, value);
      }
    } else {
      // Wildcard: import all exports into current scope
      for (const { name, value } of exports.entries()) {
        this.globalEnv.define(name, value);
      }
    }
  }

  // Hot-reload: re-register updated items, patch live agents, run new #[Application] stmts
  async hotReload(program: Program): Promise<{ modules: number; fns: number; agents: number }> {
    let fns = 0, agents = 0;

    for (const item of program.items) {
      if (item.kind === 'FnDecl') {
        this.registerFn(item);
        fns++;
        // Incremental execution for #[Application] entry points:
        // Execute only statements added since the last run
        if (item.annots.some(a => a === 'Application' || a.startsWith('Application('))) {
          const prevCount = this.applicationExecCounts.get(item.name) ?? 0;
          if (item.body?.kind === 'Block' && item.body.stmts.length > prevCount) {
            const newStmts = item.body.stmts.slice(prevCount);
            const newBody: Expr = {
              kind: 'Block', stmts: newStmts, tail: null, span: item.body.span,
            };
            const syntheticFn: AxonValue = {
              tag: ValueTag.Function,
              name: `${item.name}$reload`,
              params: [],
              body: newBody,
              closure: this.globalEnv,
              isRecursive: false,
            };
            await this.callValueAsync(syntheticFn, []);
            this.applicationExecCounts.set(item.name, item.body.stmts.length);
          }
        }
      } else if (item.kind === 'AgentDecl') {
        this.registerAgent(item);
        // Patch handler maps on all live instances of this agent type
        const newHandlers = this.buildAgentHandlers(item);
        const updated = hotUpdateAgent(item.name, newHandlers);
        agents += updated;
        // Auto-init any new state fields on live instances
        for (const ref of listAgents()) {
          if (ref.name === item.name) {
            for (const sf of item.stateFields) {
              if (!ref.state.has(sf.name)) {
                ref.state.set(sf.name, await this.evalExpr(sf.default_, this.globalEnv));
              }
            }
          }
        }
      } else if (item.kind === 'TypeDecl') {
        this.registerType(item);
      } else if (item.kind === 'ConstDecl') {
        const val = await this.evalExpr(item.value, this.globalEnv);
        this.globalEnv.define(item.name, val, true);
      } else if (item.kind === 'ImplDecl') {
        this.registerImpl(item);
      }
    }

    return { modules: 1, fns, agents };
  }

  // ── REPL evaluation ──────────────────────────────────────
  // Returns a structured ReplResult describing what was evaluated.
  async replExec(input: string): Promise<ReplResult> {
    const trimmed = input.trim();
    if (!trimmed) return { kind: 'none' };

    // ── Declaration: fn / type / agent / const ─────────────
    if (/^(fn|type|agent|const)\s/.test(trimmed)) {
      const program = parse(`module REPL\n${trimmed}`);
      for (const item of program.items) this.registerTopLevel(item);

      // Return info about the first declared item
      for (const item of program.items) {
        if (item.kind === 'ConstDecl') {
          const val = await this.evalExpr(item.value, this.globalEnv);
          this.globalEnv.define(item.name, val, true);
          return { kind: 'const', name: item.name, value: val };
        }
        if (item.kind === 'FnDecl')    return { kind: 'fn',    name: item.name };
        if (item.kind === 'TypeDecl')  return { kind: 'type',  name: item.name };
        if (item.kind === 'AgentDecl') return { kind: 'agent', name: item.name };
      }
      return { kind: 'none' };
    }

    // ── Let binding: persist to global env ─────────────────
    const letMatch = trimmed.match(/^let\s+(mut\s+)?(\w+)(?:\s*:\s*[^\s=][^=]*)?\s*=\s*([\s\S]+)$/);
    if (letMatch) {
      const [, mutKw, name] = letMatch;
      const mutable = !!mutKw;
      const program = parse(`module REPL\nfn __repl__() {\n${trimmed}\n${name}\n}`);
      this.registerTopLevel(program.items[0]);
      const fn = this.globalEnv.tryGet('__repl__');
      if (fn) {
        const value = await this.callValueAsync(fn, []);
        this.globalEnv.define(name, value, mutable);
        return { kind: 'let', name, mutable, value };
      }
      return { kind: 'none' };
    }

    // ── Bare expression or statement ───────────────────────
    const program = parse(`module REPL\nfn __repl__() {\n${trimmed}\n}`);
    this.registerTopLevel(program.items[0]);
    const fn = this.globalEnv.tryGet('__repl__');
    if (fn) {
      const value = await this.callValueAsync(fn, []);
      return { kind: 'value', value };
    }
    return { kind: 'none' };
  }

  private registerTopLevel(item: TopLevel): void {
    if (item.kind === 'FnDecl')    this.registerFn(item);
    if (item.kind === 'TypeDecl')  this.registerType(item);
    if (item.kind === 'AgentDecl') this.registerAgent(item);
    if (item.kind === 'ImplDecl')  this.registerImpl(item);
  }

  private registerImpl(decl: ImplDecl): void {
    if (!this.methodRegistry.has(decl.typeName)) {
      this.methodRegistry.set(decl.typeName, new Map());
    }
    const methods = this.methodRegistry.get(decl.typeName)!;
    for (const method of decl.methods) {
      if (method.body === null) continue;
      const fnVal: AxonValue = {
        tag: ValueTag.Function,
        name: `${decl.typeName}::${method.name}`,
        params: method.params,
        body: method.body,
        closure: this.globalEnv,
        isRecursive: true,
      };
      methods.set(method.name, fnVal);
    }
  }

  private registerFn(decl: FnDecl): void {
    if (decl.body === null) return;
    const fnVal: AxonValue = {
      tag: ValueTag.Function,
      name: decl.name,
      params: decl.params,
      body: decl.body,
      closure: this.globalEnv,
      isRecursive: true,
    };
    this.globalEnv.define(decl.name, fnVal, true);

    // Handle #[tool] annotation — register in global tool registry
    if (decl.annots.some(a => a === 'tool' || a.startsWith('tool('))) {
      // Extract description from #[tool("description")] or use fn name
      const toolAnnot = decl.annots.find(a => a === 'tool' || a.startsWith('tool('));
      let description = decl.name.replace(/_/g, ' ');
      if (toolAnnot && toolAnnot.startsWith('tool(')) {
        const m = toolAnnot.match(/^tool\("(.*)"\)$/);
        if (m) description = m[1];
      }

      // Build JSON Schema from param types
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const param of decl.params) {
        properties[param.name] = axonTypeToJsonSchema(param.ty);
        if (!param.default_) required.push(param.name);
      }
      const schema: Record<string, any> = { type: 'object', properties };
      if (required.length > 0) schema.required = required;

      stdlibToolRegistry.set(decl.name, {
        name:        decl.name,
        description,
        parameters:  schema,
        fn:          fnVal,
      });
    }
  }

  private registerType(decl: TypeDecl): void {
    if (decl.def.kind === 'Enum') {
      const info: TypeInfo = { variants: new Map() };
      for (const variant of decl.def.variants) {
        info.variants.set(variant.name, variant);
        // Register constructor function
        this.registerVariantConstructor(decl.name, variant);
      }
      this.typeRegistry.set(decl.name, info);
    } else if (decl.def.kind === 'Refine') {
      // Refinement type: `type Foo = Int where self > 0`
      // Register `Foo` as a namespace Record with `new` and `refine` callable fields.
      const pred  = decl.def.pred;
      const tName = decl.name;
      const refineConstructor = mkNativeAsync(`${tName}.new`, async (value) => {
        const predEnv = new Environment(this.globalEnv);
        predEnv.define('self', value);
        const ok = await this.evalExpr(pred, predEnv);
        if (ok.tag === ValueTag.Bool && !ok.value) {
          return mkErr(mkString(`${tName}: predicate failed for ${displayValue(value)}`));
        }
        return mkOk(value);
      });
      // Expose as a namespace record: PositiveInt.new(v) / PositiveInt.refine(v)
      const nsRecord: AxonValue = {
        tag: ValueTag.Record,
        typeName: `__typeNS_${tName}`,
        fields: new Map([['new', refineConstructor], ['refine', refineConstructor]]),
      };
      this.globalEnv.define(tName, nsRecord, true);
    }
  }

  private registerVariantConstructor(typeName: string, variant: TypeVariant): void {
    const fields = variant.fields[0];
    if (!fields || (fields.kind === 'Tuple' && fields.types.length === 0)) {
      // Unit variant — register as a value
      this.globalEnv.define(variant.name, mkEnum(typeName, variant.name), true);
    } else if (fields.kind === 'Tuple') {
      // Tuple variant — register as a constructor function
      const arity = fields.types.length;
      const constructorFn = mkNative(variant.name, (...args) =>
        mkEnum(typeName, variant.name, args.slice(0, arity))
      );
      this.globalEnv.define(variant.name, constructorFn, true);
    } else {
      // Record variant — register as a constructor function that takes a record
      this.globalEnv.define(variant.name, mkNative(variant.name, (record) => {
        if (record.tag !== ValueTag.Record) throw new RuntimeError(`${variant.name}: expected record`);
        return { tag: ValueTag.Enum as const, typeName, variant: variant.name, fields: [], recordFields: record.fields };
      }), true);
    }
  }

  private registerAgentMessages(decl: AgentDecl): void {
    for (const handler of decl.handlers) {
      const msgType = handler.msgType;
      if (handler.params.length === 0) {
        // Parameterless message — a string value
        this.globalEnv.define(msgType, mkString(msgType), true);
      } else {
        // Parameterized message — a constructor function returning an Enum
        this.globalEnv.define(msgType, mkNative(msgType, (...args) =>
          mkEnum('__msg__', msgType, args)
        ), true);
      }
    }
  }

  private registerAgent(decl: AgentDecl): void {
    this.agentDeclRegistry.set(decl.name, decl);
    this.registerAgentMessages(decl);
  }

  private buildAgentHandlers(decl: AgentDecl): Map<string, AgentHandlerFn> {
    const handlers = new Map<string, AgentHandlerFn>();
    for (let i = 0; i < decl.handlers.length; i++) {
      const handlerIdx = i;
      handlers.set(decl.handlers[i].msgType, async (state, args) => {
        return this.evalAgentHandler(decl, handlerIdx, state, args);
      });
    }
    return handlers;
  }

  // ── Expression Evaluation ────────────────────────────────

  async evalExpr(expr: Expr, env: Environment): Promise<AxonValue> {
    try {
      return await this.evalExprInner(expr, env);
    } catch (e) {
      // Attach span to RuntimeErrors that don't already have one
      if (e instanceof RuntimeError && !e.span && expr.span) {
        e.span = expr.span;
      }
      throw e;
    }
  }

  private async evalExprInner(expr: Expr, env: Environment): Promise<AxonValue> {
    switch (expr.kind) {
      case 'IntLit':    return mkInt(expr.value);
      case 'FloatLit':  return mkFloat(expr.value);
      case 'BoolLit':   return mkBool(expr.value);
      case 'StringLit': return expr.interpolated
        ? this.evalStringLit(expr.value, env)
        : mkString(expr.value);
      case 'CharLit':   return { tag: ValueTag.Char, value: expr.value };
      case 'UnitLit':   return UNIT;

      case 'Ident':     return this.evalIdent(expr.name, env);

      case 'Block':     return this.evalBlock(expr, env);
      case 'If':        return this.evalIf(expr, env);
      case 'Match':     return this.evalMatch(expr, env);

      case 'Binary': {
        // Short-circuit logical operators — do NOT evaluate right side eagerly
        if (expr.op === '&&') {
          const l = await this.evalExpr(expr.left, env);
          if (l.tag === ValueTag.Bool && !l.value) return mkBool(false);
          return await this.evalExpr(expr.right, env);
        }
        if (expr.op === '||') {
          const l = await this.evalExpr(expr.left, env);
          if (l.tag === ValueTag.Bool && l.value) return mkBool(true);
          return await this.evalExpr(expr.right, env);
        }
        return this.evalBinary(expr.op, await this.evalExpr(expr.left, env), await this.evalExpr(expr.right, env));
      }
      case 'Unary':     return this.evalUnary(expr.op, await this.evalExpr(expr.expr, env));

      case 'Call': {
        const callee    = await this.evalExpr(expr.callee, env);
        const namedArgs = await this.evalArgs(expr.args, env);
        const args      = this.resolveNamedArgs(callee, namedArgs);
        return this.callValueAsync(callee, args);
      }

      case 'MethodCall': {
        const obj       = await this.evalExpr(expr.obj, env);
        const namedArgs = await this.evalArgs(expr.args, env);
        const args      = namedArgs.map(a => a.value);
        return this.evalMethodCall(obj, expr.method, args, env);
      }

      case 'FieldAccess': {
        const obj = await this.evalExpr(expr.obj, env);
        return this.evalFieldAccess(obj, expr.field);
      }

      case 'Index': {
        const obj   = await this.evalExpr(expr.obj, env);
        const index = await this.evalExpr(expr.index, env);
        return this.evalIndex(obj, index);
      }

      case 'Pipe': {
        const left = await this.evalExpr(expr.left, env);
        // x |> f(args) → f(x, args)  (Elixir/F# style partial application)
        if (expr.right.kind === 'Call') {
          const callee    = await this.evalExpr(expr.right.callee, env);
          const namedExtra = await this.evalArgs(expr.right.args, env);
          const extraArgs  = namedExtra.map(a => a.value);
          return this.callValueAsync(callee, [left, ...extraArgs]);
        }
        // x |> f  → f(x)
        const right = await this.evalExpr(expr.right, env);
        return this.callValueAsync(right, [left]);
      }

      case 'Lambda': {
        // Capture env by reference so mutations in enclosing scope are visible
        const lambdaFn = {
          tag: ValueTag.Function as const,
          name: '<lambda>',
          params: expr.params,
          body: expr.body,
          closure: env,
          isRecursive: false,
        };
        return lambdaFn;
      }

      case 'List': {
        const items = await Promise.all(expr.elems.map(e => this.evalExpr(e, env)));
        if (expr.spread) {
          const rest = await this.evalExpr(expr.spread, env);
          if (rest.tag !== ValueTag.List) throw new RuntimeError('Spread: expected list');
          return mkList([...items, ...rest.items]);
        }
        return mkList(items);
      }

      case 'Tuple': {
        const items = await Promise.all(expr.elems.map(e => this.evalExpr(e, env)));
        return mkTuple(items);
      }

      case 'Record': {
        const fields = new Map<string, AxonValue>();
        for (const f of expr.fields) {
          fields.set(f.name, await this.evalExpr(f.value, env));
        }
        // If typeName is a known enum variant, produce an Enum value
        if (expr.typeName) {
          for (const [parentTypeName, info] of this.typeRegistry) {
            if (info.variants.has(expr.typeName)) {
              return { tag: ValueTag.Enum, typeName: parentTypeName, variant: expr.typeName, fields: [], recordFields: fields };
            }
          }
        }
        return { tag: ValueTag.Record, typeName: expr.typeName ?? '', fields };
      }

      case 'RecordUpdate': {
        const base = await this.evalExpr(expr.base, env);
        if (base.tag !== ValueTag.Record) throw new RuntimeError('Record update: expected record');
        const newFields = new Map(base.fields);
        for (const f of expr.fields) {
          newFields.set(f.name, await this.evalExpr(f.value, env));
        }
        return { tag: ValueTag.Record, typeName: base.typeName, fields: newFields };
      }

      case 'EnumVariant': {
        const fieldVals = await Promise.all(
          (expr.fields as Expr[]).map(f => this.evalExpr(f, env))
        );
        return mkEnum(expr.typeName, expr.variant, fieldVals);
      }

      case 'Try': {
        const val = await this.evalExpr(expr.expr, env);
        if (val.tag === ValueTag.Enum) {
          if (val.variant === 'Err')  throw new TrySignal(val);
          if (val.variant === 'None') throw new TrySignal(val);
          if (val.variant === 'Ok')  return val.fields[0];
          if (val.variant === 'Some') return val.fields[0];
        }
        return val;
      }

      case 'Force': {
        const val = await this.evalExpr(expr.expr, env);
        if (val.tag === ValueTag.Enum) {
          if (val.variant === 'Some') return val.fields[0];
          if (val.variant === 'Ok')   return val.fields[0];
          if (val.variant === 'None') throw new RuntimeError('Force (!): called on None');
          if (val.variant === 'Err')  throw new RuntimeError(`Force (!): called on Err(${displayValue(val.fields[0])})`);
        }
        return val;
      }

      case 'Await': return this.evalExpr(expr.expr, env); // Already async

      case 'Spawn': {
        const decl = this.agentDeclRegistry.get(expr.agentName);
        if (!decl) throw new RuntimeError(`spawn: unknown agent '${expr.agentName}'`);

        // Initialize state
        const state = new Map<string, AxonValue>();
        for (const sf of decl.stateFields) {
          state.set(sf.name, await this.evalExpr(sf.default_, this.globalEnv));
        }

        // Resolve granted capabilities (null = unconstrained)
        const grantedCaps: Set<string> | null = expr.caps ? new Set(expr.caps) : null;

        // Validate: if agent requires caps and a `with` list is given, all required caps must be granted
        if (grantedCaps && decl.requires.length > 0) {
          const missing = decl.requires.filter(r => !grantedCaps.has(r));
          if (missing.length > 0) {
            throw new RuntimeError(
              `CapabilityError: agent '${decl.name}' requires [${decl.requires.join(', ')}] ` +
              `but spawn only granted [${[...grantedCaps].join(', ')}]. Missing: [${missing.join(', ')}]`
            );
          }
        }

        // Build handlers — wrap each to push/pop capability context
        const handlers = new Map<string, AgentHandlerFn>();
        for (let i = 0; i < decl.handlers.length; i++) {
          const idx = i;
          handlers.set(decl.handlers[i].msgType, async (agentState, args) => {
            this.capabilityStack.push(grantedCaps);
            try {
              return await this.evalAgentHandler(decl, idx, agentState, args);
            } finally {
              this.capabilityStack.pop();
            }
          });
        }

        // Evaluate optional timeout expression
        let timeoutMs: number | null = null;
        if (expr.timeout) {
          const tv = await this.evalExpr(expr.timeout, env);
          if (tv.tag === ValueTag.Int) timeoutMs = Number(tv.value);
          else if (tv.tag === ValueTag.Float) timeoutMs = tv.value;
        }
        const ref = new AgentRef(decl.name, state, handlers, timeoutMs, grantedCaps);
        const { registerAgent } = await import('./runtime/agent');
        registerAgent(ref);

        return { tag: ValueTag.Agent, ref };
      }

      case 'Return': {
        const val = expr.value ? await this.evalExpr(expr.value, env) : UNIT;
        throw new ReturnSignal(val);
      }

      case 'Break': {
        const val = expr.value ? await this.evalExpr(expr.value, env) : UNIT;
        throw new BreakSignal(val);
      }

      case 'Continue': throw new ContinueSignal();

      case 'TypeAscription': return this.evalExpr(expr.expr, env);

      case 'IfLet': {
        const val = await this.evalExpr(expr.value, env);
        const bindings = new Map<string, AxonValue>();
        if (this.matchPattern(expr.pat, val, bindings)) {
          const letEnv = env.child();
          for (const [k, v] of bindings) letEnv.define(k, v);
          return this.evalExpr(expr.then, letEnv);
        } else if (expr.else_) {
          return this.evalExpr(expr.else_, env);
        }
        return UNIT;
      }

      case 'Loop': {
        while (true) {
          try {
            await this.evalExpr(expr.body, env);
          } catch (e) {
            if (e instanceof BreakSignal)    return e.value ?? UNIT;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
      }

      case 'Range': {
        const lo = await this.evalExpr(expr.lo, env);
        const hi = await this.evalExpr(expr.hi, env);
        if (lo.tag !== ValueTag.Int || hi.tag !== ValueTag.Int) {
          throw new RuntimeError('Range bounds must be Int');
        }
        const end = expr.inclusive ? hi.value + 1n : hi.value;
        const items: AxonValue[] = [];
        for (let i = lo.value; i < end; i++) items.push(mkInt(i));
        return mkList(items);
      }

      case 'HandleExpr': {
        // Build handler map and push onto the handler stack.
        // evalIdent checks the stack before env/stdlib lookup, so all calls to
        // handler-named functions — including transitive calls — are intercepted.
        const handlerNames = expr.handlers.map(h => h.name);
        this.emitTrace({ event: 'handle_enter', effect: expr.effect, handlers: handlerNames });
        const handlers = new Map<string, AxonValue>();
        for (const h of expr.handlers) {
          const handlerVal = await this.evalExpr(h.handler, env);
          // Wrap handler to emit trace events when invoked
          if (this.tracer) {
            const handlerName = h.name;
            const orig = handlerVal;
            const effect = expr.effect;
            handlers.set(handlerName, mkNativeAsync(`handler:${handlerName}`, async (...args: AxonValue[]) => {
              this.emitTrace({ event: 'effect_handler', effect, fn: handlerName, args: args.map(displayValue) });
              return this.callValueAsync(orig, args);
            }));
          } else {
            handlers.set(h.name, handlerVal);
          }
        }
        this.handlerStack.push(handlers);
        try {
          return await this.evalExpr(expr.body, env);
        } finally {
          this.handlerStack.pop();
          this.emitTrace({ event: 'handle_exit', effect: expr.effect });
        }
      }

      default:
        throw new RuntimeError(`Unknown expression kind: ${(expr as any).kind}`);
    }
  }

  private evalIdent(name: string, env: Environment): AxonValue {
    // Check effect handler stack first (innermost handler wins) — dynamic dispatch
    for (let i = this.handlerStack.length - 1; i >= 0; i--) {
      const h = this.handlerStack[i].get(name);
      if (h !== undefined) return h;
    }
    // Try local scope
    const local = env.tryGet(name);
    if (local !== undefined) return local;
    // Try global
    const global = this.globalEnv.tryGet(name);
    if (global !== undefined) return global;
    throw new RuntimeError(`Undefined: '${name}'`);
  }

  private async evalStringLit(template: string, env: Environment): Promise<AxonValue> {
    // Interpolation: replace {expr} with evaluated values
    let result = '';
    let i = 0;
    while (i < template.length) {
      if (template[i] === '{') {
        // Find matching closing brace
        let depth = 1;
        let j = i + 1;
        while (j < template.length && depth > 0) {
          if (template[j] === '{') depth++;
          if (template[j] === '}') depth--;
          if (depth > 0) j++;
          else break;
        }
        const exprStr = template.slice(i + 1, j);

        // Check for format specifier :.2f etc.
        const fmtMatch = exprStr.match(/^(.*?)(:.*)?$/);
        const innerExpr = fmtMatch ? fmtMatch[1].trim() : exprStr;
        const fmtSpec   = fmtMatch ? fmtMatch[2] : '';

        try {
          const val = await this.evalExprFromSource(innerExpr, env);
          result += formatValue(val, fmtSpec?.slice(1) ?? '');
        } catch {
          result += `{${exprStr}}`;
        }

        i = j + 1;
      } else {
        result += template[i];
        i++;
      }
    }
    return mkString(result);
  }

  private async evalExprFromSource(src: string, env: Environment): Promise<AxonValue> {
    // Parse a bare expression by wrapping it in a synthetic function
    const { parse } = await import('./parser');
    const wrapper = `module __Interp__\nfn __interp__() {\n${src}\n}`;
    const prog = parse(wrapper);
    if (prog.items.length === 0) throw new RuntimeError(`interpolation: cannot parse: ${src}`);
    const fn = prog.items[0];
    if (fn.kind !== 'FnDecl') throw new RuntimeError(`interpolation: expected fn`);
    // Register and call in current env
    const fnVal: AxonValue = {
      tag: ValueTag.Function,
      name: '__interp__',
      params: fn.params,
      body: fn.body!,
      closure: env,
      isRecursive: false,
    };
    return this.callValueAsync(fnVal, []);
  }

  private async evalBlock(expr: { stmts: (import('./ast').Stmt)[]; tail: Expr | null }, env: Environment): Promise<AxonValue> {
    const blockEnv = env.child();

    for (const stmt of expr.stmts) {
      await this.evalStmt(stmt, blockEnv);
    }

    if (expr.tail) {
      return this.evalExpr(expr.tail, blockEnv);
    }
    return UNIT;
  }

  private async evalIf(expr: { cond: Expr; then: Expr; else_: Expr | null }, env: Environment): Promise<AxonValue> {
    const cond = await this.evalExpr(expr.cond, env);
    const b    = cond.tag === ValueTag.Bool ? cond.value
               : cond.tag === ValueTag.Enum && cond.variant === 'None' ? false
               : true;
    if (b) return this.evalExpr(expr.then, env);
    if (expr.else_) return this.evalExpr(expr.else_, env);
    return UNIT;
  }

  private async evalMatch(expr: { scrutinee: Expr; arms: MatchArm[] }, env: Environment): Promise<AxonValue> {
    const scrutinee = await this.evalExpr(expr.scrutinee, env);

    for (const arm of expr.arms) {
      const bindings = new Map<string, AxonValue>();
      if (this.matchPattern(arm.pattern, scrutinee, bindings)) {
        // Check guard
        if (arm.guard) {
          const armEnv = env.child();
          for (const [k, v] of bindings) armEnv.define(k, v);
          const guardVal = await this.evalExpr(arm.guard, armEnv);
          if (guardVal.tag === ValueTag.Bool && !guardVal.value) continue;
        }

        const armEnv = env.child();
        for (const [k, v] of bindings) armEnv.define(k, v);
        return this.evalExpr(arm.body, armEnv);
      }
    }

    throw new RuntimeError(`Non-exhaustive match on: ${displayValue(scrutinee)}`);
  }

  // ── Pattern Matching ─────────────────────────────────────

  matchPattern(pat: Pattern, val: AxonValue, bindings: Map<string, AxonValue>): boolean {
    switch (pat.kind) {
      case 'WildPat': return true;

      case 'IdentPat': {
        if (pat.name === '_') return true;
        // Check if it's an enum unit variant
        const variantVal = this.globalEnv.tryGet(pat.name);
        if (variantVal?.tag === ValueTag.Enum &&
            variantVal.fields.length === 0 &&
            val.tag === ValueTag.Enum &&
            val.variant === pat.name) return true;
        // Otherwise it's a binding
        bindings.set(pat.name, val);
        return true;
      }

      case 'LitPat': return valuesEqual(val, this.evalLit(pat.value));

      case 'TuplePat': {
        if (val.tag !== ValueTag.Tuple) return false;
        if (val.items.length !== pat.elems.length) return false;
        return pat.elems.every((p, i) => this.matchPattern(p, val.items[i], bindings));
      }

      case 'ListPat': {
        if (val.tag !== ValueTag.List) return false;
        if (val.items.length < pat.head.length) return false;
        if (!pat.tail && val.items.length !== pat.head.length) return false;
        const ok = pat.head.every((p, i) => this.matchPattern(p, val.items[i], bindings));
        if (!ok) return false;
        if (pat.tail && pat.tail !== '_rest') {
          bindings.set(pat.tail, mkList(val.items.slice(pat.head.length)));
        }
        return true;
      }

      case 'EnumPat': {
        if (val.tag !== ValueTag.Enum) return false;
        if (val.variant !== pat.variant) return false;

        // Tuple fields
        if (pat.fields.length > 0) {
          if (val.fields.length < pat.fields.length) return false;
          return pat.fields.every((p, i) => this.matchPattern(p, val.fields[i], bindings));
        }

        // Record fields
        if (pat.recordFields.length > 0) {
          for (const { name, pat: p } of pat.recordFields) {
            const fieldVal = val.recordFields.get(name);
            if (fieldVal === undefined) return false;
            if (!this.matchPattern(p, fieldVal, bindings)) return false;
          }
          return true;
        }

        return true;
      }

      case 'RecordPat': {
        if (val.tag !== ValueTag.Record) return false;
        for (const { name, pat: p } of pat.fields) {
          const fieldVal = val.fields.get(name);
          if (fieldVal === undefined) return false;
          if (!this.matchPattern(p, fieldVal, bindings)) return false;
        }
        return true;
      }

      case 'OrPat': {
        const leftBindings  = new Map<string, AxonValue>();
        const rightBindings = new Map<string, AxonValue>();
        if (this.matchPattern(pat.left, val, leftBindings)) {
          for (const [k, v] of leftBindings) bindings.set(k, v);
          return true;
        }
        if (this.matchPattern(pat.right, val, rightBindings)) {
          for (const [k, v] of rightBindings) bindings.set(k, v);
          return true;
        }
        return false;
      }

      case 'BindPat': {
        bindings.set(pat.name, val);
        return this.matchPattern(pat.inner, val, bindings);
      }

      case 'RangePat': {
        const lo = this.evalLit(pat.lo);
        const hi = this.evalLit(pat.hi);
        if (val.tag === ValueTag.Int && lo.tag === ValueTag.Int && hi.tag === ValueTag.Int) {
          return val.value >= lo.value && (pat.inclusive ? val.value <= hi.value : val.value < hi.value);
        }
        return false;
      }

      default: return false;
    }
  }

  private evalLit(lit: LitExpr): AxonValue {
    switch (lit.kind) {
      case 'IntLit':   return mkInt(lit.value);
      case 'FloatLit': return mkFloat(lit.value);
      case 'BoolLit':  return mkBool(lit.value);
      case 'StringLit':return mkString(lit.value);
      case 'CharLit':  return { tag: ValueTag.Char, value: lit.value };
      case 'UnitLit':  return UNIT;
    }
  }

  // ── Statement Evaluation ─────────────────────────────────

  private async evalStmt(stmt: import('./ast').Stmt, env: Environment): Promise<void> {
    switch (stmt.kind) {
      case 'LetStmt': {
        const val = await this.evalExpr(stmt.init, env);
        const bindings = new Map<string, AxonValue>();
        if (!this.matchPattern(stmt.pat, val, bindings)) {
          throw new RuntimeError(`Let pattern did not match value: ${displayValue(val)}`);
        }
        for (const [k, v] of bindings) env.define(k, v);
        break;
      }

      case 'LetMutStmt': {
        const val = await this.evalExpr(stmt.init, env);
        env.define(stmt.name, val, true);
        break;
      }

      case 'AssignStmt': {
        const val = await this.evalExpr(stmt.value, env);
        await this.evalAssign(stmt.target, stmt.op, val, env);
        break;
      }

      case 'ExprStmt': {
        await this.evalExpr(stmt.expr, env);
        break;
      }

      case 'ForStmt': {
        const iter = await this.evalExpr(stmt.iter, env);
        const items = iter.tag === ValueTag.List ? iter.items
                    : iter.tag === ValueTag.Enum && iter.variant === 'Some' ? [iter.fields[0]]
                    : [];

        for (const item of items) {
          const loopEnv = env.child();
          const bindings = new Map<string, AxonValue>();
          this.matchPattern(stmt.pat, item, bindings);
          for (const [k, v] of bindings) loopEnv.define(k, v);
          try {
            await this.evalExpr(stmt.body, loopEnv);
          } catch (e) {
            if (e instanceof BreakSignal)    break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        break;
      }

      case 'WhileStmt': {
        while (true) {
          const cond = await this.evalExpr(stmt.cond, env);
          if (cond.tag === ValueTag.Bool && !cond.value) break;
          try {
            await this.evalExpr(stmt.body, env);
          } catch (e) {
            if (e instanceof BreakSignal)    break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        break;
      }

      case 'WhileLetStmt': {
        while (true) {
          const val = await this.evalExpr(stmt.value, env);
          const bindings = new Map<string, AxonValue>();
          if (!this.matchPattern(stmt.pat, val, bindings)) break;
          const loopEnv = env.child();
          for (const [k, v] of bindings) loopEnv.define(k, v);
          try {
            await this.evalExpr(stmt.body, loopEnv);
          } catch (e) {
            if (e instanceof BreakSignal)    break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        break;
      }

    }
  }

  private async evalAssign(target: Expr, op: string, val: AxonValue, env: Environment): Promise<void> {
    if (target.kind === 'Ident') {
      const name = target.name;

      // Get current value for compound assignments
      let newVal = val;
      if (op !== '=') {
        const cur = env.tryGet(name) ?? this.globalEnv.tryGet(name);
        if (cur === undefined) throw new RuntimeError(`Undefined: '${name}'`);
        newVal = this.evalBinary(op.slice(0, -1), cur, val); // += → +
      }

      // Assign to the nearest enclosing mutable binding
      env.assign(name, newVal);
    } else if (target.kind === 'FieldAccess') {
      const obj = await this.evalExpr(target.obj, env);
      if (obj.tag === ValueTag.Record) {
        const newFields = new Map(obj.fields);
        newFields.set(target.field, op === '=' ? val : this.evalBinary(op.slice(0, -1), obj.fields.get(target.field) ?? UNIT, val));
        // Mutate in place (for agent state)
        obj.fields.set(target.field, op === '=' ? val : newFields.get(target.field)!);
      }
    }
  }

  // ── Binary/Unary Operations ───────────────────────────────

  private evalBinary(op: string, left: AxonValue, right: AxonValue): AxonValue {
    // String concatenation
    if (op === '+' && left.tag === ValueTag.String) {
      return mkString(left.value + displayValue(right));
    }
    // List concatenation
    if ((op === '+' || op === '++') && left.tag === ValueTag.List) {
      if (right.tag !== ValueTag.List) throw new RuntimeError('++: expected list');
      return mkList([...left.items, ...right.items]);
    }

    // Numeric
    if ((left.tag === ValueTag.Int || left.tag === ValueTag.Float) &&
        (right.tag === ValueTag.Int || right.tag === ValueTag.Float)) {

      const isFloat = left.tag === ValueTag.Float || right.tag === ValueTag.Float;

      if (!isFloat && left.tag === ValueTag.Int && right.tag === ValueTag.Int) {
        switch (op) {
          case '+':  return mkInt(left.value + right.value);
          case '-':  return mkInt(left.value - right.value);
          case '*':  return mkInt(left.value * right.value);
          case '/': {
            if (right.value === 0n) throw new RuntimeError('Division by zero');
            return mkInt(left.value / right.value);
          }
          case '%':  return mkInt(left.value % right.value);
          case '**': return mkInt(left.value ** right.value);
          case '<':  return mkBool(left.value < right.value);
          case '>':  return mkBool(left.value > right.value);
          case '<=': return mkBool(left.value <= right.value);
          case '>=': return mkBool(left.value >= right.value);
          case '==': return mkBool(left.value === right.value);
          case '!=': return mkBool(left.value !== right.value);
          case '&':  return mkInt(left.value & right.value);
          case '|':  return mkInt(left.value | right.value);
          case '^':  return mkInt(left.value ^ right.value);
          case '<<': return mkInt(left.value << right.value);
          case '>>': return mkInt(left.value >> right.value);
        }
      }

      const l = left.tag === ValueTag.Int ? Number(left.value) : left.value;
      const r = right.tag === ValueTag.Int ? Number(right.value) : right.value;
      switch (op) {
        case '+':  return mkFloat(l + r);
        case '-':  return mkFloat(l - r);
        case '*':  return mkFloat(l * r);
        case '/':  return mkFloat(l / r);
        case '%':  return mkFloat(l % r);
        case '**': return mkFloat(l ** r);
        case '<':  return mkBool(l < r);
        case '>':  return mkBool(l > r);
        case '<=': return mkBool(l <= r);
        case '>=': return mkBool(l >= r);
        case '==': return mkBool(l === r);
        case '!=': return mkBool(l !== r);
      }
    }

    // Boolean ops
    if (op === '&&') return mkBool(this.coerceBool(left) && this.coerceBool(right));
    if (op === '||') return mkBool(this.coerceBool(left) || this.coerceBool(right));
    if (op === '==') return mkBool(valuesEqual(left, right));
    if (op === '!=') return mkBool(!valuesEqual(left, right));

    throw new RuntimeError(`Unsupported operation: ${displayValue(left)} ${op} ${displayValue(right)}`);
  }

  private coerceBool(v: AxonValue): boolean {
    if (v.tag === ValueTag.Bool) return v.value;
    if (v.tag === ValueTag.Enum && v.variant === 'None') return false;
    return true;
  }

  private evalUnary(op: string, val: AxonValue): AxonValue {
    switch (op) {
      case '-': {
        if (val.tag === ValueTag.Int)   return mkInt(-val.value);
        if (val.tag === ValueTag.Float) return mkFloat(-val.value);
        break;
      }
      case '!': {
        if (val.tag === ValueTag.Bool) return mkBool(!val.value);
        break;
      }
      case '~': {
        if (val.tag === ValueTag.Int) return mkInt(~val.value);
        break;
      }
    }
    throw new RuntimeError(`Unsupported unary op: ${op} ${displayValue(val)}`);
  }

  // ── Function Calls ───────────────────────────────────────

  callValue(fn: AxonValue, args: AxonValue[]): AxonValue {
    if (fn.tag === ValueTag.NativeFn) {
      return fn.fn(...args);
    }
    // For sync context, use sync evaluation
    if (fn.tag === ValueTag.Function) {
      // This is a simplification — in a real impl we'd have sync/async paths
      throw new RuntimeError('Cannot call async function in sync context');
    }
    throw new RuntimeError(`Not callable: ${displayValue(fn)}`);
  }

  async callValueAsync(fn: AxonValue, args: AxonValue[]): Promise<AxonValue> {
    if (fn.tag === ValueTag.NativeFn) {
      this.checkCapability(fn.name);
      if (this.tracer && Interpreter.TRACE_FNS.has(fn.name)) {
        const result = fn.fn(...args);
        this.emitTrace({ event: 'call', fn: fn.name, args: args.map(displayValue), result: displayValue(result) });
        return result;
      }
      return fn.fn(...args);
    }
    if (fn.tag === ValueTag.AsyncNativeFn) {
      this.checkCapability(fn.name);
      if (this.tracer && Interpreter.TRACE_FNS.has(fn.name)) {
        const result = await fn.fn(...args);
        this.emitTrace({ event: 'call', fn: fn.name, args: args.map(displayValue), result: displayValue(result) });
        return result;
      }
      return fn.fn(...args);
    }

    if (fn.tag === ValueTag.Function) {
      const callEnv = fn.closure.child();

      // Bind parameters
      for (let i = 0; i < fn.params.length; i++) {
        const param = fn.params[i];
        const arg   = args[i];
        if (arg !== undefined) {
          callEnv.define(param.name, arg);
        } else if (param.default_) {
          callEnv.define(param.name, await this.evalExpr(param.default_, callEnv));
        } else {
          callEnv.define(param.name, UNIT);
        }
      }

      // For recursive functions, define self in scope
      if (fn.isRecursive && fn.name !== '<lambda>') {
        callEnv.define(fn.name, fn);
      }

      try {
        return await this.evalExpr(fn.body, callEnv);
      } catch (e) {
        if (e instanceof ReturnSignal) return e.value;
        if (e instanceof TrySignal)    throw e;
        throw e;
      }
    }

    throw new RuntimeError(`Not callable: ${displayValue(fn)}`);
  }

  private async evalArgs(callArgs: CallArg[], env: Environment): Promise<{name?: string, value: AxonValue}[]> {
    return Promise.all(callArgs.map(async a => ({ name: a.name, value: await this.evalExpr(a.value, env) })));
  }

  private resolveNamedArgs(fn: AxonValue, namedArgs: {name?: string, value: AxonValue}[]): AxonValue[] {
    // Fast path: no named args
    if (!namedArgs.some(a => a.name)) return namedArgs.map(a => a.value);

    // User-defined function: match args by param name
    if (fn.tag === ValueTag.Function) {
      const result: (AxonValue | undefined)[] = new Array(fn.params.length).fill(undefined);
      let posIdx = 0;
      for (const arg of namedArgs) {
        if (arg.name) {
          const i = fn.params.findIndex(p => p.name === arg.name);
          if (i >= 0) result[i] = arg.value;
        } else {
          // Advance past already-filled named slots
          while (posIdx < result.length && result[posIdx] !== undefined) posIdx++;
          if (posIdx < result.length) result[posIdx++] = arg.value;
        }
      }
      return result as AxonValue[];
    }

    // Fallback for native fns: positional only
    return namedArgs.map(a => a.value);
  }

  // ── Method Calls ─────────────────────────────────────────

  private async evalMethodCall(obj: AxonValue, method: string, args: AxonValue[], env: Environment): Promise<AxonValue> {
    // send / ask on agents
    if (obj.tag === ValueTag.Agent) {
      if (method === 'send') {
        const [msgType, msgArgs] = extractMsg(args[0]);
        this.emitTrace({ event: 'agent_send', agent: obj.ref.name, msg: msgType, args: msgArgs.map(displayValue) });
        obj.ref.send(msgType, msgArgs);
        return UNIT;
      }
      if (method === 'ask') {
        const [msgType, msgArgs] = extractMsg(args[0]);
        this.emitTrace({ event: 'agent_ask', agent: obj.ref.name, msg: msgType, args: msgArgs.map(displayValue) });
        const result = await obj.ref.ask(msgType, msgArgs);
        this.emitTrace({ event: 'agent_reply', agent: obj.ref.name, msg: msgType, result: displayValue(result) });
        return result;
      }
      if (method === 'stop') {
        const { stopAgent } = await import('./runtime/agent');
        stopAgent(obj.ref.id);
        return UNIT;
      }
    }

    // Record field as callable (enables TypeName.method() namespace pattern)
    if (obj.tag === ValueTag.Record) {
      const fieldFn = obj.fields.get(method);
      if (fieldFn && (fieldFn.tag === ValueTag.AsyncNativeFn || fieldFn.tag === ValueTag.NativeFn || fieldFn.tag === ValueTag.Function)) {
        return this.callValueAsync(fieldFn, args);
      }
    }

    // Dispatch on object type + method name
    const dispatchName = this.methodDispatchName(obj.tag, method);
    const dispatchFn   = this.globalEnv.tryGet(dispatchName);
    if (dispatchFn) {
      return this.callValueAsync(dispatchFn, [obj, ...args]);
    }

    // String methods
    if (obj.tag === ValueTag.String) {
      const strFn = this.globalEnv.tryGet(method);
      if (strFn) return this.callValueAsync(strFn, [obj, ...args]);
    }

    // impl block method lookup: user-defined methods take priority over generic defaults
    const typeName = obj.tag === ValueTag.Record ? obj.typeName
                   : obj.tag === ValueTag.Enum   ? obj.typeName
                   : null;
    if (typeName) {
      const implMethods = this.methodRegistry.get(typeName);
      if (implMethods) {
        const implFn = implMethods.get(method);
        if (implFn) return this.callValueAsync(implFn, [obj, ...args]);
      }
    }

    // Generic built-in methods (fallback defaults)
    if (method === 'len' || method === 'length') {
      if (obj.tag === ValueTag.String) return mkInt(obj.value.length);
      if (obj.tag === ValueTag.List)   return mkInt(obj.items.length);
      if (obj.tag === ValueTag.Record) return mkInt(obj.fields.size);
    }
    if (method === 'is_empty') {
      if (obj.tag === ValueTag.List)   return mkBool(obj.items.length === 0);
      if (obj.tag === ValueTag.String) return mkBool(obj.value.length === 0);
    }
    if (method === 'to_string' || method === 'show') {
      return mkString(displayValue(obj));
    }
    if (method === 'clone') return obj; // Values are immutable/copy-on-write

    // Fallback: try to find method as a free function
    const free = this.globalEnv.tryGet(method);
    if (free) return this.callValueAsync(free, [obj, ...args]);

    throw new RuntimeError(`No method '${method}' on ${obj.tag} (${displayValue(obj).slice(0, 30)})`);
  }

  private methodDispatchName(tag: ValueTag, method: string): string {
    const prefix = tag === ValueTag.List   ? 'list_'
                 : tag === ValueTag.Record ? 'map_'   // Maps are Records
                 : tag === ValueTag.Enum   ? 'option_'
                 : tag === ValueTag.String ? ''
                 : '';
    return prefix + method;
  }

  private evalFieldAccess(obj: AxonValue, field: string): AxonValue {
    if (obj.tag === ValueTag.Record) {
      const val = obj.fields.get(field);
      if (val !== undefined) return val;
      throw new RuntimeError(`Field '${field}' not found on ${obj.typeName || 'record'}`);
    }
    if (obj.tag === ValueTag.Enum) {
      const val = obj.recordFields.get(field);
      if (val !== undefined) return val;
      throw new RuntimeError(`Field '${field}' not found on ${obj.variant}`);
    }
    if (obj.tag === ValueTag.Agent) {
      if (field === 'id')   return mkString(obj.ref.id);
      if (field === 'name') return mkString(obj.ref.name);
    }
    throw new RuntimeError(`Cannot access field '${field}' on ${obj.tag}`);
  }

  private evalIndex(obj: AxonValue, index: AxonValue): AxonValue {
    if (obj.tag === ValueTag.List) {
      const i = Number((index as any).value ?? 0);
      return obj.items[i] ?? mkNone();
    }
    if (obj.tag === ValueTag.Tuple) {
      const i = Number((index as any).value ?? 0);
      return obj.items[i] ?? mkNone();
    }
    if (obj.tag === ValueTag.Record) {
      const key = displayValue(index);
      return obj.fields.get(key) ?? mkNone();
    }
    if (obj.tag === ValueTag.String) {
      const i = Number((index as any).value ?? 0);
      const ch = obj.value[i];
      return ch !== undefined ? mkSome({ tag: ValueTag.Char, value: ch }) : mkNone();
    }
    throw new RuntimeError(`Cannot index ${obj.tag}`);
  }

  // ── Agent Handler Evaluation ──────────────────────────────

  async evalAgentHandler(
    decl:       AgentDecl,
    handlerIdx: number,
    state:      Map<string, AxonValue>,
    args:       AxonValue[]
  ): Promise<AxonValue> {
    const handler = decl.handlers[handlerIdx];

    // Create handler environment with state fields as mutable variables
    const handlerEnv = this.globalEnv.child();

    // Inject state as mutable variables
    for (const [key, val] of state) {
      handlerEnv.define(key, val, true);
    }

    // Bind message parameters
    for (let i = 0; i < handler.params.length; i++) {
      const param = handler.params[i];
      handlerEnv.define(param.name, args[i] ?? UNIT);
    }

    // Execute handler body
    let result: AxonValue;
    try {
      result = await this.evalExpr(handler.body, handlerEnv);
    } catch (e) {
      if (e instanceof ReturnSignal) result = e.value;
      else throw e;
    }

    // Sync state back (the handler may have mutated state variables)
    for (const sf of decl.stateFields) {
      const updated = handlerEnv.tryGet(sf.name);
      if (updated !== undefined) {
        state.set(sf.name, updated);
      }
    }

    return result;
  }
}

// ── Format helper ─────────────────────────────────────────────
// Supports Python-style format spec: [[fill]align][sign][0][width][,][.prec][type]
// align: < > ^ =   type: b x X o e E f F % s
function formatValue(v: AxonValue, fmt: string): string {
  if (!fmt) return displayValue(v);

  // Parse: optional (fill + align), sign, zero-pad, width, comma, .prec, type
  const re = /^(?:([^<>^=]?)([<>^=]))?([+\- ]?)(0?)([\d]*)(,?)(?:\.([\d]+))?([bcdeEfFgGnoxXs%]?)$/;
  const m = re.exec(fmt);
  if (!m) return displayValue(v);

  const [, fillChar, align, sign, zeroPad, widthStr, comma, precStr, typeCh] = m;
  const width  = widthStr ? parseInt(widthStr) : 0;
  const prec   = precStr !== undefined && precStr !== '' ? parseInt(precStr) : -1;
  // fill: explicit fill char > zero-pad default > space
  const fill   = (fillChar !== undefined && fillChar !== '') ? fillChar : (zeroPad ? '0' : ' ');

  const isNumeric = v.tag === ValueTag.Int || v.tag === ValueTag.Float;
  const n = isNumeric ? (v.tag === ValueTag.Float ? v.value : Number((v as any).value)) : 0;

  let result: string;

  switch (typeCh) {
    case 'b':
      result = isNumeric ? Math.trunc(n).toString(2) : displayValue(v);
      break;
    case 'x':
      result = isNumeric ? Math.trunc(n).toString(16) : displayValue(v);
      break;
    case 'X':
      result = isNumeric ? Math.trunc(n).toString(16).toUpperCase() : displayValue(v);
      break;
    case 'o':
      result = isNumeric ? Math.trunc(n).toString(8) : displayValue(v);
      break;
    case 'e':
      result = isNumeric ? (prec >= 0 ? n.toExponential(prec) : n.toExponential()) : displayValue(v);
      break;
    case 'E':
      result = isNumeric ? (prec >= 0 ? n.toExponential(prec) : n.toExponential()).toUpperCase() : displayValue(v);
      break;
    case 'f': case 'F':
      if (isNumeric) {
        result = prec >= 0 ? n.toFixed(prec) : n.toFixed(6);
        if (typeCh === 'F') result = result.toUpperCase();
      } else result = displayValue(v);
      break;
    case '%':
      result = isNumeric
        ? (prec >= 0 ? (n * 100).toFixed(prec) : (n * 100).toFixed(0)) + '%'
        : displayValue(v);
      break;
    default: // 's', 'g', 'n', ''
      result = (isNumeric && prec >= 0) ? n.toFixed(prec) : displayValue(v);
      break;
  }

  // Sign prefix for positive numbers
  if (isNumeric && sign === '+' && n >= 0 && !result.startsWith('+')) {
    result = '+' + result;
  } else if (isNumeric && sign === ' ' && n >= 0) {
    result = ' ' + result;
  }

  // Thousand comma grouping (applied to integer part)
  if (comma && isNumeric) {
    const dotIdx = result.indexOf('.');
    const intPart  = dotIdx >= 0 ? result.slice(0, dotIdx) : result;
    const fracPart = dotIdx >= 0 ? result.slice(dotIdx) : '';
    const hasSign2 = intPart.startsWith('+') || intPart.startsWith('-') || intPart.startsWith(' ');
    const prefix  = hasSign2 ? intPart[0] : '';
    const digits  = hasSign2 ? intPart.slice(1) : intPart;
    result = prefix + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fracPart;
  }

  // Width padding
  if (width > 0 && result.length < width) {
    const padLen = width - result.length;
    const effectiveFill  = fill;
    const effectiveAlign = align || (isNumeric ? '>' : '<');
    if (effectiveAlign === '>') {
      result = effectiveFill.repeat(padLen) + result;
    } else if (effectiveAlign === '<') {
      result = result + effectiveFill.repeat(padLen);
    } else if (effectiveAlign === '^') {
      const lpad = Math.floor(padLen / 2);
      result = effectiveFill.repeat(lpad) + result + effectiveFill.repeat(padLen - lpad);
    } else if (effectiveAlign === '=') {
      // Sign-aware: sign first, then fill, then digits
      const hasSign3 = result.startsWith('+') || result.startsWith('-') || result.startsWith(' ');
      if (hasSign3) {
        result = result[0] + effectiveFill.repeat(padLen) + result.slice(1);
      } else {
        result = effectiveFill.repeat(padLen) + result;
      }
    }
  }

  return result;
}
