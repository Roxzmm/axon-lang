import { OpCode, BytecodeFunction, BytecodeProgram, Instruction } from './bytecode';
import { Expr, Stmt, Program } from '../ast';
import { typeCheck } from '../checker';

interface Context {
  constants: any[];
  functions: BytecodeFunction[];
  locals: Map<string, number>;
  localIndices: Map<string, number>;
  depth: number;
  breakLabels: number[];
  continueLabels: number[];
  loopScope?: { breakJumps: number[]; continueJumps: number[] };
}

function emit(code: Instruction[], op: OpCode, arg?: number | string | bigint): void {
  code.push({ op, arg });
}

function emitLoadConst(ctx: Context, value: any): number {
  let idx = ctx.constants.indexOf(value);
  if (idx === -1) {
    idx = ctx.constants.length;
    ctx.constants.push(value);
  }
  return idx;
}

export function compile(expr: any): BytecodeProgram {
  const program: Program = expr.kind === 'Program' ? expr : { kind: 'Program', module: null, items: [], span: { line: 1, col: 1 } };
  
  try {
    const diagnostics = typeCheck(program);
    if (diagnostics.length > 0) {
      const errors = diagnostics.filter((d: any) => d.level === 'error');
      if (errors.length > 0) {
        console.warn(`Type check warnings: ${errors.map((e: any) => `${e.line}:${e.col} ${e.message}`).join(', ')}`);
      }
    }
  } catch (e) {
    console.warn('Type check skipped:', e);
  }

  const ctx: Context = {
    constants: [],
    functions: [],
    locals: new Map(),
    localIndices: new Map(),
    depth: 0,
    breakLabels: [],
    continueLabels: [],
  };
  
  let body: any[] = [];
  const kind = expr.kind || 'Program';
  if (kind === 'Program' || kind === 'ModuleDecl') {
    const main = expr.items.find((i: any) => i.kind === 'FnDecl' && i.name === 'main');
    if (main) {
      body = [...(main.body?.stmts || [])];
      if (main.body?.tail) body.push(main.body.tail);
    } else if (expr.items.length > 0) {
       const first = expr.items[0];
       if (first.kind === 'FnDecl') {
         body = [...(first.body?.stmts || [])];
         if (first.body?.tail) body.push(first.body.tail);
       } else {
         body = [first];
       }
    }
  } else if (kind === 'FnDecl') {
    body = [...(expr.body?.stmts || [])];
    if (expr.body?.tail) body.push(expr.body.tail);
  } else if (expr.body) {
    body = [...(expr.body.stmts || [])];
    if (expr.body.tail) body.push(expr.body.tail);
  } else {
    body = [expr];
  }
  
  const mainFn = compileBlock(ctx, body, () => {});
  mainFn.name = 'main';
  mainFn.arity = 0;
  
  return {
    version: 1,
    constants: ctx.constants,
    functions: ctx.functions,
    main: 0,
  };
}

function compileBlock(ctx: Context, body: any[], onLocal: () => void = () => {}): BytecodeFunction {
  const code: Instruction[] = [];
  const savedLocals = ctx.locals;
  const savedIndices = ctx.localIndices;
  ctx.locals = new Map(savedLocals);
  ctx.localIndices = new Map(savedIndices);
  
  let localCount = 0;
  for (const stmt of body) {
    compileStmt(ctx, code, stmt, () => localCount++);
  }
  emit(code, OpCode.RETURN);
  
  const fn: BytecodeFunction = {
    name: '',
    arity: 0,
    locals: localCount,
    code,
  };
  ctx.functions.push(fn);
  ctx.locals = savedLocals;
  ctx.localIndices = savedIndices;
  return fn;
}

function compileStmt(ctx: Context, code: Instruction[], stmt: any, onLocal: () => void): void {
  if (!stmt || typeof stmt !== 'object') return;
  
  const kind = stmt.kind;
  
  if (kind === 'LetStmt') {
    let idx = -1;
    if (stmt.pat && stmt.pat.kind === 'IdentPat') {
      idx = ctx.localIndices.size;
      ctx.localIndices.set(stmt.pat.name, idx);
      onLocal();
    }
    compileExpr(ctx, code, stmt.init);
    if (idx >= 0) {
      emit(code, OpCode.DUP);
      emit(code, OpCode.STORE_LOCAL, idx);
    }
    return;
  }

  if (kind === 'LetElseStmt') {
    let idx = -1;
    if (stmt.pat && stmt.pat.kind === 'IdentPat') {
      idx = ctx.localIndices.size;
      ctx.localIndices.set(stmt.pat.name, idx);
      onLocal();
    }
    compileExpr(ctx, code, stmt.init);
    const elseStart = code.length;
    emit(code, OpCode.JUMP_IF_FALSE, 0);
    if (idx >= 0) emit(code, OpCode.STORE_LOCAL, idx);
    const afterElse = code.length;
    emit(code, OpCode.JUMP, 0);
    code[elseStart].arg = code.length;
    if (stmt.else_) {
      if (stmt.else_.kind === 'Block') {
        for (const s of stmt.else_.stmts || []) compileStmt(ctx, code, s, onLocal);
        if (stmt.else_.tail) compileExpr(ctx, code, stmt.else_.tail);
      } else {
        compileExpr(ctx, code, stmt.else_);
      }
    }
    code[afterElse].arg = code.length;
    return;
  }
  
  if (kind === 'AssignStmt') {
    // Handle simple assignment: x = value
    if (stmt.target && stmt.target.kind === 'Ident') {
      const idx = ctx.localIndices.get(stmt.target.name);
      if (idx !== undefined) {
        compileExpr(ctx, code, stmt.value);
        emit(code, OpCode.STORE_LOCAL, idx);
        return;
      }
    }
    // Complex assignment - just evaluate value for now
    compileExpr(ctx, code, stmt.value);
    emit(code, OpCode.POP);
    return;
  }

  if (kind === 'ForStmt') {
    const savedBreak = [...ctx.breakLabels];
    const savedContinue = [...ctx.continueLabels];
    const savedLoopScope = ctx.loopScope;
    const loopScope = { breakJumps: [] as number[], continueJumps: [] as number[] };
    ctx.loopScope = loopScope;
    
    const iterVar = ctx.localIndices.size;
    ctx.localIndices.set('_iter', iterVar);
    const idxVar = iterVar + 1;
    ctx.localIndices.set('_idx', idxVar);
    
    compileExpr(ctx, code, stmt.iter);
    emit(code, OpCode.DUP);
    emit(code, OpCode.STORE_LOCAL, iterVar);
    
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, 0n));
    emit(code, OpCode.DUP);
    emit(code, OpCode.STORE_LOCAL, idxVar);
    
    const loopStart = code.length;
    ctx.continueLabels.push(loopStart);
    
    emit(code, OpCode.LOAD_LOCAL, idxVar);
    emit(code, OpCode.LOAD_LOCAL, iterVar);
    emit(code, OpCode.LOAD_GLOBAL, emitLoadConst(ctx, 'len'));
    emit(code, OpCode.CALL, 1);
    emit(code, OpCode.LT);
    const endJump = code.length;
    emit(code, OpCode.JUMP_IF_FALSE, 0);
    
    if (stmt.pat && stmt.pat.kind === 'IdentPat') {
      const patVar = idxVar + 1;
      ctx.localIndices.set(stmt.pat.name, patVar);
      emit(code, OpCode.LOAD_LOCAL, iterVar);
      emit(code, OpCode.LOAD_LOCAL, idxVar);
      emit(code, OpCode.INDEX);
      emit(code, OpCode.DUP);
      emit(code, OpCode.STORE_LOCAL, patVar);
    }
    
    if (stmt.body) {
      if (stmt.body.kind === 'Block') {
        for (const s of stmt.body.stmts || []) compileStmt(ctx, code, s, onLocal);
        if (stmt.body.tail) compileStmt(ctx, code, stmt.body.tail, onLocal);
      } else {
        compileStmt(ctx, code, stmt.body, onLocal);
      }
    }
    
    emit(code, OpCode.LOAD_LOCAL, idxVar);
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, 1n));
    emit(code, OpCode.ADD);
    emit(code, OpCode.STORE_LOCAL, idxVar);
    
    emit(code, OpCode.JUMP, loopStart);
    code[endJump].arg = code.length;
    
    for (const pos of loopScope.breakJumps) {
      code[pos].arg = code.length;
    }
    
    for (const pos of loopScope.continueJumps) {
      code[pos].arg = loopStart;
    }
    
    ctx.breakLabels = savedBreak;
    ctx.continueLabels = savedContinue;
    ctx.loopScope = savedLoopScope;
    return;
  }

  if (kind === 'WhileStmt') {
    const savedBreak = [...ctx.breakLabels];
    const savedContinue = [...ctx.continueLabels];
    const savedLoopScope = ctx.loopScope;
    const loopScope = { breakJumps: [] as number[], continueJumps: [] as number[] };
    ctx.loopScope = loopScope;
    
    const start = code.length;
    ctx.continueLabels.push(start);
    
    compileExpr(ctx, code, stmt.cond);
    const endJump = code.length;
    emit(code, OpCode.JUMP_IF_FALSE, 0);
    
    if (stmt.body) {
      if (stmt.body.kind === 'Block') {
        for (const s of stmt.body.stmts || []) compileStmt(ctx, code, s, onLocal);
        if (stmt.body.tail) compileStmt(ctx, code, stmt.body.tail, onLocal);
      } else {
        compileStmt(ctx, code, stmt.body, onLocal);
      }
    }
    
    emit(code, OpCode.JUMP, start);
    code[endJump].arg = code.length;
    
    for (const pos of loopScope.breakJumps) {
      code[pos].arg = code.length;
    }
    
    for (const pos of loopScope.continueJumps) {
      code[pos].arg = start;
    }
    
    ctx.breakLabels = savedBreak;
    ctx.continueLabels = savedContinue;
    ctx.loopScope = savedLoopScope;
    return;
  }
  
  if (kind === 'ExprStmt') {
    if (stmt.expr && stmt.expr.kind && ['Break', 'Continue', 'Return'].includes(stmt.expr.kind)) {
      compileStmt(ctx, code, stmt.expr, onLocal);
    } else {
      compileExpr(ctx, code, stmt.expr);
    }
    return;
  }
  
  if (kind === 'Return') {
    if (stmt.value) compileExpr(ctx, code, stmt.value);
    else emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, null));
    emit(code, OpCode.RETURN);
    return;
  }

  if (kind === 'Break') {
    if (ctx.loopScope) {
      ctx.loopScope.breakJumps.push(code.length);
    }
    emit(code, OpCode.JUMP, 0);
    return;
  }

  if (kind === 'Continue') {
    if (ctx.loopScope) {
      ctx.loopScope.continueJumps.push(code.length);
    }
    emit(code, OpCode.JUMP, 0);
    return;
  }
  
  if (kind === 'If') {
    compileExpr(ctx, code, stmt.cond);
    const elseLabel = code.length;
    emit(code, OpCode.JUMP_IF_FALSE, 0);
    
    if (stmt.then) {
      if (stmt.then.kind === 'Block') {
        for (const s of stmt.then.stmts || []) compileStmt(ctx, code, s, onLocal);
        if (stmt.then.tail) compileStmt(ctx, code, stmt.then.tail, onLocal);
      } else {
        compileStmt(ctx, code, stmt.then, onLocal);
      }
    }
    const endLabel = code.length;
    emit(code, OpCode.JUMP, 0);
    code[elseLabel].arg = code.length;
    if (stmt.else) {
      if (stmt.else.kind === 'Block') {
        for (const s of stmt.else.stmts || []) compileStmt(ctx, code, s, onLocal);
        if (stmt.else.tail) compileExpr(ctx, code, stmt.else.tail);
      } else if (stmt.else.kind === 'If') {
        compileStmt(ctx, code, stmt.else, onLocal);
      } else {
        compileExpr(ctx, code, stmt.else);
      }
    }
    code[endLabel].arg = code.length;
    return;
  }
  
  if (kind === 'Loop') {
    const start = code.length;
    if (stmt.body) {
      if (stmt.body.kind === 'Block') {
        for (const s of stmt.body.stmts || []) compileStmt(ctx, code, s, onLocal);
        if (stmt.body.tail) compileExpr(ctx, code, stmt.body.tail);
      } else {
        compileStmt(ctx, code, stmt.body, onLocal);
      }
    }
    emit(code, OpCode.JUMP, start);
    return;
  }
  
  if (kind === 'Call') {
    compileExpr(ctx, code, stmt);
    emit(code, OpCode.POP);
    return;
  }

  if (kind === 'Match') {
    compileExpr(ctx, code, stmt.scrutinee);
    return;
  }
  
  // Default: try to compile as expression
  compileExpr(ctx, code, stmt);
}

function compileExpr(ctx: Context, code: Instruction[], expr: any): void {
  if (!expr || typeof expr !== 'object') {
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, expr));
    return;
  }
  
  const kind = expr.kind;
  
  if (kind === 'IntLit' || kind === 'FloatLit' || kind === 'StringLit' || kind === 'BoolLit' || kind === 'CharLit' || kind === 'UnitLit') {
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, expr.value));
    return;
  }
  
  if (kind === 'Ident') {
    const idx = ctx.localIndices.get(expr.name);
    if (idx !== undefined) {
      emit(code, OpCode.LOAD_LOCAL, idx);
    } else {
      emit(code, OpCode.LOAD_GLOBAL, emitLoadConst(ctx, expr.name));
    }
    return;
  }
  
  if (kind === 'Binary') {
    compileExpr(ctx, code, expr.left);
    compileExpr(ctx, code, expr.right);
    const ops: Record<string, OpCode> = {
      '+': OpCode.ADD, '-': OpCode.SUB, '*': OpCode.MUL, '/': OpCode.DIV, '%': OpCode.MOD,
      '==': OpCode.EQ, '!=': OpCode.NE, '<': OpCode.LT, '<=': OpCode.LE, '>': OpCode.GT, '>=': OpCode.GE,
      '&&': OpCode.AND, '||': OpCode.OR,
    };
    emit(code, ops[expr.op] ?? OpCode.ADD);
    return;
  }
  
  if (kind === 'Unary') {
    compileExpr(ctx, code, expr.arg);
    if (expr.op === '-') emit(code, OpCode.NEG);
    else if (expr.op === '!') emit(code, OpCode.NOT);
    return;
  }
  
  if (kind === 'Call') {
    for (const arg of expr.args || []) compileExpr(ctx, code, arg.value);
    compileExpr(ctx, code, expr.callee);
    emit(code, OpCode.CALL, (expr.args || []).length);
    return;
  }

  if (kind === 'Lambda') {
    const params = expr.params || [];
    const body = expr.body;
    const fnIdx = ctx.functions.length;
    const innerCtx: Context = {
      ...ctx,
      locals: new Map(),
      localIndices: new Map(),
      depth: ctx.depth + 1,
    };
    let localCount = 0;
    for (const p of params) {
      const name = p.name || (p.pat?.kind === 'IdentPat' ? p.pat.name : 'arg');
      innerCtx.localIndices.set(name, localCount++);
    }
    const innerCode: Instruction[] = [];
    if (body.kind === 'Block') {
      for (const s of body.stmts || []) {
        compileStmt(innerCtx, innerCode, s, () => {});
      }
      if (body.tail) compileExpr(innerCtx, innerCode, body.tail);
    } else {
      compileExpr(innerCtx, innerCode, body);
    }
    emit(innerCode, OpCode.RETURN);
    const closure: BytecodeFunction = {
      name: 'lambda',
      arity: params.length,
      locals: localCount,
      code: innerCode,
    };
    ctx.functions.push(closure);
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, fnIdx));
    return;
  }
  
  if (kind === 'List') {
    emit(code, OpCode.LIST_NEW);
    for (const el of expr.elems || []) {
      compileExpr(ctx, code, el);
      emit(code, OpCode.LIST_APPEND);
    }
    return;
  }

  if (kind === 'Tuple') {
    emit(code, OpCode.LIST_NEW);
    for (const el of expr.elems || []) {
      compileExpr(ctx, code, el);
      emit(code, OpCode.LIST_APPEND);
    }
    return;
  }

  if (kind === 'Index') {
    compileExpr(ctx, code, expr.obj);
    compileExpr(ctx, code, expr.index);
    emit(code, OpCode.INDEX);
    return;
  }

  if (kind === 'Record') {
    for (const [k, v] of Object.entries(expr.fields || {})) {
      compileExpr(ctx, code, v);
    }
    emit(code, OpCode.RECORD_NEW, Object.keys(expr.fields || {}).length);
    return;
  }
  
  if (kind === 'If') {
    compileExpr(ctx, code, expr.cond);
    const elseLabel = code.length;
    emit(code, OpCode.JUMP_IF_FALSE, 0);
    compileExpr(ctx, code, expr.then);
    const endLabel = code.length;
    emit(code, OpCode.JUMP, 0);
    code[elseLabel].arg = code.length;
    if (expr.else) compileExpr(ctx, code, expr.else);
    code[endLabel].arg = code.length;
    return;
  }

  if (kind === 'Match') {
    compileExpr(ctx, code, expr.scrutinee);
    const endJumps: number[] = [];
    for (const arm of expr.arms || []) {
      const armStart = code.length;
      if (arm.pattern && arm.pattern.kind === 'LitPat') {
        compileExpr(ctx, code, expr.scrutinee);
        compileExpr(ctx, code, arm.pattern.value);
        emit(code, OpCode.EQ);
        const skipArm = code.length;
        emit(code, OpCode.JUMP_IF_FALSE, 0);
        compileExpr(ctx, code, arm.body);
        endJumps.push(code.length);
        emit(code, OpCode.JUMP, 0);
        code[skipArm].arg = code.length;
      } else if (arm.pattern && arm.pattern.kind === 'RangePat') {
        compileExpr(ctx, code, expr.scrutinee);
        compileExpr(ctx, code, arm.pattern.lo);
        emit(code, OpCode.GE);
        const checkLo = code.length;
        emit(code, OpCode.JUMP_IF_FALSE, 0);
        compileExpr(ctx, code, expr.scrutinee);
        compileExpr(ctx, code, arm.pattern.hi);
        emit(code, arm.pattern.inclusive ? OpCode.LE : OpCode.LT);
        const skipArm = code.length;
        emit(code, OpCode.JUMP_IF_FALSE, 0);
        compileExpr(ctx, code, arm.body);
        endJumps.push(code.length);
        emit(code, OpCode.JUMP, 0);
        code[checkLo].arg = code.length;
        code[skipArm].arg = code.length;
      } else if (arm.pattern && arm.pattern.kind === 'IdentPat') {
        if (arm.pattern.name !== '_') {
          const idx = ctx.localIndices.size;
          ctx.localIndices.set(arm.pattern.name, idx);
        }
        compileExpr(ctx, code, arm.body);
      } else if (arm.pattern && arm.pattern.kind === 'WildPat') {
        compileExpr(ctx, code, arm.body);
      } else {
        compileExpr(ctx, code, arm.body);
      }
    }
    for (const jmp of endJumps) {
      code[jmp].arg = code.length;
    }
    return;
  }

  if (kind === 'Spawn') {
    if (expr.initMsg) compileExpr(ctx, code, expr.initMsg);
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, { __spawn: expr.agentName }));
    return;
  }

  if (kind === 'MethodCall' && (expr.method === 'send' || expr.method === 'ask')) {
    compileExpr(ctx, code, expr.obj);
    for (const arg of expr.args || []) {
      compileExpr(ctx, code, arg.value);
    }
    emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, { __method: expr.method }));
    return;
  }
  
  emit(code, OpCode.LOAD_CONST, emitLoadConst(ctx, null));
}
