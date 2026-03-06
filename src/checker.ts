// ============================================================
// Axon Language — Type Checker
// ============================================================
// Simplified bidirectional type checker.
// Catches common errors without full HM inference.

import type {
  Program, TopLevel, FnDecl, TypeDecl, AgentDecl, ImplDecl,
  TypeExpr, Expr, Stmt, Pattern, Param, AgentHandler,
  MatchArm, StateField,
} from './ast';

// ─── Types ───────────────────────────────────────────────────

export type AxonType =
  | { kind: 'Int' }
  | { kind: 'Float' }
  | { kind: 'Bool' }
  | { kind: 'String' }
  | { kind: 'Char' }
  | { kind: 'Unit' }
  | { kind: 'Never' }
  | { kind: 'List';    elem: AxonType }
  | { kind: 'Tuple';   elems: AxonType[] }
  | { kind: 'Option';  inner: AxonType }
  | { kind: 'Result';  ok: AxonType; err: AxonType }
  | { kind: 'Fn';      params: AxonType[]; ret: AxonType; effects: string[] }
  | { kind: 'Agent';   msgType: string }
  | { kind: 'Named';   name: string; args: AxonType[] }
  | { kind: 'Var';     id: number }        // type variable (for inference)
  | { kind: 'Unknown' }                    // inferred, no info yet

const T_INT:    AxonType = { kind: 'Int' };
const T_FLOAT:  AxonType = { kind: 'Float' };
const T_BOOL:   AxonType = { kind: 'Bool' };
const T_STRING: AxonType = { kind: 'String' };
const T_UNIT:   AxonType = { kind: 'Unit' };
const T_UNKNOWN: AxonType = { kind: 'Unknown' };

function typeToString(t: AxonType): string {
  switch (t.kind) {
    case 'Int':     return 'Int';
    case 'Float':   return 'Float';
    case 'Bool':    return 'Bool';
    case 'String':  return 'String';
    case 'Char':    return 'Char';
    case 'Unit':    return 'Unit';
    case 'Never':   return 'Never';
    case 'List':    return `List<${typeToString(t.elem)}>`;
    case 'Tuple':   return `(${t.elems.map(typeToString).join(', ')})`;
    case 'Option':  return `Option<${typeToString(t.inner)}>`;
    case 'Result':  return `Result<${typeToString(t.ok)}, ${typeToString(t.err)}>`;
    case 'Fn':      return `(${t.params.map(typeToString).join(', ')}) -> ${typeToString(t.ret)}`;
    case 'Agent':   return `Agent<${t.msgType}>`;
    case 'Named':   return t.args.length > 0 ? `${t.name}<${t.args.map(typeToString).join(', ')}>` : t.name;
    case 'Var':     return `T${t.id}`;
    case 'Unknown': return '_';
  }
}

function typesCompatible(expected: AxonType, actual: AxonType): boolean {
  if (expected.kind === 'Unknown' || actual.kind === 'Unknown') return true;
  if (expected.kind === 'Never' || actual.kind === 'Never')     return true;
  if (expected.kind !== actual.kind) {
    // Int and Float are compatible in numeric contexts
    if ((expected.kind === 'Int'   && actual.kind === 'Float') ||
        (expected.kind === 'Float' && actual.kind === 'Int'))   return true;
    return false;
  }
  switch (expected.kind) {
    case 'List':   return typesCompatible(expected.elem, (actual as typeof expected).elem);
    case 'Option': return typesCompatible(expected.inner, (actual as typeof expected).inner);
    case 'Result': {
      const a = actual as typeof expected;
      return typesCompatible(expected.ok, a.ok) && typesCompatible(expected.err, a.err);
    }
    case 'Named':  return expected.name === (actual as typeof expected).name;
    default:       return true;
  }
}

// ─── Type Environment ────────────────────────────────────────

class TypeEnv {
  private bindings: Map<string, AxonType>;
  constructor(private parent: TypeEnv | null = null) {
    this.bindings = new Map();
  }
  define(name: string, ty: AxonType): void { this.bindings.set(name, ty); }
  get(name: string): AxonType | undefined {
    return this.bindings.get(name) ?? this.parent?.get(name);
  }
  child(): TypeEnv { return new TypeEnv(this); }
}

// ─── Diagnostic ──────────────────────────────────────────────

export interface Diagnostic {
  level:   'error' | 'warning';
  message: string;
  line:    number;
  col:     number;
}

// ─── Type Checker ────────────────────────────────────────────

export class TypeChecker {
  private diagnostics: Diagnostic[] = [];
  private typeEnv:     TypeEnv;
  private typeDecls:   Map<string, TypeDecl> = new Map();
  private agentDecls:  Map<string, AgentDecl> = new Map();
  private varCounter = 0;
  // When true, wildcard `use` imports are present; undefined vars become warnings
  private hasWildcardImports = false;
  // Current function's declared effects (null = top-level / unchecked)
  private currentEffects: Set<string> | null = null;
  private currentFnName = '';
  // When true, ALL functions are subject to effect checking (even unannotated ones)
  private strictEffects = false;
  // Type parameters in scope — these resolve to Unknown (unconstrained)
  private typeVarMap = new Set<string>();

  constructor() {
    this.typeEnv = new TypeEnv();
    this.registerBuiltins();
  }

  check(program: Program, opts?: { strictEffects?: boolean }): Diagnostic[] {
    this.diagnostics = [];
    this.strictEffects = opts?.strictEffects ?? false;

    // First pass: register all declarations (UseDecl imports as Unknown)
    for (const item of program.items) {
      if (item.kind === 'UseDecl') {
        // Register imported names as Unknown — the runtime will resolve them
        if (item.items) {
          for (const name of item.items) this.typeEnv.define(name, T_UNKNOWN);
        } else {
          // Wildcard import: can't know names statically; suppress undefined-var errors
          this.hasWildcardImports = true;
        }
        // Wildcard or aliased imports: can't know names statically, skip
      } else {
        this.registerDecl(item);
      }
    }

    // Second pass: type-check bodies
    for (const item of program.items) {
      this.checkTopLevel(item);
    }

    return this.diagnostics;
  }

  private registerBuiltins(): void {
    // Core functions
    this.typeEnv.define('print',    { kind: 'Fn', params: [T_UNKNOWN], ret: T_UNIT, effects: ['IO'] });
    this.typeEnv.define('println',  { kind: 'Fn', params: [T_UNKNOWN], ret: T_UNIT, effects: ['IO'] });
    this.typeEnv.define('str',      { kind: 'Fn', params: [T_UNKNOWN], ret: T_STRING, effects: [] });
    this.typeEnv.define('int',      { kind: 'Fn', params: [T_UNKNOWN], ret: T_INT, effects: [] });
    this.typeEnv.define('float',    { kind: 'Fn', params: [T_UNKNOWN], ret: T_FLOAT, effects: [] });
    this.typeEnv.define('bool',     { kind: 'Fn', params: [T_UNKNOWN], ret: T_BOOL, effects: [] });
    this.typeEnv.define('assert',    { kind: 'Fn', params: [T_BOOL, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('assert_eq', { kind: 'Fn', params: [T_UNKNOWN, T_UNKNOWN, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('assert_ne', { kind: 'Fn', params: [T_UNKNOWN, T_UNKNOWN, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('panic',     { kind: 'Fn', params: [T_STRING], ret: { kind: 'Never' }, effects: [] });
    this.typeEnv.define('typeof',   T_UNKNOWN);
    this.typeEnv.define('dbg',      T_UNKNOWN);

    // Option/Result constructors
    this.typeEnv.define('Some', T_UNKNOWN);
    this.typeEnv.define('None', { kind: 'Option', inner: T_UNKNOWN });
    this.typeEnv.define('Ok',   T_UNKNOWN);
    this.typeEnv.define('Err',  T_UNKNOWN);

    // Batch-register all unknowns: avoids false "undefined variable" errors for stdlib
    const U = T_UNKNOWN;
    const allUnknowns = [
      // List operations (complete)
      'len', 'list_len', 'list_is_empty', 'list_head', 'list_tail', 'list_last',
      'list_get', 'list_take', 'list_drop', 'list_from', 'list_prepend', 'list_append',
      'list_concat', 'list_reverse', 'list_contains', 'list_sum', 'list_zip', 'list_flatten',
      'list_unique', 'list_enumerate', 'list_range', 'list_range_inclusive', 'list_sort',
      'list_any', 'list_all', 'list_find', 'list_map', 'list_filter', 'list_fold',
      'list_reduce', 'list_flat_map', 'list_zip', 'list_group_by', 'list_chunk',
      'list_index_of', 'list_min', 'list_max', 'list_product', 'list_sorted',
      'list_count', 'list_partition', 'list_sum_by',
      // String operations (complete)
      'upper', 'lower', 'trim', 'trim_start', 'trim_end', 'split', 'join',
      'contains', 'starts_with', 'ends_with', 'replace', 'slice', 'char_at',
      'chars', 'bytes', 'parse_int', 'parse_float', 'format', 'repeat',
      'pad_left', 'pad_right', 'index_of', 'lines',
      'string_find', 'string_pad_start', 'string_pad_end', 'string_count',
      // Option operations
      'option_is_some', 'option_is_none', 'option_unwrap', 'option_unwrap_or',
      'option_ok_or', 'option_map', 'option_and_then',
      // Result operations
      'result_is_ok', 'result_is_err', 'result_unwrap', 'result_unwrap_or',
      'result_unwrap_err', 'result_map', 'result_map_err', 'result_and_then',
      // Map operations (complete)
      'map_empty', 'map_new', 'map_get', 'map_insert', 'map_remove', 'map_has',
      'map_len', 'map_is_empty', 'map_keys', 'map_values', 'map_entries',
      'map_update', 'map_filter', 'map_merge', 'map_from_keys',
      'map_set', 'map_contains', 'map_get_or', 'map_count',
      // Math (complete)
      'sqrt', 'pow', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'clamp',
      'log', 'log2', 'exp', 'sin', 'cos', 'tan', 'sign', 'trunc', 'fract',
      // Tuple operations
      'tuple_get', 'tuple_len',
      // Compare / random / misc
      'compare', 'min_val', 'max_val', 'random', 'random_int', 'random_bool',
      'now_ms', 'now_s', 'timestamp', 'sleep', 'sleep_ms', 'uuid',
      'read_file', 'write_file', 'file_exists',
      'type_of', 'exit',
      // Conversions
      'str', 'int', 'float', 'bool', 'string', 'char', 'debug', 'repr',
      // JSON (pure — no effects)
      'json_parse', 'json_stringify', 'json_stringify_pretty', 'json_get',
    ];
    for (const name of allUnknowns) this.typeEnv.define(name, U);

    // Override a few with more specific types for better checking
    this.typeEnv.define('print',    { kind: 'Fn', params: [U], ret: T_UNIT, effects: ['IO'] });
    this.typeEnv.define('println',  { kind: 'Fn', params: [U], ret: T_UNIT, effects: ['IO'] });
    this.typeEnv.define('eprint',   { kind: 'Fn', params: [U], ret: T_UNIT, effects: ['IO'] });
    this.typeEnv.define('assert',   { kind: 'Fn', params: [T_BOOL, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('assert_eq',{ kind: 'Fn', params: [U, U, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('assert_ne',{ kind: 'Fn', params: [U, U, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('panic',    { kind: 'Fn', params: [T_STRING], ret: { kind: 'Never' }, effects: [] });
    this.typeEnv.define('len',      { kind: 'Fn', params: [U], ret: T_INT, effects: [] });
    this.typeEnv.define('list_len', { kind: 'Fn', params: [U], ret: T_INT, effects: [] });
    this.typeEnv.define('list_range', { kind: 'Fn', params: [T_INT, T_INT], ret: { kind: 'List', elem: T_INT }, effects: [] });
    this.typeEnv.define('list_sum', { kind: 'Fn', params: [U], ret: T_INT, effects: [] });

    // IO-annotated stdlib functions (used for effect checking)
    const fnIO    = (n: number) => ({ kind: 'Fn' as const, params: Array(n).fill(U), ret: U, effects: ['IO'] });
    const fnNet   = (n: number) => ({ kind: 'Fn' as const, params: Array(n).fill(U), ret: U, effects: ['IO', 'Network'] });
    const fnLLM   = (n: number) => ({ kind: 'Fn' as const, params: Array(n).fill(U), ret: U, effects: ['IO', 'Network', 'LLM'] });
    const fnFile  = (n: number) => ({ kind: 'Fn' as const, params: Array(n).fill(U), ret: U, effects: ['IO', 'FileIO'] });
    const fnEnvFx = (n: number) => ({ kind: 'Fn' as const, params: Array(n).fill(U), ret: U, effects: ['IO', 'Env'] });
    this.typeEnv.define('read_file',           fnFile(1));
    this.typeEnv.define('write_file',          fnFile(2));
    this.typeEnv.define('file_exists',         fnFile(1));
    this.typeEnv.define('http_get',            fnNet(1));
    this.typeEnv.define('http_post',           fnNet(3));
    this.typeEnv.define('http_get_json',       fnNet(1));
    this.typeEnv.define('env_get',             fnEnvFx(1));
    this.typeEnv.define('env_set',             fnEnvFx(2));
    this.typeEnv.define('env_all',             fnEnvFx(0));
    this.typeEnv.define('args',                fnEnvFx(0));
    this.typeEnv.define('llm_call',            fnLLM(2));
    this.typeEnv.define('now_ms',              fnIO(0));
    this.typeEnv.define('now_s',               fnIO(0));
    this.typeEnv.define('timestamp',           fnIO(0));
    this.typeEnv.define('random',              { kind: 'Fn', params: [], ret: T_FLOAT, effects: ['Random'] });
    this.typeEnv.define('random_int',          { kind: 'Fn', params: [T_INT, T_INT], ret: T_INT, effects: ['Random'] });
    this.typeEnv.define('random_bool',         { kind: 'Fn', params: [], ret: T_BOOL, effects: ['Random'] });
    // tool_ functions
    this.typeEnv.define('tool_list',           U);
    this.typeEnv.define('tool_schema',         U);
    this.typeEnv.define('tool_call',           { kind: 'Fn', params: [U, U], ret: U, effects: ['IO'] });
    this.typeEnv.define('llm_call_with_tools', fnLLM(2));
    this.typeEnv.define('llm_structured',      fnLLM(2));
    this.typeEnv.define('agent_tool_loop',     fnLLM(3));
    // Multi-agent orchestration
    this.typeEnv.define('ask_all',             { kind: 'Fn', params: [U, U], ret: { kind: 'List', elem: U }, effects: [] });
    this.typeEnv.define('ask_any',             { kind: 'Fn', params: [U, U], ret: U, effects: [] });
    this.typeEnv.define('pipeline',            { kind: 'Fn', params: [U, U], ret: U, effects: [] });
    // Channel primitives
    this.typeEnv.define('channel',             { kind: 'Fn', params: [U], ret: U, effects: [] });
    this.typeEnv.define('chan_send',           { kind: 'Fn', params: [U, U], ret: T_UNIT, effects: [] });
    this.typeEnv.define('chan_recv',           { kind: 'Fn', params: [U], ret: U, effects: [] });
    this.typeEnv.define('chan_try_recv',       { kind: 'Fn', params: [U], ret: U, effects: [] });
    this.typeEnv.define('chan_try_send',       { kind: 'Fn', params: [U, U], ret: T_BOOL, effects: [] });
    this.typeEnv.define('chan_close',          { kind: 'Fn', params: [U], ret: T_UNIT, effects: [] });
    this.typeEnv.define('chan_is_closed',      { kind: 'Fn', params: [U], ret: T_BOOL, effects: [] });
    this.typeEnv.define('chan_size',           { kind: 'Fn', params: [U], ret: T_INT, effects: [] });
    this.typeEnv.define('chan_select',         { kind: 'Fn', params: [U], ret: U, effects: [] });
    this.typeEnv.define('chan_select_timeout', { kind: 'Fn', params: [U, U], ret: U, effects: [] });
    this.typeEnv.define('assert_eq',          { kind: 'Fn', params: [U, U, U], ret: T_UNIT, effects: [] });
    this.typeEnv.define('assert_ne',          { kind: 'Fn', params: [U, U, U], ret: T_UNIT, effects: [] });
    // Test / introspection helpers
    this.typeEnv.define('interpreter_hot_reload', { kind: 'Fn', params: [U], ret: T_UNIT, effects: [] });

    // Constants
    this.typeEnv.define('PI',       T_FLOAT);
    this.typeEnv.define('E',        T_FLOAT);
    this.typeEnv.define('MAX_INT',  T_INT);
    this.typeEnv.define('MIN_INT',  T_INT);
    this.typeEnv.define('true',     T_BOOL);
    this.typeEnv.define('false',    T_BOOL);
    this.typeEnv.define('unit',     T_UNIT);

    // Option/Result constructors
    this.typeEnv.define('Some', U);
    this.typeEnv.define('None', { kind: 'Option', inner: U });
    this.typeEnv.define('Ok',   U);
    this.typeEnv.define('Err',  U);

    // typeof / dbg
    this.typeEnv.define('type_of', U);
    this.typeEnv.define('dbg',     U);
  }

  private registerDecl(item: TopLevel): void {
    switch (item.kind) {
      case 'FnDecl': {
        // Push type parameters into scope for resolveType
        const savedTVars = new Set(this.typeVarMap);
        for (const tp of item.typeParams) this.typeVarMap.add(tp);
        const paramTypes = item.params.map(p => p.ty ? this.resolveType(p.ty) : T_UNKNOWN);
        const retType    = item.retTy ? this.resolveType(item.retTy) : T_UNKNOWN;
        this.typeVarMap  = savedTVars;
        this.typeEnv.define(item.name, {
          kind: 'Fn', params: paramTypes, ret: retType, effects: item.effects,
        });
        break;
      }
      case 'TypeDecl': {
        // Push type parameters into scope so field types resolve correctly
        const savedTVars = new Set(this.typeVarMap);
        for (const tp of item.typeParams) this.typeVarMap.add(tp);
        this.typeDecls.set(item.name, item);
        this.typeEnv.define(item.name, { kind: 'Named', name: item.name, args: [] });
        // Register variant constructors
        if (item.def.kind === 'Enum') {
          for (const variant of item.def.variants) {
            this.typeEnv.define(variant.name, T_UNKNOWN);
          }
        }
        this.typeVarMap = savedTVars;
        break;
      }
      case 'AgentDecl': {
        this.agentDecls.set(item.name, item);
        this.typeEnv.define(item.name, { kind: 'Agent', msgType: item.name });
        // Register message types (handler names) as known identifiers
        for (const handler of item.handlers) {
          this.typeEnv.define(handler.msgType, T_UNKNOWN);
        }
        break;
      }
      case 'ConstDecl': {
        const ty = item.ty ? this.resolveType(item.ty) : T_UNKNOWN;
        this.typeEnv.define(item.name, ty);
        break;
      }
    }
  }

  private checkTopLevel(item: TopLevel): void {
    switch (item.kind) {
      case 'FnDecl':    this.checkFn(item); break;
      case 'AgentDecl': this.checkAgent(item); break;
      case 'ConstDecl': this.checkExpr(item.value, this.typeEnv); break;
      case 'ImplDecl':  for (const m of item.methods) this.checkFn(m); break;
    }
  }

  private checkFn(decl: FnDecl): void {
    if (!decl.body) return;

    // Push type parameters into scope
    const savedTVars = new Set(this.typeVarMap);
    for (const tp of decl.typeParams) this.typeVarMap.add(tp);

    const fnEnv = this.typeEnv.child();
    for (const p of decl.params) {
      fnEnv.define(p.name, p.ty ? this.resolveType(p.ty) : T_UNKNOWN);
    }

    // Effect enforcement: for explicit-annotated fns, or ALL fns in strict mode
    const savedEffects = this.currentEffects;
    const savedFnName  = this.currentFnName;
    if (decl.effectsExplicit || this.strictEffects) {
      this.currentEffects = new Set(decl.effects);
      this.currentFnName  = decl.name;
    } else {
      this.currentEffects = null;
    }

    const expectedRet = decl.retTy ? this.resolveType(decl.retTy) : T_UNKNOWN;
    const actualRet   = this.checkExpr(decl.body, fnEnv);

    this.currentEffects = savedEffects;
    this.currentFnName  = savedFnName;
    this.typeVarMap     = savedTVars;  // restore type param scope

    if (!typesCompatible(expectedRet, actualRet)) {
      this.error(
        `Function '${decl.name}' declared return type ${typeToString(expectedRet)} ` +
        `but body returns ${typeToString(actualRet)}`,
        decl.span
      );
    }
  }

  private checkAgent(decl: AgentDecl): void {
    const agentEnv = this.typeEnv.child();

    // Register state fields
    for (const sf of decl.stateFields) {
      agentEnv.define(sf.name, sf.ty ? this.resolveType(sf.ty) : T_UNKNOWN, );
    }

    // Check handlers
    for (const handler of decl.handlers) {
      const handlerEnv = agentEnv.child();
      for (const p of handler.params) {
        handlerEnv.define(p.name, p.ty ? this.resolveType(p.ty) : T_UNKNOWN);
      }

      const savedEffects = this.currentEffects;
      const savedFnName  = this.currentFnName;
      if (handler.effectsExplicit || this.strictEffects) {
        this.currentEffects = new Set(handler.effects);
        this.currentFnName  = `${decl.name}.${handler.msgType}`;
      } else {
        this.currentEffects = null;
      }

      const expectedRet = handler.retTy ? this.resolveType(handler.retTy) : T_UNKNOWN;
      const actualRet   = this.checkExpr(handler.body, handlerEnv);

      this.currentEffects = savedEffects;
      this.currentFnName  = savedFnName;

      if (!typesCompatible(expectedRet, actualRet)) {
        this.error(
          `Handler '${handler.msgType}' declared return type ${typeToString(expectedRet)} ` +
          `but body returns ${typeToString(actualRet)}`,
          handler.span
        );
      }
    }
  }

  private checkExpr(expr: Expr, env: TypeEnv): AxonType {
    switch (expr.kind) {
      case 'IntLit':    return T_INT;
      case 'FloatLit':  return T_FLOAT;
      case 'BoolLit':   return T_BOOL;
      case 'StringLit': return T_STRING;
      case 'CharLit':   return { kind: 'Char' };
      case 'UnitLit':   return T_UNIT;

      case 'Ident': {
        const ty = env.get(expr.name);
        if (ty === undefined) {
          if (this.hasWildcardImports) {
            // Could be a wildcard-imported name; suppress error
          } else {
            this.error(`Undefined variable: '${expr.name}'`, expr.span);
          }
          return T_UNKNOWN;
        }
        return ty;
      }

      case 'Block': {
        const blockEnv = env.child();
        for (const stmt of expr.stmts) {
          this.checkStmt(stmt, blockEnv);
        }
        return expr.tail ? this.checkExpr(expr.tail, blockEnv) : T_UNIT;
      }

      case 'If': {
        const condTy = this.checkExpr(expr.cond, env);
        if (condTy.kind !== 'Bool' && condTy.kind !== 'Unknown') {
          this.error(`if condition must be Bool, got ${typeToString(condTy)}`, expr.span);
        }
        const thenTy  = this.checkExpr(expr.then, env);
        const elseTy  = expr.else_ ? this.checkExpr(expr.else_, env) : T_UNIT;
        // Return the more specific of the two branches
        return thenTy.kind !== 'Unknown' ? thenTy : elseTy;
      }

      case 'Match': {
        this.checkExpr(expr.scrutinee, env);
        const armTypes: AxonType[] = [];

        for (const arm of expr.arms) {
          const armEnv = env.child();
          this.checkPattern(arm.pattern, T_UNKNOWN, armEnv);
          if (arm.guard) this.checkExpr(arm.guard, armEnv);
          armTypes.push(this.checkExpr(arm.body, armEnv));
        }

        // Check all arms have compatible types
        if (armTypes.length > 0) {
          const first = armTypes[0];
          for (let i = 1; i < armTypes.length; i++) {
            if (!typesCompatible(first, armTypes[i])) {
              this.warn(`Match arms have inconsistent types: ${typeToString(first)} vs ${typeToString(armTypes[i])}`, expr.span);
            }
          }
          return first;
        }
        return T_UNIT;
      }

      case 'Binary': {
        const leftTy  = this.checkExpr(expr.left, env);
        const rightTy = this.checkExpr(expr.right, env);

        // Type check binary operators
        switch (expr.op) {
          case '+': case '-': case '*': case '/': case '%':
            if (!isNumeric(leftTy) && leftTy.kind !== 'String' && leftTy.kind !== 'Unknown') {
              this.error(`Operator '${expr.op}' requires numeric or string type, got ${typeToString(leftTy)}`, expr.span);
            }
            // Catch mixed Int+String / String+Int etc.
            if (leftTy.kind !== 'Unknown' && rightTy.kind !== 'Unknown') {
              const leftNum  = isNumeric(leftTy);
              const rightNum = isNumeric(rightTy);
              const leftStr  = leftTy.kind  === 'String';
              const rightStr = rightTy.kind === 'String';
              if ((leftNum && rightStr) || (leftStr && rightNum)) {
                this.error(
                  `Type mismatch: cannot apply '${expr.op}' to ${typeToString(leftTy)} and ${typeToString(rightTy)}`,
                  expr.span
                );
              }
            }
            return leftTy.kind === 'String' ? T_STRING : (isFloat(leftTy) || isFloat(rightTy)) ? T_FLOAT : leftTy;

          case '==': case '!=': return T_BOOL;
          case '<': case '>': case '<=': case '>=':
            if (!isNumeric(leftTy) && leftTy.kind !== 'String' && leftTy.kind !== 'Unknown') {
              this.warn(`Comparison '${expr.op}' on non-numeric type ${typeToString(leftTy)}`, expr.span);
            }
            return T_BOOL;

          case '&&': case '||':
            if (leftTy.kind !== 'Bool' && leftTy.kind !== 'Unknown') {
              this.error(`Logical operator '${expr.op}' requires Bool, got ${typeToString(leftTy)}`, expr.span);
            }
            return T_BOOL;
        }
        return T_UNKNOWN;
      }

      case 'Unary': {
        const ty = this.checkExpr(expr.expr, env);
        if (expr.op === '!' && ty.kind !== 'Bool' && ty.kind !== 'Unknown') {
          this.error(`'!' requires Bool, got ${typeToString(ty)}`, expr.span);
        }
        return ty;
      }

      case 'Call': {
        const calleeTy = this.checkExpr(expr.callee, env);
        for (const arg of expr.args) this.checkExpr(arg.value, env);

        if (calleeTy.kind === 'Fn') {
          // Effect enforcement: only when current function has explicit effect annotation (or --strict-effects)
          if (this.currentEffects !== null && calleeTy.effects.length > 0) {
            for (const fx of calleeTy.effects) {
              if (!this.effectSubsumedBy(fx, this.currentEffects)) {
                const calleeName = expr.callee.kind === 'Ident' ? expr.callee.name : '<expr>';
                const hint = this.effectHint(fx);
                this.error(
                  `Effect '${fx}' from calling '${calleeName}' is not declared in function '${this.currentFnName}'. ` +
                  `Add '| ${fx}' to the function signature.${hint}`,
                  expr.span
                );
              }
            }
          }
          // Check arg count
          if (expr.args.length > calleeTy.params.length) {
            this.warn(`Too many arguments: expected ${calleeTy.params.length}, got ${expr.args.length}`, expr.span);
          }
          return calleeTy.ret;
        }
        return T_UNKNOWN;
      }

      case 'Lambda': {
        const lambdaEnv = env.child();
        const paramTys  = expr.params.map(p => {
          const ty = p.ty ? this.resolveType(p.ty) : T_UNKNOWN;
          lambdaEnv.define(p.name, ty);
          return ty;
        });
        const retTy = this.checkExpr(expr.body, lambdaEnv);
        return { kind: 'Fn', params: paramTys, ret: retTy, effects: [] };
      }

      case 'List': {
        const elemTypes = expr.elems.map(e => this.checkExpr(e, env));
        const elem      = elemTypes.length > 0 ? elemTypes[0] : T_UNKNOWN;
        return { kind: 'List', elem };
      }

      case 'Tuple': {
        return { kind: 'Tuple', elems: expr.elems.map(e => this.checkExpr(e, env)) };
      }

      case 'MethodCall': {
        const objTy = this.checkExpr(expr.obj, env);
        for (const arg of expr.args) this.checkExpr(arg.value, env);
        // Common method return types
        switch (expr.method) {
          case 'len':        return T_INT;
          case 'is_empty':   return T_BOOL;
          case 'contains':   return T_BOOL;
          case 'starts_with':
          case 'ends_with':  return T_BOOL;
          case 'upper':
          case 'lower':
          case 'trim':
          case 'trim_start':
          case 'trim_end':
          case 'replace':
          case 'repeat':     return T_STRING;
          case 'split':      return { kind: 'List', elem: T_STRING };
          case 'chars':      return { kind: 'List', elem: { kind: 'Char' } };
          case 'lines':      return { kind: 'List', elem: T_STRING };
          case 'map':        return { kind: 'List', elem: T_UNKNOWN };
          case 'filter':     return { kind: 'List', elem: T_UNKNOWN };
          case 'send':
          case 'ask':        return T_UNKNOWN;
          default:           return T_UNKNOWN;
        }
      }

      case 'FieldAccess': {
        this.checkExpr(expr.obj, env);
        return T_UNKNOWN;
      }

      case 'Spawn': {
        const decl = this.agentDecls.get(expr.agentName);
        if (!decl) {
          this.error(`Unknown agent: '${expr.agentName}'`, expr.span);
          return T_UNKNOWN;
        }
        return { kind: 'Agent', msgType: expr.agentName };
      }

      case 'Try': {
        const inner = this.checkExpr(expr.expr, env);
        if (inner.kind === 'Result') return inner.ok;
        if (inner.kind === 'Option') return inner.inner;
        return T_UNKNOWN;
      }

      case 'EnumVariant': {
        // Map well-known constructors to proper structural types
        const v = expr.variant;
        if (v === 'None' || v === 'Some') return { kind: 'Option', inner: T_UNKNOWN };
        if (v === 'Ok'   || v === 'Err')  return { kind: 'Result', ok: T_UNKNOWN, err: T_UNKNOWN };
        return { kind: 'Named', name: expr.typeName || v, args: [] };
      }

      case 'Record': {
        for (const f of expr.fields) this.checkExpr(f.value, env);
        return { kind: 'Named', name: expr.typeName ?? 'Record', args: [] };
      }

      case 'Pipe': {
        this.checkExpr(expr.left, env);
        const rightTy = this.checkExpr(expr.right, env);
        // If the right side is a known function, return its return type
        return rightTy.kind === 'Fn' ? rightTy.ret : T_UNKNOWN;
      }

      case 'Await':    return this.checkExpr(expr.expr, env);
      case 'Force':    return this.checkExpr(expr.expr, env);
      case 'Return':   { if (expr.value) this.checkExpr(expr.value, env); return { kind: 'Never' }; }
      case 'Break':    { if (expr.value) this.checkExpr(expr.value, env); return { kind: 'Never' }; }
      case 'Continue': return { kind: 'Never' };
      case 'Index': {
        const objTy2 = this.checkExpr(expr.obj, env);
        this.checkExpr(expr.index, env);
        if (objTy2.kind === 'List')   return objTy2.elem;
        if (objTy2.kind === 'String') return { kind: 'Char' };
        return T_UNKNOWN;
      }
      case 'Unary':    return this.checkExpr(expr.expr, env);

      case 'TypeAscription': {
        const ty = this.resolveType(expr.ty);
        const actual = this.checkExpr(expr.expr, env);
        if (!typesCompatible(ty, actual)) {
          this.warn(`Type ascription: expected ${typeToString(ty)}, expression has type ${typeToString(actual)}`, expr.span);
        }
        return ty;
      }

      case 'RecordUpdate': {
        const baseTy = this.checkExpr(expr.base, env);
        for (const f of expr.fields) this.checkExpr(f.value, env);
        return baseTy;
      }

      case 'IfLet': {
        this.checkExpr(expr.value, env);
        const ifLetEnv = env.child();
        this.checkPatternBinding(expr.pat, T_UNKNOWN, ifLetEnv);
        this.checkExpr(expr.then, ifLetEnv);
        if (expr.else_) this.checkExpr(expr.else_, env);
        return T_UNKNOWN;
      }

      case 'Loop': {
        this.checkExpr(expr.body, env);
        return T_UNKNOWN;
      }

      case 'Range': {
        this.checkExpr(expr.lo, env);
        this.checkExpr(expr.hi, env);
        return T_UNKNOWN;
      }

      case 'HandleExpr': {
        for (const h of expr.handlers) this.checkExpr(h.handler, env);
        const handlerEnv = env.child();
        for (const h of expr.handlers) handlerEnv.define(h.name, T_UNKNOWN);
        return this.checkExpr(expr.body, handlerEnv);
      }

      default: return T_UNKNOWN;
    }
  }

  private checkStmt(stmt: Stmt, env: TypeEnv): void {
    switch (stmt.kind) {
      case 'LetStmt': {
        // Pre-register as Unknown to support recursive lambdas (local fn)
        if (stmt.init.kind === 'Lambda') this.checkPatternBinding(stmt.pat, T_UNKNOWN, env);
        const ty = this.checkExpr(stmt.init, env);
        this.checkPatternBinding(stmt.pat, ty, env);
        break;
      }
      case 'LetMutStmt': {
        // Pre-register as Unknown to support recursive lambdas
        if (stmt.init.kind === 'Lambda') env.define(stmt.name, T_UNKNOWN);
        const ty = this.checkExpr(stmt.init, env);
        env.define(stmt.name, ty);
        break;
      }
      case 'AssignStmt': {
        this.checkExpr(stmt.target, env);
        this.checkExpr(stmt.value, env);
        break;
      }
      case 'ExprStmt': {
        this.checkExpr(stmt.expr, env);
        break;
      }
      case 'ForStmt': {
        const iterTy  = this.checkExpr(stmt.iter, env);
        const loopEnv = env.child();
        const elemTy  = iterTy.kind === 'List' ? iterTy.elem : T_UNKNOWN;
        this.checkPatternBinding(stmt.pat, elemTy, loopEnv);
        this.checkExpr(stmt.body, loopEnv);
        break;
      }
      case 'WhileStmt': {
        this.checkExpr(stmt.cond, env);
        this.checkExpr(stmt.body, env);
        break;
      }
      case 'WhileLetStmt': {
        this.checkExpr(stmt.value, env);
        const wlEnv = env.child();
        this.checkPatternBinding(stmt.pat, T_UNKNOWN, wlEnv);
        this.checkExpr(stmt.body, wlEnv);
        break;
      }
    }
  }

  private checkPattern(pat: Pattern, ty: AxonType, env: TypeEnv): void {
    this.checkPatternBinding(pat, ty, env);
  }

  private checkPatternBinding(pat: Pattern, ty: AxonType, env: TypeEnv): void {
    switch (pat.kind) {
      case 'WildPat': break;
      case 'IdentPat': env.define(pat.name, ty); break;
      case 'TuplePat':
        if (ty.kind === 'Tuple') {
          pat.elems.forEach((p, i) => this.checkPatternBinding(p, ty.elems[i] ?? T_UNKNOWN, env));
        } else {
          pat.elems.forEach(p => this.checkPatternBinding(p, T_UNKNOWN, env));
        }
        break;
      case 'EnumPat':
        pat.fields.forEach(p => this.checkPatternBinding(p, T_UNKNOWN, env));
        pat.recordFields.forEach(({ pat: p }) => this.checkPatternBinding(p, T_UNKNOWN, env));
        break;
      case 'ListPat':
        pat.head.forEach(p => this.checkPatternBinding(p, ty.kind === 'List' ? ty.elem : T_UNKNOWN, env));
        if (pat.tail) env.define(pat.tail, { kind: 'List', elem: ty.kind === 'List' ? ty.elem : T_UNKNOWN });
        break;
      case 'BindPat':
        env.define(pat.name, ty);
        this.checkPatternBinding(pat.inner, ty, env);
        break;
    }
  }

  private resolveType(te: TypeExpr): AxonType {
    switch (te.kind) {
      case 'NameType': {
        // Type parameters in scope resolve to Unknown (unconstrained / universally polymorphic)
        if (this.typeVarMap.has(te.name)) return T_UNKNOWN;
        switch (te.name) {
          case 'Int':     return T_INT;
          case 'Float':   return T_FLOAT;
          case 'Bool':    return T_BOOL;
          case 'String':  return T_STRING;
          case 'Char':    return { kind: 'Char' };
          case 'Unit':    return T_UNIT;
          case 'Never':   return { kind: 'Never' };
          case 'List':    return { kind: 'List', elem: te.params[0] ? this.resolveType(te.params[0]) : T_UNKNOWN };
          case 'Option':  return { kind: 'Option', inner: te.params[0] ? this.resolveType(te.params[0]) : T_UNKNOWN };
          case 'Result':  return {
            kind: 'Result',
            ok:  te.params[0] ? this.resolveType(te.params[0]) : T_UNKNOWN,
            err: te.params[1] ? this.resolveType(te.params[1]) : T_UNKNOWN,
          };
          default: return { kind: 'Named', name: te.name, args: te.params.map(p => this.resolveType(p)) };
        }
      }
      case 'TupleType':  return { kind: 'Tuple', elems: te.elems.map(e => this.resolveType(e)) };
      case 'UnitType':   return T_UNIT;
      case 'NeverType':  return { kind: 'Never' };
      case 'InferType':  return T_UNKNOWN;
      case 'FnType':     return {
        kind: 'Fn',
        params: te.params.map(p => this.resolveType(p)),
        ret: this.resolveType(te.ret),
        effects: te.effects,
      };
      default: return T_UNKNOWN;
    }
  }

  private error(msg: string, span: { line: number; col: number }): void {
    this.diagnostics.push({ level: 'error', message: msg, line: span.line, col: span.col });
  }

  private warn(msg: string, span: { line: number; col: number }): void {
    this.diagnostics.push({ level: 'warning', message: msg, line: span.line, col: span.col });
  }

  // Effect subtype hierarchy: FileIO, Network, Env, LLM are all sub-effects of IO.
  // If the declared set contains a parent effect, the specific effect is covered.
  private effectSubsumedBy(specific: string, declared: Set<string>): boolean {
    if (declared.has(specific)) return true;
    const parents: Record<string, string[]> = {
      'FileIO':  ['IO'],
      'Network': ['IO'],
      'Env':     ['IO'],
      'LLM':     ['IO', 'Network'],
    };
    return (parents[specific] ?? []).some(p => declared.has(p));
  }

  private effectHint(fx: string): string {
    const hints: Record<string, string> = {
      'IO':      ' (general IO effect)',
      'FileIO':  ' (or declare | IO to cover all IO effects)',
      'Network': ' (or declare | IO to cover all IO effects)',
      'LLM':     ' (or declare | IO, Network)',
      'Env':     ' (or declare | IO to cover all IO effects)',
      'Random':  ' (non-deterministic randomness effect)',
    };
    return hints[fx] ?? '';
  }
}

function isNumeric(t: AxonType): boolean {
  return t.kind === 'Int' || t.kind === 'Float' || t.kind === 'Unknown';
}
function isFloat(t: AxonType): boolean {
  return t.kind === 'Float';
}

export function typeCheck(program: Program, opts?: { strictEffects?: boolean }): Diagnostic[] {
  return new TypeChecker().check(program, opts);
}
