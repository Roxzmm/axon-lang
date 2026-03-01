// ============================================================
// Axon Language — Type Checker
// ============================================================
// Simplified bidirectional type checker.
// Catches common errors without full HM inference.

import type {
  Program, TopLevel, FnDecl, TypeDecl, AgentDecl,
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

  constructor() {
    this.typeEnv = new TypeEnv();
    this.registerBuiltins();
  }

  check(program: Program): Diagnostic[] {
    this.diagnostics = [];

    // First pass: register all declarations
    for (const item of program.items) {
      this.registerDecl(item);
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
    this.typeEnv.define('assert',   { kind: 'Fn', params: [T_BOOL, T_STRING], ret: T_UNIT, effects: [] });
    this.typeEnv.define('panic',    { kind: 'Fn', params: [T_STRING], ret: { kind: 'Never' }, effects: [] });
    this.typeEnv.define('typeof',   T_UNKNOWN);
    this.typeEnv.define('dbg',      T_UNKNOWN);

    // Option/Result constructors
    this.typeEnv.define('Some', T_UNKNOWN);
    this.typeEnv.define('None', { kind: 'Option', inner: T_UNKNOWN });
    this.typeEnv.define('Ok',   T_UNKNOWN);
    this.typeEnv.define('Err',  T_UNKNOWN);

    // List operations
    const FN_UNKNOWN: AxonType = { kind: 'Fn', params: [T_UNKNOWN], ret: T_UNKNOWN, effects: [] };
    this.typeEnv.define('len',          { kind: 'Fn', params: [T_UNKNOWN], ret: T_INT, effects: [] });
    this.typeEnv.define('list_map',     T_UNKNOWN);
    this.typeEnv.define('list_filter',  T_UNKNOWN);
    this.typeEnv.define('list_fold',    T_UNKNOWN);
    this.typeEnv.define('list_reduce',  T_UNKNOWN);
    this.typeEnv.define('list_range',   { kind: 'Fn', params: [T_INT, T_INT], ret: { kind: 'List', elem: T_INT }, effects: [] });
    this.typeEnv.define('list_len',     { kind: 'Fn', params: [T_UNKNOWN], ret: T_INT, effects: [] });
    this.typeEnv.define('list_head',    T_UNKNOWN);
    this.typeEnv.define('list_tail',    T_UNKNOWN);
    this.typeEnv.define('list_last',    T_UNKNOWN);
    this.typeEnv.define('list_drop',    T_UNKNOWN);
    this.typeEnv.define('list_take',    T_UNKNOWN);
    this.typeEnv.define('list_append',  T_UNKNOWN);
    this.typeEnv.define('list_prepend', T_UNKNOWN);
    this.typeEnv.define('list_concat',  T_UNKNOWN);
    this.typeEnv.define('list_reverse', T_UNKNOWN);
    this.typeEnv.define('list_sort',    T_UNKNOWN);
    this.typeEnv.define('list_sum',     { kind: 'Fn', params: [T_UNKNOWN], ret: T_INT, effects: [] });
    this.typeEnv.define('list_min',     T_UNKNOWN);
    this.typeEnv.define('list_max',     T_UNKNOWN);
    this.typeEnv.define('list_any',     T_UNKNOWN);
    this.typeEnv.define('list_all',     T_UNKNOWN);
    this.typeEnv.define('list_find',    T_UNKNOWN);
    this.typeEnv.define('list_index',   T_UNKNOWN);
    this.typeEnv.define('list_zip',     T_UNKNOWN);
    this.typeEnv.define('list_flat_map',T_UNKNOWN);
    this.typeEnv.define('list_unique',  T_UNKNOWN);
    this.typeEnv.define('list_group_by',T_UNKNOWN);
    this.typeEnv.define('list_chunk',   T_UNKNOWN);
    this.typeEnv.define('list_flatten', T_UNKNOWN);
    this.typeEnv.define('list_contains',T_UNKNOWN);
    this.typeEnv.define('list_join',    T_UNKNOWN);

    // String operations
    this.typeEnv.define('upper',       { kind: 'Fn', params: [T_STRING], ret: T_STRING, effects: [] });
    this.typeEnv.define('lower',       { kind: 'Fn', params: [T_STRING], ret: T_STRING, effects: [] });
    this.typeEnv.define('trim',        { kind: 'Fn', params: [T_STRING], ret: T_STRING, effects: [] });
    this.typeEnv.define('split',       T_UNKNOWN);
    this.typeEnv.define('join',        T_UNKNOWN);
    this.typeEnv.define('contains',    T_UNKNOWN);
    this.typeEnv.define('starts_with', T_UNKNOWN);
    this.typeEnv.define('ends_with',   T_UNKNOWN);
    this.typeEnv.define('replace',     T_UNKNOWN);
    this.typeEnv.define('slice',       T_UNKNOWN);
    this.typeEnv.define('char_at',     T_UNKNOWN);
    this.typeEnv.define('parse_int',   T_UNKNOWN);
    this.typeEnv.define('parse_float', T_UNKNOWN);
    this.typeEnv.define('format',      T_UNKNOWN);
    this.typeEnv.define('repeat',      T_UNKNOWN);
    this.typeEnv.define('pad_left',    T_UNKNOWN);
    this.typeEnv.define('pad_right',   T_UNKNOWN);
    this.typeEnv.define('index_of',    T_UNKNOWN);
    this.typeEnv.define('chars',       T_UNKNOWN);
    this.typeEnv.define('bytes',       T_UNKNOWN);

    // Math operations
    this.typeEnv.define('sqrt',  { kind: 'Fn', params: [T_FLOAT], ret: T_FLOAT, effects: [] });
    this.typeEnv.define('pow',   { kind: 'Fn', params: [T_FLOAT, T_FLOAT], ret: T_FLOAT, effects: [] });
    this.typeEnv.define('abs',   T_UNKNOWN);
    this.typeEnv.define('floor', { kind: 'Fn', params: [T_FLOAT], ret: T_INT, effects: [] });
    this.typeEnv.define('ceil',  { kind: 'Fn', params: [T_FLOAT], ret: T_INT, effects: [] });
    this.typeEnv.define('round', { kind: 'Fn', params: [T_FLOAT], ret: T_INT, effects: [] });
    this.typeEnv.define('min',   T_UNKNOWN);
    this.typeEnv.define('max',   T_UNKNOWN);
    this.typeEnv.define('clamp', T_UNKNOWN);
    this.typeEnv.define('log',   T_UNKNOWN);
    this.typeEnv.define('exp',   T_UNKNOWN);
    this.typeEnv.define('sin',   T_UNKNOWN);
    this.typeEnv.define('cos',   T_UNKNOWN);
    this.typeEnv.define('tan',   T_UNKNOWN);
    this.typeEnv.define('pi',    T_FLOAT);
    this.typeEnv.define('nan',   T_FLOAT);

    // Map operations
    this.typeEnv.define('map_empty',   T_UNKNOWN);
    this.typeEnv.define('map_get',     T_UNKNOWN);
    this.typeEnv.define('map_insert',  T_UNKNOWN);
    this.typeEnv.define('map_remove',  T_UNKNOWN);
    this.typeEnv.define('map_has',     T_UNKNOWN);
    this.typeEnv.define('map_keys',    T_UNKNOWN);
    this.typeEnv.define('map_values',  T_UNKNOWN);
    this.typeEnv.define('map_entries', T_UNKNOWN);
    this.typeEnv.define('map_size',    T_UNKNOWN);
    this.typeEnv.define('map_map',     T_UNKNOWN);
    this.typeEnv.define('map_filter',  T_UNKNOWN);
    this.typeEnv.define('map_merge',   T_UNKNOWN);

    // IO / Time / Util
    this.typeEnv.define('now',         T_UNKNOWN);
    this.typeEnv.define('rand',        T_UNKNOWN);
    this.typeEnv.define('rand_int',    T_UNKNOWN);
    this.typeEnv.define('read_file',   T_UNKNOWN);
    this.typeEnv.define('write_file',  T_UNKNOWN);
    this.typeEnv.define('sleep',       T_UNKNOWN);
    this.typeEnv.define('env_get',     T_UNKNOWN);
    this.typeEnv.define('exit',        T_UNKNOWN);
  }

  private registerDecl(item: TopLevel): void {
    switch (item.kind) {
      case 'FnDecl': {
        const paramTypes = item.params.map(p => p.ty ? this.resolveType(p.ty) : T_UNKNOWN);
        const retType    = item.retTy ? this.resolveType(item.retTy) : T_UNKNOWN;
        this.typeEnv.define(item.name, {
          kind: 'Fn', params: paramTypes, ret: retType, effects: item.effects,
        });
        break;
      }
      case 'TypeDecl': {
        this.typeDecls.set(item.name, item);
        this.typeEnv.define(item.name, { kind: 'Named', name: item.name, args: [] });
        // Register variant constructors
        if (item.def.kind === 'Enum') {
          for (const variant of item.def.variants) {
            this.typeEnv.define(variant.name, T_UNKNOWN);
          }
        }
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
    }
  }

  private checkFn(decl: FnDecl): void {
    if (!decl.body) return;

    const fnEnv = this.typeEnv.child();
    for (const p of decl.params) {
      fnEnv.define(p.name, p.ty ? this.resolveType(p.ty) : T_UNKNOWN);
    }

    const expectedRet = decl.retTy ? this.resolveType(decl.retTy) : T_UNKNOWN;
    const actualRet   = this.checkExpr(decl.body, fnEnv);

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
      const expectedRet = handler.retTy ? this.resolveType(handler.retTy) : T_UNKNOWN;
      const actualRet   = this.checkExpr(handler.body, handlerEnv);

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
          this.error(`Undefined variable: '${expr.name}'`, expr.span);
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
        return T_UNKNOWN; // Simplified: skip method type resolution
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
        return { kind: 'Named', name: expr.typeName || expr.variant, args: [] };
      }

      case 'Record': {
        for (const f of expr.fields) this.checkExpr(f.value, env);
        return { kind: 'Named', name: expr.typeName ?? 'Record', args: [] };
      }

      case 'Pipe': {
        const leftTy = this.checkExpr(expr.left, env);
        this.checkExpr(expr.right, env);
        return T_UNKNOWN;
      }

      case 'Await':    return this.checkExpr(expr.expr, env);
      case 'Force':    return this.checkExpr(expr.expr, env);
      case 'Return':   { if (expr.value) this.checkExpr(expr.value, env); return { kind: 'Never' }; }
      case 'Break':    { if (expr.value) this.checkExpr(expr.value, env); return { kind: 'Never' }; }
      case 'Continue': return { kind: 'Never' };
      case 'Index':    { this.checkExpr(expr.obj, env); this.checkExpr(expr.index, env); return T_UNKNOWN; }
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

      default: return T_UNKNOWN;
    }
  }

  private checkStmt(stmt: Stmt, env: TypeEnv): void {
    switch (stmt.kind) {
      case 'LetStmt': {
        const ty = this.checkExpr(stmt.init, env);
        this.checkPatternBinding(stmt.pat, ty, env);
        break;
      }
      case 'LetMutStmt': {
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
      case 'LoopStmt': {
        this.checkExpr(stmt.body, env);
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
}

function isNumeric(t: AxonType): boolean {
  return t.kind === 'Int' || t.kind === 'Float' || t.kind === 'Unknown';
}
function isFloat(t: AxonType): boolean {
  return t.kind === 'Float';
}

export function typeCheck(program: Program): Diagnostic[] {
  return new TypeChecker().check(program);
}
