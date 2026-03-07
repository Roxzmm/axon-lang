// ============================================================
// Axon Language — Code Formatter
// ============================================================

import * as AST from './ast';

const INDENT = '  '; // 2 spaces

export function formatProgram(prog: AST.Program): string {
  const parts: string[] = [];

  if (prog.module) {
    parts.push(formatModuleDecl(prog.module));
    parts.push('');
  }

  for (let i = 0; i < prog.items.length; i++) {
    const item = prog.items[i];
    parts.push(formatTopLevel(item));
    // Add blank line between top-level items
    if (i < prog.items.length - 1) {
      parts.push('');
    }
  }

  return parts.join('\n') + '\n';
}

function formatModuleDecl(decl: AST.ModuleDecl): string {
  const hot = decl.hot ? ' hot' : '';
  return `module ${decl.path.join('.')}${hot};`;
}

function formatTopLevel(item: AST.TopLevel): string {
  switch (item.kind) {
    case 'ModuleDecl': return formatModuleDecl(item);
    case 'UseDecl':    return formatUseDecl(item);
    case 'FnDecl':     return formatFnDecl(item, 0);
    case 'TypeDecl':   return formatTypeDecl(item);
    case 'AgentDecl':  return formatAgentDecl(item);
    case 'ConstDecl':  return formatConstDecl(item);
    case 'MigrateDecl': return formatMigrateDecl(item);
    case 'ImplDecl':   return formatImplDecl(item);
  }
}

function formatUseDecl(decl: AST.UseDecl): string {
  const path = decl.path.join('.');
  if (decl.items) {
    return `use ${path}::{${decl.items.join(', ')}};`;
  } else if (decl.alias) {
    return `use ${path} as ${decl.alias};`;
  } else {
    return `use ${path};`;
  }
}

function formatFnDecl(decl: AST.FnDecl, indent: number): string {
  const ind = INDENT.repeat(indent);
  const parts: string[] = [];

  // Annotations
  for (const annot of decl.annots) {
    parts.push(`${ind}#[${annot}]`);
  }

  // Visibility
  const vis = decl.vis === 'pub' ? 'pub ' : '';

  // Type parameters
  const typeParams = decl.typeParams.length > 0 ? `<${decl.typeParams.join(', ')}>` : '';

  // Parameters
  const params = decl.params.map(p => formatParam(p)).join(', ');

  // Return type
  const retTy = decl.retTy ? ` -> ${formatType(decl.retTy)}` : '';

  // Effects
  const effects = decl.effectsExplicit && decl.effects.length > 0
    ? ` | ${decl.effects.join(' + ')}`
    : '';

  // Body
  if (decl.body) {
    const body = formatExpr(decl.body, indent);
    parts.push(`${ind}${vis}fn ${decl.name}${typeParams}(${params})${retTy}${effects} = ${body}`);
  } else {
    parts.push(`${ind}${vis}fn ${decl.name}${typeParams}(${params})${retTy}${effects};`);
  }

  return parts.join('\n');
}

function formatParam(param: AST.Param): string {
  if (param.pat) {
    const pat = formatPattern(param.pat);
    const ty = param.ty ? `: ${formatType(param.ty)}` : '';
    const def = param.default_ ? ` = ${formatExpr(param.default_, 0)}` : '';
    return `${pat}${ty}${def}`;
  } else {
    const ty = param.ty ? `: ${formatType(param.ty)}` : '';
    const def = param.default_ ? ` = ${formatExpr(param.default_, 0)}` : '';
    return `${param.name}${ty}${def}`;
  }
}

function formatTypeDecl(decl: AST.TypeDecl): string {
  const vis = decl.vis === 'pub' ? 'pub ' : '';
  const typeParams = decl.typeParams.length > 0 ? `<${decl.typeParams.join(', ')}>` : '';

  switch (decl.def.kind) {
    case 'Record': {
      const fields = decl.def.fields.map(f => {
        const ty = formatType(f.ty);
        const def = f.default_ ? ` = ${formatExpr(f.default_, 0)}` : '';
        return `  ${f.name}: ${ty}${def}`;
      }).join(',\n');
      return `${vis}type ${decl.name}${typeParams} = {\n${fields}\n}`;
    }
    case 'Enum': {
      const variants = decl.def.variants.map(v => {
        if (v.fields.length === 0) {
          return `  ${v.name}`;
        } else if (v.fields[0].kind === 'Tuple') {
          const types = v.fields[0].types.map(t => formatType(t)).join(', ');
          return `  ${v.name}(${types})`;
        } else {
          const fields = v.fields[0].fields.map(f => `${f.name}: ${formatType(f.ty)}`).join(', ');
          return `  ${v.name} { ${fields} }`;
        }
      }).join(',\n');
      return `${vis}type ${decl.name}${typeParams} =\n${variants}`;
    }
    case 'Alias':
      return `${vis}type ${decl.name}${typeParams} = ${formatType(decl.def.ty)};`;
    case 'Refine':
      return `${vis}type ${decl.name}${typeParams} = ${formatType(decl.def.base)} where ${formatExpr(decl.def.pred, 0)};`;
  }
}

function formatAgentDecl(decl: AST.AgentDecl): string {
  const parts: string[] = [];

  // Annotations
  for (const annot of decl.annots) {
    parts.push(`#[${annot}]`);
  }

  const vis = decl.vis === 'pub' ? 'pub ' : '';
  const requires = decl.requires.length > 0 ? ` requires ${decl.requires.join(', ')}` : '';

  parts.push(`${vis}agent ${decl.name}${requires} {`);

  // State fields
  if (decl.stateFields.length > 0) {
    parts.push('  state {');
    for (const field of decl.stateFields) {
      const ty = field.ty ? `: ${formatType(field.ty)}` : '';
      const init = formatExpr(field.default_, 2);
      parts.push(`    ${field.name}${ty} = ${init},`);
    }
    parts.push('  }');
    parts.push('');
  }

  // Handlers
  for (let i = 0; i < decl.handlers.length; i++) {
    const h = decl.handlers[i];
    const params = h.params.map(p => formatParam(p)).join(', ');
    const retTy = h.retTy ? ` -> ${formatType(h.retTy)}` : '';
    const effects = h.effectsExplicit && h.effects.length > 0
      ? ` | ${h.effects.join(' + ')}`
      : '';
    const body = formatExpr(h.body, 2);
    parts.push(`  on ${h.msgType}(${params})${retTy}${effects} = ${body}`);
    if (i < decl.handlers.length - 1) {
      parts.push('');
    }
  }

  parts.push('}');
  return parts.join('\n');
}

function formatConstDecl(decl: AST.ConstDecl): string {
  const ty = decl.ty ? `: ${formatType(decl.ty)}` : '';
  const value = formatExpr(decl.value, 0);
  return `const ${decl.name}${ty} = ${value};`;
}

function formatMigrateDecl(decl: AST.MigrateDecl): string {
  const agent = decl.agentPath.join('.');
  const from = decl.fromFields.map(f => `${f.name}: ${formatType(f.ty)}`).join(', ');
  const to = decl.toFields.map(f => `${f.name}: ${formatType(f.ty)}`).join(', ');
  const transform = formatExpr(decl.transform, 0);
  return `migrate ${agent} from { ${from} } to { ${to} } via ${transform};`;
}

function formatImplDecl(decl: AST.ImplDecl): string {
  const parts: string[] = [];
  parts.push(`impl ${decl.typeName} {`);
  for (let i = 0; i < decl.methods.length; i++) {
    parts.push(formatFnDecl(decl.methods[i], 1));
    if (i < decl.methods.length - 1) {
      parts.push('');
    }
  }
  parts.push('}');
  return parts.join('\n');
}

function formatExpr(expr: AST.Expr, indent: number): string {
  const ind = INDENT.repeat(indent);

  switch (expr.kind) {
    case 'IntLit':    return String(expr.value);
    case 'FloatLit':  return String(expr.value);
    case 'BoolLit':   return String(expr.value);
    case 'StringLit': return `"${expr.value}"`;
    case 'CharLit':   return `'${expr.value}'`;
    case 'UnitLit':   return '()';
    case 'Ident':     return expr.name;

    case 'Block': {
      if (expr.stmts.length === 0 && !expr.tail) {
        return '{}';
      }
      const parts: string[] = ['{'];
      for (const stmt of expr.stmts) {
        parts.push(INDENT.repeat(indent + 1) + formatStmt(stmt, indent + 1));
      }
      if (expr.tail) {
        parts.push(INDENT.repeat(indent + 1) + formatExpr(expr.tail, indent + 1));
      }
      parts.push(ind + '}');
      return parts.join('\n');
    }

    case 'If': {
      const cond = formatExpr(expr.cond, indent);
      const then = formatExpr(expr.then, indent);
      if (expr.else_) {
        const else_ = formatExpr(expr.else_, indent);
        return `if ${cond} ${then} else ${else_}`;
      } else {
        return `if ${cond} ${then}`;
      }
    }

    case 'Match': {
      const scrut = formatExpr(expr.scrutinee, indent);
      const arms = expr.arms.map(arm => {
        const pat = formatPattern(arm.pattern);
        const guard = arm.guard ? ` if ${formatExpr(arm.guard, 0)}` : '';
        const body = formatExpr(arm.body, indent + 1);
        return `${INDENT.repeat(indent + 1)}${pat}${guard} => ${body}`;
      }).join(',\n');
      return `match ${scrut} {\n${arms}\n${ind}}`;
    }

    case 'Call': {
      const callee = formatExpr(expr.callee, indent);
      const args = expr.args.map(a => {
        const name = a.name ? `${a.name}: ` : '';
        return `${name}${formatExpr(a.value, indent)}`;
      }).join(', ');
      return `${callee}(${args})`;
    }

    case 'MethodCall': {
      const obj = formatExpr(expr.obj, indent);
      const args = expr.args.map(a => {
        const name = a.name ? `${a.name}: ` : '';
        return `${name}${formatExpr(a.value, indent)}`;
      }).join(', ');
      return `${obj}.${expr.method}(${args})`;
    }

    case 'FieldAccess':
      return `${formatExpr(expr.obj, indent)}.${expr.field}`;

    case 'Index':
      return `${formatExpr(expr.obj, indent)}[${formatExpr(expr.index, indent)}]`;

    case 'Unary':
      return `${expr.op}${formatExpr(expr.expr, indent)}`;

    case 'Binary':
      return `${formatExpr(expr.left, indent)} ${expr.op} ${formatExpr(expr.right, indent)}`;

    case 'Pipe':
      return `${formatExpr(expr.left, indent)} |> ${formatExpr(expr.right, indent)}`;

    case 'Lambda': {
      const params = expr.params.map(p => formatParam(p)).join(', ');
      return `|${params}| ${formatExpr(expr.body, indent)}`;
    }

    case 'List': {
      const elems = expr.elems.map(e => formatExpr(e, indent)).join(', ');
      if (expr.spread) {
        return `[${elems}, ...${formatExpr(expr.spread, indent)}]`;
      }
      return `[${elems}]`;
    }

    case 'Tuple':
      return `(${expr.elems.map(e => formatExpr(e, indent)).join(', ')})`;

    case 'Record': {
      const typeName = expr.typeName ? `${expr.typeName} ` : '';
      const fields = expr.fields.map(f => `${f.name}: ${formatExpr(f.value, indent)}`).join(', ');
      return `${typeName}{ ${fields} }`;
    }

    case 'RecordUpdate': {
      const base = formatExpr(expr.base, indent);
      const fields = expr.fields.map(f => `${f.name}: ${formatExpr(f.value, indent)}`).join(', ');
      return `{ ${base} with ${fields} }`;
    }

    case 'Try':
      return `${formatExpr(expr.expr, indent)}?`;

    case 'Force':
      return `${formatExpr(expr.expr, indent)}!`;

    case 'Await':
      return `await ${formatExpr(expr.expr, indent)}`;

    case 'Spawn': {
      const init = expr.initMsg ? formatExpr(expr.initMsg, indent) : '';
      const timeout = expr.timeout ? `, timeout: ${formatExpr(expr.timeout, indent)}` : '';
      const caps = expr.caps ? `, caps: [${expr.caps.join(', ')}]` : '';
      return `spawn ${expr.agentName}(${init}${timeout}${caps})`;
    }

    case 'Return':
      return expr.value ? `return ${formatExpr(expr.value, indent)}` : 'return';

    case 'Break':
      return expr.value ? `break ${formatExpr(expr.value, indent)}` : 'break';

    case 'Continue':
      return 'continue';

    case 'TypeAscription':
      return `${formatExpr(expr.expr, indent)}: ${formatType(expr.ty)}`;

    case 'EnumVariant': {
      // Omit type name for common variants that can be inferred (Ok, Err, Some, None)
      const inferrable = ['Ok', 'Err', 'Some', 'None'].includes(expr.variant);
      const prefix = (expr.typeName && !inferrable) ? `${expr.typeName}::` : '';

      if (Array.isArray(expr.fields) && expr.fields.length > 0 && 'kind' in expr.fields[0]) {
        // Tuple variant
        const fields = (expr.fields as AST.Expr[]).map(f => formatExpr(f, indent)).join(', ');
        return `${prefix}${expr.variant}(${fields})`;
      } else if (Array.isArray(expr.fields) && expr.fields.length > 0) {
        // Record variant
        const fields = (expr.fields as { name: string; value: AST.Expr }[])
          .map(f => `${f.name}: ${formatExpr(f.value, indent)}`).join(', ');
        return `${prefix}${expr.variant} { ${fields} }`;
      } else {
        // Unit variant
        return `${prefix}${expr.variant}`;
      }
    }

    case 'Loop':
      return `loop ${formatExpr(expr.body, indent)}`;

    case 'Range': {
      const op = expr.inclusive ? '..=' : '..';
      return `${formatExpr(expr.lo, indent)}${op}${formatExpr(expr.hi, indent)}`;
    }

    case 'IfLet': {
      const pat = formatPattern(expr.pat);
      const value = formatExpr(expr.value, indent);
      const then = formatExpr(expr.then, indent);
      if (expr.else_) {
        return `if let ${pat} = ${value} ${then} else ${formatExpr(expr.else_, indent)}`;
      }
      return `if let ${pat} = ${value} ${then}`;
    }

    case 'HandleExpr': {
      const handlers = expr.handlers.map(h => {
        return `${INDENT.repeat(indent + 1)}${h.name} => ${formatExpr(h.handler, indent + 1)}`;
      }).join(',\n');
      return `handle ${expr.effect} {\n${handlers}\n${ind}} in ${formatExpr(expr.body, indent)}`;
    }
  }
}

function formatStmt(stmt: AST.Stmt, indent: number): string {
  switch (stmt.kind) {
    case 'LetStmt': {
      const pat = formatPattern(stmt.pat);
      const ty = stmt.ty ? `: ${formatType(stmt.ty)}` : '';
      return `let ${pat}${ty} = ${formatExpr(stmt.init, indent)};`;
    }

    case 'LetElseStmt': {
      const pat = formatPattern(stmt.pat);
      const ty = stmt.ty ? `: ${formatType(stmt.ty)}` : '';
      return `let ${pat}${ty} = ${formatExpr(stmt.init, indent)} else ${formatExpr(stmt.else_, indent)};`;
    }

    case 'LetMutStmt': {
      const ty = stmt.ty ? `: ${formatType(stmt.ty)}` : '';
      return `let mut ${stmt.name}${ty} = ${formatExpr(stmt.init, indent)};`;
    }

    case 'AssignStmt':
      return `${formatExpr(stmt.target, indent)} ${stmt.op} ${formatExpr(stmt.value, indent)};`;

    case 'ExprStmt':
      return `${formatExpr(stmt.expr, indent)};`;

    case 'ForStmt':
      return `for ${formatPattern(stmt.pat)} in ${formatExpr(stmt.iter, indent)} ${formatExpr(stmt.body, indent)}`;

    case 'WhileStmt':
      return `while ${formatExpr(stmt.cond, indent)} ${formatExpr(stmt.body, indent)}`;

    case 'WhileLetStmt':
      return `while let ${formatPattern(stmt.pat)} = ${formatExpr(stmt.value, indent)} ${formatExpr(stmt.body, indent)}`;
  }
}

function formatPattern(pat: AST.Pattern): string {
  switch (pat.kind) {
    case 'WildPat':
      return '_';

    case 'IdentPat':
      return pat.name;

    case 'LitPat':
      return formatExpr(pat.value, 0);

    case 'TuplePat':
      return `(${pat.elems.map(p => formatPattern(p)).join(', ')})`;

    case 'ListPat': {
      const head = pat.head.map(p => formatPattern(p)).join(', ');
      return pat.tail ? `[${head}, ...${pat.tail}]` : `[${head}]`;
    }

    case 'RecordPat': {
      const typeName = pat.typeName ? `${pat.typeName} ` : '';
      const fields = pat.fields.map(f => {
        if (f.pat.kind === 'IdentPat' && f.pat.name === f.name) {
          return f.name;
        }
        return `${f.name}: ${formatPattern(f.pat)}`;
      }).join(', ');
      const rest = pat.rest ? ', ..' : '';
      return `${typeName}{ ${fields}${rest} }`;
    }

    case 'EnumPat': {
      // Omit type name for common variants that can be inferred (Ok, Err, Some, None)
      const inferrable = ['Ok', 'Err', 'Some', 'None'].includes(pat.variant);
      const prefix = (pat.typeName && !inferrable) ? `${pat.typeName}::` : '';

      if (pat.fields.length > 0) {
        const fields = pat.fields.map(p => formatPattern(p)).join(', ');
        return `${prefix}${pat.variant}(${fields})`;
      } else if (pat.recordFields.length > 0) {
        const fields = pat.recordFields.map(f => {
          if (f.pat.kind === 'IdentPat' && f.pat.name === f.name) {
            return f.name;
          }
          return `${f.name}: ${formatPattern(f.pat)}`;
        }).join(', ');
        return `${prefix}${pat.variant} { ${fields} }`;
      }
      return `${prefix}${pat.variant}`;
    }

    case 'OrPat':
      return `${formatPattern(pat.left)} | ${formatPattern(pat.right)}`;

    case 'BindPat':
      return `${pat.name} @ ${formatPattern(pat.inner)}`;

    case 'RangePat': {
      const op = pat.inclusive ? '..=' : '..';
      return `${formatExpr(pat.lo, 0)}${op}${formatExpr(pat.hi, 0)}`;
    }
  }
}

function formatType(ty: AST.TypeExpr): string {
  switch (ty.kind) {
    case 'NameType': {
      const params = ty.params.length > 0 ? `<${ty.params.map(p => formatType(p)).join(', ')}>` : '';
      return `${ty.name}${params}`;
    }

    case 'TupleType':
      return `(${ty.elems.map(e => formatType(e)).join(', ')})`;

    case 'FnType': {
      const params = ty.params.map(p => formatType(p)).join(', ');
      const effects = ty.effects.length > 0 ? ` | ${ty.effects.join(' + ')}` : '';
      return `(${params}) -> ${formatType(ty.ret)}${effects}`;
    }

    case 'RefineType':
      return `${formatType(ty.base)} where ${ty.pred}`;

    case 'UnitType':
      return '()';

    case 'NeverType':
      return '!';

    case 'InferType':
      return '_';
  }
}
