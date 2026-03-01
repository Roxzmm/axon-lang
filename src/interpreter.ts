// ============================================================
// Axon Language — Tree-Walking Interpreter
// ============================================================

import type {
  Program, TopLevel, FnDecl, TypeDecl, AgentDecl, ConstDecl,
  Expr, Stmt, Pattern, LitExpr, MatchArm, CallArg, Param,
  TypeVariant, TypeVariantField, StateField, AgentHandler,
} from './ast';
import { Environment, ModuleRegistry } from './runtime/env';
import {
  AxonValue, ValueTag, AgentRef, AgentHandlerFn,
  mkInt, mkFloat, mkString, mkBool, mkList, mkTuple, mkRecord, mkEnum,
  mkNative, mkOk, mkErr, mkSome, mkNone,
  UNIT, TRUE, FALSE, displayValue, debugValue, valuesEqual,
  ReturnSignal, BreakSignal, ContinueSignal, TrySignal, RuntimeError,
  mkNativeAsync,
} from './runtime/value';
import { registerStdlib } from './runtime/stdlib';
import { spawnAgent, hotUpdateAgent, AgentSpawnConfig } from './runtime/agent';
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

export class Interpreter {
  public  globalEnv: Environment;
  private typeRegistry = new Map<string, TypeInfo>();
  private agentDeclRegistry = new Map<string, AgentDecl>();
  private moduleRegistry = new ModuleRegistry();

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
      const sorted = [...list.items];
      if (fn && fn.tag !== ValueTag.Unit) {
        // Pre-compute comparison results (can't async inside sort comparator)
        const pairs: [AxonValue, AxonValue, number][] = [];
        sorted.sort((a, b) => {
          if (a.tag === ValueTag.Int    && b.tag === ValueTag.Int)    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
          if (a.tag === ValueTag.Float  && b.tag === ValueTag.Float)  return a.value - b.value;
          if (a.tag === ValueTag.String && b.tag === ValueTag.String) return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
          return 0;
        });
      } else {
        sorted.sort((a, b) => {
          if (a.tag === ValueTag.Int    && b.tag === ValueTag.Int)    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
          if (a.tag === ValueTag.Float  && b.tag === ValueTag.Float)  return a.value - b.value;
          if (a.tag === ValueTag.String && b.tag === ValueTag.String) return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
          return 0;
        });
      }
      return mkList(sorted);
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

    // Async timing
    this.globalEnv.define('sleep', mkNativeAsync('sleep', async (ms) => {
      const millis = ms?.tag === ValueTag.Int ? Number(ms.value)
                   : ms?.tag === ValueTag.Float ? ms.value : 0;
      await new Promise(resolve => setTimeout(resolve, millis));
      return UNIT;
    }));
  }

  // ── Execute Program ───────────────────────────────────────

  async execute(program: Program): Promise<void> {
    // First pass: register types and functions
    for (const item of program.items) {
      this.registerTopLevel(item);
    }

    // Second pass: evaluate initializers and find main
    let mainFn: AxonValue | undefined;
    for (const item of program.items) {
      if (item.kind === 'ConstDecl') {
        const val = await this.evalExpr(item.value, this.globalEnv);
        this.globalEnv.define(item.name, val);
      }
      if (item.kind === 'FnDecl' && item.name === 'main') {
        mainFn = this.globalEnv.tryGet('main');
      }
    }

    // Run main if present
    if (mainFn) {
      await this.callValueAsync(mainFn, []);
    }
  }

  // Hot-reload: re-register updated items
  async hotReload(program: Program): Promise<{ modules: number; fns: number; agents: number }> {
    let fns = 0, agents = 0;

    for (const item of program.items) {
      if (item.kind === 'FnDecl') {
        this.registerFn(item);
        fns++;
      } else if (item.kind === 'AgentDecl') {
        this.registerAgent(item);
        // Update running agents
        const newHandlers = this.buildAgentHandlers(item);
        const updated = hotUpdateAgent(item.name, newHandlers);
        agents += updated;
      } else if (item.kind === 'TypeDecl') {
        this.registerType(item);
      }
    }

    return { modules: 1, fns, agents };
  }

  // ── REPL evaluation ──────────────────────────────────────
  // Returns the result value (Unit if nothing to show), or throws.
  async replExec(input: string): Promise<AxonValue> {
    const trimmed = input.trim();
    if (!trimmed) return UNIT;

    // ── Declaration: fn / type / agent / const ─────────────
    if (/^(fn|type|agent|const)\s/.test(trimmed)) {
      const program = parse(`module REPL\n${trimmed}`);
      for (const item of program.items) this.registerTopLevel(item);
      // Evaluate const initializers
      for (const item of program.items) {
        if (item.kind === 'ConstDecl') {
          const val = await this.evalExpr(item.value, this.globalEnv);
          this.globalEnv.define(item.name, val, true);
        }
      }
      return UNIT;
    }

    // ── Let binding: persist to global env ─────────────────
    const letMatch = trimmed.match(/^let\s+(?:mut\s+)?(\w+)(?:\s*:\s*[^\s=][^=]*)?\s*=\s*([\s\S]+)$/);
    if (letMatch) {
      const [, name, exprSrc] = letMatch;
      // Wrap to evaluate the RHS expression
      const program = parse(`module REPL\nfn __repl__() {\n${trimmed}\n${name}\n}`);
      this.registerTopLevel(program.items[0]);
      const fn = this.globalEnv.tryGet('__repl__');
      if (fn) {
        const result = await this.callValueAsync(fn, []);
        this.globalEnv.define(name, result, true);
        return result;
      }
      return UNIT;
    }

    // ── Bare expression or statement ───────────────────────
    // Wrap in a function, call it, return the value
    const program = parse(`module REPL\nfn __repl__() {\n${trimmed}\n}`);
    this.registerTopLevel(program.items[0]);
    const fn = this.globalEnv.tryGet('__repl__');
    if (fn) return this.callValueAsync(fn, []);
    return UNIT;
  }

  private registerTopLevel(item: TopLevel): void {
    if (item.kind === 'FnDecl')    this.registerFn(item);
    if (item.kind === 'TypeDecl')  this.registerType(item);
    if (item.kind === 'AgentDecl') this.registerAgent(item);
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
    switch (expr.kind) {
      case 'IntLit':    return mkInt(expr.value);
      case 'FloatLit':  return mkFloat(expr.value);
      case 'BoolLit':   return mkBool(expr.value);
      case 'StringLit': return this.evalStringLit(expr.value, env);
      case 'CharLit':   return { tag: ValueTag.Char, value: expr.value };
      case 'UnitLit':   return UNIT;

      case 'Ident':     return this.evalIdent(expr.name, env);

      case 'Block':     return this.evalBlock(expr, env);
      case 'If':        return this.evalIf(expr, env);
      case 'Match':     return this.evalMatch(expr, env);

      case 'Binary':    return this.evalBinary(expr.op, await this.evalExpr(expr.left, env), await this.evalExpr(expr.right, env));
      case 'Unary':     return this.evalUnary(expr.op, await this.evalExpr(expr.expr, env));

      case 'Call': {
        const callee = await this.evalExpr(expr.callee, env);
        const args   = await this.evalArgs(expr.args, env);
        return this.callValueAsync(callee, args);
      }

      case 'MethodCall': {
        const obj    = await this.evalExpr(expr.obj, env);
        const args   = await this.evalArgs(expr.args, env);
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
        const left  = await this.evalExpr(expr.left, env);
        const right = await this.evalExpr(expr.right, env);
        // right should be a function — call it with left as first arg
        return this.callValueAsync(right, [left]);
      }

      case 'Lambda': {
        return {
          tag: ValueTag.Function,
          name: '<lambda>',
          params: expr.params,
          body: expr.body,
          closure: env.snapshot(),
        };
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

        // Build handlers
        const handlers = new Map<string, AgentHandlerFn>();
        for (let i = 0; i < decl.handlers.length; i++) {
          const idx = i;
          handlers.set(decl.handlers[i].msgType, async (agentState, args) => {
            return this.evalAgentHandler(decl, idx, agentState, args);
          });
        }

        const ref = new AgentRef(decl.name, state, handlers);
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

      default:
        throw new RuntimeError(`Unknown expression kind: ${(expr as any).kind}`);
    }
  }

  private evalIdent(name: string, env: Environment): AxonValue {
    // Try local scope first
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
          const { parse } = await import('./parser');
          const ast    = parse(innerExpr);
          const expr   = (ast.items[0] as any)?.expr ?? ast.items[0];
          // Simple eval for interpolation
          const val    = await this.evalExprFromSource(innerExpr, env);
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
    // Parse a single expression from source string (for interpolation)
    const { parse } = await import('./parser');
    const prog = parse(src);
    if (prog.items.length === 0) return UNIT;
    // Wrap in a block or try as expression statement
    const item = prog.items[0];
    if (item && 'expr' in item) return this.evalExpr((item as any).expr, env);
    // Try to parse as pure expression
    const { Parser } = await import('./parser');
    const p = new Parser(src);
    const ast = p.parse();
    if (ast.items.length > 0 && ast.items[0].kind === 'FnDecl') {
      // It's actually an expression at top level — evaluate directly
    }
    return mkString(src);
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

      case 'LoopStmt': {
        while (true) {
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

      // Try to assign in enclosing scope first
      try {
        env.assign(name, newVal);
      } catch {
        // If not found locally, define as mutable in agent context
        env.define(name, newVal, true);
      }
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
      return fn.fn(...args);
    }
    if (fn.tag === ValueTag.AsyncNativeFn) {
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

  private async evalArgs(callArgs: CallArg[], env: Environment): Promise<AxonValue[]> {
    return Promise.all(callArgs.map(a => this.evalExpr(a.value, env)));
  }

  // ── Method Calls ─────────────────────────────────────────

  private async evalMethodCall(obj: AxonValue, method: string, args: AxonValue[], env: Environment): Promise<AxonValue> {
    // send / ask on agents
    if (obj.tag === ValueTag.Agent) {
      if (method === 'send') {
        const [msgType, msgArgs] = extractMsg(args[0]);
        obj.ref.send(msgType, msgArgs);
        return UNIT;
      }
      if (method === 'ask') {
        const [msgType, msgArgs] = extractMsg(args[0]);
        return obj.ref.ask(msgType, msgArgs);
      }
      if (method === 'stop') {
        const { stopAgent } = await import('./runtime/agent');
        stopAgent(obj.ref.id);
        return UNIT;
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

    // Generic methods
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

function formatValue(v: AxonValue, fmt: string): string {
  if (!fmt) return displayValue(v);

  // Numeric formatting
  if (v.tag === ValueTag.Float || v.tag === ValueTag.Int) {
    const n = v.tag === ValueTag.Float ? v.value : Number(v.value);
    const m = fmt.match(/^\.(\d+)f?$/);
    if (m) return n.toFixed(parseInt(m[1]));
    const pct = fmt.match(/^\.(\d*)%$/);
    if (pct) return (n * 100).toFixed(parseInt(pct[1] || '0')) + '%';
  }

  return displayValue(v);
}
