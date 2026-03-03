// ============================================================
// Axon Language — Recursive Descent Parser
// ============================================================

import { Token, TokenKind, Lexer } from './lexer';
import type {
  Program, TopLevel, ModuleDecl, UseDecl, FnDecl, TypeDecl, AgentDecl,
  ConstDecl, MigrateDecl, ImplDecl, TypeExpr, Pattern, Expr, Stmt, Param,
  LitExpr, MatchArm, CallArg, TypeDef, TypeVariant, StateField,
  AgentHandler, Span, TypeVariantField,
} from './ast';

export class ParseError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(`Parse error at ${line}:${col}: ${msg}`);
    this.name = 'ParseError';
  }
}

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(src: string, file = '<input>') {
    this.tokens = new Lexer(src, file).tokenize();
  }

  // ── Entry ───────────────────────────────────────────────

  parse(): Program {
    const span = this.span();
    let module_: ModuleDecl | null = null;
    const items: TopLevel[] = [];

    // Optional module declaration
    if (this.check(TokenKind.KwModule)) {
      module_ = this.parseModuleDecl();
    }

    while (!this.check(TokenKind.EOF)) {
      // Skip stray semicolons
      while (this.check(TokenKind.Semicolon)) this.advance();
      if (this.check(TokenKind.EOF)) break;
      items.push(this.parseTopLevel());
    }

    return { module: module_, items, span };
  }

  // ── Top-level ───────────────────────────────────────────

  private parseModuleDecl(): ModuleDecl {
    const span = this.span();
    this.expect(TokenKind.KwModule);
    const path = this.parseModulePath();
    return { kind: 'ModuleDecl', path, hot: false, span };
  }

  private parseTopLevel(): TopLevel {
    const annots = this.parseAnnotations();
    const hot    = annots.some(a => a === 'hot');

    // Visibility
    let vis: 'pub' | 'priv' | 'internal' = 'priv';
    if (this.check(TokenKind.KwPub))  { this.advance(); vis = 'pub'; }

    if (this.check(TokenKind.KwFn))     return this.parseFnDecl(vis, annots);
    if (this.check(TokenKind.KwType))   return this.parseTypeDecl(vis);
    if (this.check(TokenKind.KwAgent))  return this.parseAgentDecl(vis, annots);
    if (this.check(TokenKind.KwConst))  return this.parseConstDecl();
    if (this.check(TokenKind.KwUse))    return this.parseUseDecl();
    if (this.check(TokenKind.KwMigrate)) return this.parseMigrateDecl();
    if (this.check(TokenKind.KwModule)) return this.parseModuleDecl();
    if (this.check(TokenKind.KwImpl))   return this.parseImplDecl();

    throw this.error(`Unexpected token at top level: ${this.cur().value}`);
  }

  private parseAnnotations(): string[] {
    const annots: string[] = [];
    while (this.check(TokenKind.Hash)) {
      this.advance();
      this.expect(TokenKind.LBracket);
      const name = this.expectIdent();
      // Optional annotation arguments — capture first string arg if present
      let fullAnnot = name;
      if (this.check(TokenKind.LParen)) {
        this.advance();
        const argParts: string[] = [];
        let depth = 1;
        while (!this.check(TokenKind.EOF) && depth > 0) {
          const tok = this.cur();
          if (tok.kind === TokenKind.LParen) depth++;
          if (tok.kind === TokenKind.RParen) { depth--; if (depth === 0) break; }
          // For string tokens, reconstruct with quotes
          if (tok.kind === TokenKind.StringLit || tok.kind === TokenKind.InterpolatedStringLit) {
            argParts.push(`"${tok.value}"`);
          } else {
            argParts.push(tok.value);
          }
          this.advance();
        }
        this.expect(TokenKind.RParen);
        fullAnnot = `${name}(${argParts.join('')})`;
      }
      this.expect(TokenKind.RBracket);
      annots.push(fullAnnot);
    }
    return annots;
  }

  // ── Function ────────────────────────────────────────────

  private parseFnDecl(vis: 'pub' | 'priv' | 'internal', annots: string[]): FnDecl {
    const span = this.span();
    this.expect(TokenKind.KwFn);
    const name = this.expectIdent();

    // Type params
    const typeParams: string[] = [];
    if (this.check(TokenKind.Lt)) {
      this.advance();
      while (!this.check(TokenKind.Gt) && !this.check(TokenKind.EOF)) {
        typeParams.push(this.expectIdent());
        if (this.check(TokenKind.Colon)) {
          this.advance();
          // Skip trait bound
          while (!this.check(TokenKind.Comma) && !this.check(TokenKind.Gt)) this.advance();
        }
        if (!this.check(TokenKind.Gt)) this.expect(TokenKind.Comma);
      }
      this.expect(TokenKind.Gt);
    }

    // Params
    this.expect(TokenKind.LParen);
    const params = this.parseParamList();
    this.expect(TokenKind.RParen);

    // Return type
    let retTy: TypeExpr | null = null;
    if (this.check(TokenKind.Arrow)) {
      this.advance();
      retTy = this.parseType();
    }

    // Effects
    const effects: string[] = [];
    let effectsExplicit = false;
    if (this.check(TokenKind.Bar)) {
      this.advance();
      effectsExplicit = true;
      effects.push(this.expectIdent());
      while (this.check(TokenKind.Comma)) {
        this.advance();
        effects.push(this.expectIdent());
      }
    }

    // Body
    let body: Expr | null = null;
    if (this.check(TokenKind.Assign)) {
      this.advance();
      body = this.parseExpr();
    } else if (this.check(TokenKind.LBrace)) {
      body = this.parseBlock();
    }

    return { kind: 'FnDecl', vis, name, typeParams, params, retTy, effects, effectsExplicit, body, annots, span };
  }

  private parseParamList(): Param[] {
    const params: Param[] = [];
    while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
      params.push(this.parseParam());
      if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
    }
    return params;
  }

  private parseParam(): Param {
    const span = this.span();
    const name = this.expectIdent();
    let ty: TypeExpr | null = null;
    if (this.check(TokenKind.Colon)) {
      this.advance();
      ty = this.parseType();
    }
    let default_: Expr | null = null;
    if (this.check(TokenKind.Assign)) {
      this.advance();
      default_ = this.parseExpr();
    }
    return { name, ty, default_, span };
  }

  // ── Type Declaration ─────────────────────────────────────

  private parseTypeDecl(vis: 'pub' | 'priv' | 'internal'): TypeDecl {
    const span = this.span();
    this.expect(TokenKind.KwType);
    const name = this.expectIdent();

    const typeParams: string[] = [];
    if (this.check(TokenKind.Lt)) {
      this.advance();
      while (!this.check(TokenKind.Gt) && !this.check(TokenKind.EOF)) {
        typeParams.push(this.expectIdent());
        if (!this.check(TokenKind.Gt)) this.expect(TokenKind.Comma);
      }
      this.expect(TokenKind.Gt);
    }

    // '=' is optional: both `type Foo = { ... }` and `type Foo { ... }` are valid
    if (this.check(TokenKind.Assign)) this.advance();
    const def = this.parseTypeDef();
    return { kind: 'TypeDecl', vis, name, typeParams, def, span };
  }

  private parseTypeDef(): TypeDef {
    // Braced type: either Record { field: type } or Enum { Variant(...) }
    if (this.check(TokenKind.LBrace)) {
      this.advance();

      // Peek: if first non-empty token is uppercase → Enum body
      if (this.checkIdent() && this.isUpperIdent(this.cur().value)) {
        // Enum body: { Variant | Variant(...) | Variant { ... } }
        const variants: TypeVariant[] = [];
        while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
          if (this.check(TokenKind.Bar)) this.advance(); // optional | separator
          const span = this.span();
          const varName = this.expectIdent();
          let fields: TypeVariantField = { kind: 'Tuple', types: [] };

          if (this.check(TokenKind.LParen)) {
            this.advance();
            const types: TypeExpr[] = [];
            while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
              types.push(this.parseType());
              if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
            }
            this.expect(TokenKind.RParen);
            fields = { kind: 'Tuple', types };
          } else if (this.check(TokenKind.LBrace)) {
            this.advance();
            const recFields: { name: string; ty: TypeExpr }[] = [];
            while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
              const fn_ = this.expectIdent();
              this.expect(TokenKind.Colon);
              const ty = this.parseType();
              recFields.push({ name: fn_, ty });
              if (this.check(TokenKind.Comma) || this.check(TokenKind.Semicolon)) this.advance();
            }
            this.expect(TokenKind.RBrace);
            fields = { kind: 'Record', fields: recFields };
          }

          variants.push({ name: varName, fields: [fields], span });
          if (this.check(TokenKind.Comma)) this.advance(); // optional comma between variants
        }
        this.expect(TokenKind.RBrace);
        return { kind: 'Enum', variants };
      }

      // Record body: { field: type, ... }
      const fields: { name: string; ty: TypeExpr }[] = [];
      while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
        const n = this.expectIdent();
        this.expect(TokenKind.Colon);
        const ty = this.parseType();
        fields.push({ name: n, ty });
        if (this.check(TokenKind.Comma) || this.check(TokenKind.Semicolon)) this.advance();
      }
      this.expect(TokenKind.RBrace);
      return { kind: 'Record', fields };
    }

    // Enum: variants starting with | or bare variant
    // But NOT if the identifier is followed by `where` (alias/refinement) or `<` (generic alias)
    const nextTokKind = this.tokens[this.pos + 1]?.kind;
    const bareIdentIsAlias = nextTokKind === TokenKind.KwWhere || nextTokKind === TokenKind.Lt;
    if (this.check(TokenKind.Bar) || (this.checkIdent() && this.isUpperIdent(this.cur().value) && !bareIdentIsAlias)) {
      const variants: TypeVariant[] = [];
      while (this.check(TokenKind.Bar) || (this.checkIdent() && this.isUpperIdent(this.cur().value))) {
        if (this.check(TokenKind.Bar)) this.advance();
        const span = this.span();
        const varName = this.expectIdent();
        let fields: TypeVariantField = { kind: 'Tuple', types: [] };

        if (this.check(TokenKind.LParen)) {
          this.advance();
          const types: TypeExpr[] = [];
          while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
            types.push(this.parseType());
            if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
          }
          this.expect(TokenKind.RParen);
          fields = { kind: 'Tuple', types };
        } else if (this.check(TokenKind.LBrace)) {
          this.advance();
          const recFields: { name: string; ty: TypeExpr }[] = [];
          while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
            const fn_ = this.expectIdent();
            this.expect(TokenKind.Colon);
            const ty = this.parseType();
            recFields.push({ name: fn_, ty });
            if (this.check(TokenKind.Comma) || this.check(TokenKind.Semicolon)) this.advance();
          }
          this.expect(TokenKind.RBrace);
          fields = { kind: 'Record', fields: recFields };
        }

        variants.push({ name: varName, fields: [fields], span });
      }
      return { kind: 'Enum', variants };
    }

    // Alias or Refinement: `Int` or `Int where self > 0`
    const baseTy = this.parseType();
    if (this.check(TokenKind.KwWhere)) {
      this.advance();
      const pred = this.parseExpr();
      return { kind: 'Refine', base: baseTy, pred };
    }
    return { kind: 'Alias', ty: baseTy };
  }

  // ── Agent Declaration ────────────────────────────────────

  private parseAgentDecl(vis: 'pub' | 'priv' | 'internal', annots: string[]): AgentDecl {
    const span = this.span();
    this.expect(TokenKind.KwAgent);
    const name = this.expectIdent();
    this.expect(TokenKind.LBrace);

    const requires: string[] = [];
    const stateFields: StateField[] = [];
    const handlers: AgentHandler[] = [];

    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.KwRequires)) {
        this.advance();
        requires.push(this.expectIdent());
        while (this.check(TokenKind.Comma)) {
          this.advance();
          requires.push(this.expectIdent());
        }
      } else if (this.check(TokenKind.KwState)) {
        this.advance();
        this.expect(TokenKind.LBrace);
        while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
          const sf = this.parseStateField();
          stateFields.push(sf);
        }
        this.expect(TokenKind.RBrace);
      } else if (this.check(TokenKind.KwOn)) {
        handlers.push(this.parseAgentHandler());
      } else {
        this.advance(); // skip unknown tokens
      }
    }

    this.expect(TokenKind.RBrace);
    return { kind: 'AgentDecl', vis, name, requires, stateFields, handlers, annots, span };
  }

  private parseStateField(): StateField {
    const span = this.span();
    const name = this.expectIdent();
    let ty: TypeExpr | null = null;
    if (this.check(TokenKind.Colon)) {
      this.advance();
      ty = this.parseType();
    }
    this.expect(TokenKind.Assign);
    const default_ = this.parseExpr();
    if (this.check(TokenKind.Comma) || this.check(TokenKind.Semicolon)) this.advance();
    return { name, ty, default_, span };
  }

  private parseAgentHandler(): AgentHandler {
    const span = this.span();
    this.expect(TokenKind.KwOn);
    const msgType = this.expectIdent();

    const params: Param[] = [];
    if (this.check(TokenKind.LParen)) {
      this.advance();
      while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
        params.push(this.parseParam());
        if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
      }
      this.expect(TokenKind.RParen);
    }

    let retTy: TypeExpr | null = null;
    if (this.check(TokenKind.Arrow)) {
      this.advance();
      retTy = this.parseType();
    }

    const effects: string[] = [];
    let effectsExplicit = false;
    if (this.check(TokenKind.Bar)) {
      this.advance();
      effectsExplicit = true;
      effects.push(this.expectIdent());
      while (this.check(TokenKind.Comma)) {
        this.advance();
        effects.push(this.expectIdent());
      }
    }

    let body: Expr;
    if (this.check(TokenKind.Assign)) {
      this.advance();
      body = this.parseExpr();
    } else {
      body = this.parseBlock();
    }

    return { msgType, params, retTy, effects, effectsExplicit, body, span };
  }

  // ── Const Declaration ────────────────────────────────────

  private parseConstDecl(): ConstDecl {
    const span = this.span();
    this.expect(TokenKind.KwConst);
    const name = this.expectIdent();
    let ty: TypeExpr | null = null;
    if (this.check(TokenKind.Colon)) {
      this.advance();
      ty = this.parseType();
    }
    this.expect(TokenKind.Assign);
    const value = this.parseExpr();
    return { kind: 'ConstDecl', name, ty, value, span };
  }

  // ── Use Declaration ─────────────────────────────────────

  private parseUseDecl(): UseDecl {
    const span = this.span();
    this.expect(TokenKind.KwUse);
    const path: string[] = [this.expectIdent()];
    while (this.check(TokenKind.Dot)) {
      this.advance();
      if (this.check(TokenKind.LBrace)) break;
      path.push(this.expectIdent());
    }
    let items: string[] | null = null;
    let alias: string | null = null;
    if (this.check(TokenKind.LBrace)) {
      this.advance();
      items = [];
      while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
        items.push(this.expectIdent());
        if (!this.check(TokenKind.RBrace)) this.expect(TokenKind.Comma);
      }
      this.expect(TokenKind.RBrace);
    } else if (this.check(TokenKind.KwAs)) {
      this.advance();
      alias = this.expectIdent();
    }
    return { kind: 'UseDecl', path, items, alias, span };
  }

  // ── Migrate Declaration ──────────────────────────────────

  private parseMigrateDecl(): MigrateDecl {
    const span = this.span();
    this.expect(TokenKind.KwMigrate);
    const agentPath: string[] = [this.expectIdent()];
    while (this.check(TokenKind.Dot)) {
      this.advance();
      agentPath.push(this.expectIdent());
    }
    this.expect(TokenKind.LBrace);

    // from V1 { ... }
    this.expect(TokenKind.KwFrom);
    this.expectIdent(); // version name
    this.expect(TokenKind.LBrace);
    const fromFields: { name: string; ty: TypeExpr }[] = [];
    while (!this.check(TokenKind.RBrace)) {
      const n = this.expectIdent();
      this.expect(TokenKind.Colon);
      const ty = this.parseType();
      fromFields.push({ name: n, ty });
      if (this.check(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBrace);

    // to V2 { ... }
    this.expect(TokenKind.KwTo);
    this.expectIdent(); // version name
    this.expect(TokenKind.LBrace);
    const toFields: { name: string; ty: TypeExpr }[] = [];
    while (!this.check(TokenKind.RBrace)) {
      const n = this.expectIdent();
      this.expect(TokenKind.Colon);
      const ty = this.parseType();
      toFields.push({ name: n, ty });
      if (this.check(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBrace);

    // with |old| { ... }
    this.expect(TokenKind.KwWith);
    const transform = this.parseLambda();

    this.expect(TokenKind.RBrace);
    return { kind: 'MigrateDecl', agentPath, fromFields, toFields, transform, span };
  }

  private parseImplDecl(): ImplDecl {
    const span = this.span();
    this.expect(TokenKind.KwImpl);
    const typeName = this.expectIdent();
    this.expect(TokenKind.LBrace);
    const methods: FnDecl[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      const annots = this.parseAnnotations();
      let vis: 'pub' | 'priv' | 'internal' = 'priv';
      if (this.check(TokenKind.KwPub)) { this.advance(); vis = 'pub'; }
      methods.push(this.parseFnDecl(vis, annots));
    }
    this.expect(TokenKind.RBrace);
    return { kind: 'ImplDecl', typeName, methods, span };
  }

  // ── Types ───────────────────────────────────────────────

  private parseType(): TypeExpr {
    const span = this.span();
    const base = this.parseBaseType();
    // Function type: BaseType -> RetType  (right-associative)
    if (this.check(TokenKind.Arrow)) {
      this.advance();
      const ret = this.parseType();
      return { kind: 'FnType', params: [base], ret, effects: [], span };
    }
    return base;
  }

  private parseBaseType(): TypeExpr {
    const span = this.span();

    if (this.check(TokenKind.LParen)) {
      this.advance();
      if (this.check(TokenKind.RParen)) {
        this.advance();
        return { kind: 'UnitType', span };
      }
      const first = this.parseType();
      if (this.check(TokenKind.RParen)) {
        this.advance();
        return first;
      }
      // Tuple type
      const elems: TypeExpr[] = [first];
      while (this.check(TokenKind.Comma)) {
        this.advance();
        if (this.check(TokenKind.RParen)) break;
        elems.push(this.parseType());
      }
      this.expect(TokenKind.RParen);
      return { kind: 'TupleType', elems, span };
    }

    if (this.checkIdent()) {
      const name = this.advance().value;
      const params: TypeExpr[] = [];
      if (this.check(TokenKind.Lt)) {
        this.advance();
        while (!this.check(TokenKind.Gt) && !this.check(TokenKind.EOF)) {
          params.push(this.parseType());
          if (!this.check(TokenKind.Gt)) this.expect(TokenKind.Comma);
        }
        this.expect(TokenKind.Gt);
      }
      return { kind: 'NameType', name, params, span };
    }

    if (this.check(TokenKind.KwFn)) {
      return this.parseFnType();
    }

    return { kind: 'InferType', span };
  }

  private parseFnType(): TypeExpr {
    const span = this.span();
    this.expect(TokenKind.KwFn);
    this.expect(TokenKind.LParen);
    const params: TypeExpr[] = [];
    while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
      params.push(this.parseType());
      if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
    }
    this.expect(TokenKind.RParen);
    this.expect(TokenKind.Arrow);
    const ret = this.parseType();
    return { kind: 'FnType', params, ret, effects: [], span };
  }

  // ── Expressions ─────────────────────────────────────────

  private parseExpr(minPrec = 0): Expr {
    return this.parsePipe(minPrec);
  }

  private parsePipe(minPrec: number): Expr {
    let left = this.parseOr();

    while (this.check(TokenKind.Pipe)) {
      const span = this.span();
      this.advance();
      const right = this.parseOr();
      // If right is an identifier, wrap it as a call
      left = { kind: 'Pipe', left, right, span };
    }
    return left;
  }

  private parseBinOp(ops: [TokenKind, string][], next: () => Expr): Expr {
    let left = next();
    while (ops.some(([k]) => this.check(k))) {
      const span = this.span();
      const op = this.advance().value;
      const right = next();
      left = { kind: 'Binary', op, left, right, span };
    }
    return left;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    // '||' is also the zero-arg lambda prefix, so it's only a binary op when on the same line
    while (this.check(TokenKind.Or) && this.tokens[this.pos].line === this.tokens[this.pos - 1]?.line) {
      const span = this.span();
      const op = this.advance().value;
      const right = this.parseAnd();
      left = { kind: 'Binary', op, left, right, span };
    }
    return left;
  }
  private parseAnd():    Expr { return this.parseBinOp([[TokenKind.And, '&&']], () => this.parseEq()); }
  private parseEq():     Expr { return this.parseBinOp([[TokenKind.Eq,'=='],[TokenKind.Neq,'!=']], () => this.parseCmp()); }
  private parseCmp():    Expr { return this.parseBinOp([[TokenKind.Lt,'<'],[TokenKind.Gt,'>'],[TokenKind.Lte,'<='],[TokenKind.Gte,'>=']], () => this.parseAdd()); }
  private parseAdd():    Expr { return this.parseBinOp([[TokenKind.Plus,'+'],[TokenKind.Minus,'-']], () => this.parseMul()); }
  private parseMul():    Expr { return this.parseBinOp([[TokenKind.Star,'*'],[TokenKind.Slash,'/'],[TokenKind.Percent,'%']], () => this.parsePow()); }

  // Right-associative: 2 ** 3 ** 2 = 2 ** (3 ** 2) = 512
  private parsePow(): Expr {
    const left = this.parseUnary();
    if (this.check(TokenKind.Power)) {
      const span = this.span();
      this.advance();
      const right = this.parsePow(); // right-recursive → right-associative
      return { kind: 'Binary', op: '**', left, right, span };
    }
    return left;
  }

  private parseUnary(): Expr {
    const span = this.span();
    if (this.check(TokenKind.Minus)) {
      this.advance();
      return { kind: 'Unary', op: '-', expr: this.parseUnary(), span };
    }
    if (this.check(TokenKind.Not)) {
      this.advance();
      return { kind: 'Unary', op: '!', expr: this.parseUnary(), span };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();

    while (true) {
      const span = this.span();
      // Line of last consumed token — used to prevent cross-line index/call ambiguity
      const prevLine = this.tokens[this.pos - 1]?.line ?? 0;
      const curLine  = span.line;

      // try operator ?
      if (this.check(TokenKind.Question)) {
        this.advance();
        expr = { kind: 'Try', expr, span };
        continue;
      }

      // force operator !!
      if (this.check(TokenKind.Bang)) {
        this.advance();
        expr = { kind: 'Force', expr, span };
        continue;
      }

      // field access / method call (allowed across lines for chaining)
      if (this.check(TokenKind.Dot)) {
        this.advance();
        if (this.checkIdent()) {
          const field = this.advance().value;
          if (this.check(TokenKind.LParen)) {
            this.advance();
            const args = this.parseCallArgs();
            this.expect(TokenKind.RParen);
            expr = { kind: 'MethodCall', obj: expr, method: field, args, typeArgs: [], span };
          } else {
            expr = { kind: 'FieldAccess', obj: expr, field, span };
          }
          continue;
        }
      }

      // index — only on same line as previous token to avoid match arm ambiguity
      if (this.check(TokenKind.LBracket) && curLine === prevLine) {
        this.advance();
        const index = this.parseExpr();
        this.expect(TokenKind.RBracket);
        expr = { kind: 'Index', obj: expr, index, span };
        continue;
      }

      // function call — only on same line as previous token
      if (this.check(TokenKind.LParen) && curLine === prevLine) {
        this.advance();
        const args = this.parseCallArgs();
        this.expect(TokenKind.RParen);
        expr = { kind: 'Call', callee: expr, args, typeArgs: [], span };
        continue;
      }

      // record update: expr with { field: val, ... }
      if (this.check(TokenKind.KwWith) && curLine === prevLine) {
        this.advance();
        this.expect(TokenKind.LBrace);
        const fields: { name: string; value: Expr }[] = [];
        while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
          const fname = this.expectIdent();
          this.expect(TokenKind.Colon);
          const fval = this.parseExpr();
          fields.push({ name: fname, value: fval });
          if (!this.check(TokenKind.RBrace)) this.expect(TokenKind.Comma);
        }
        this.expect(TokenKind.RBrace);
        expr = { kind: 'RecordUpdate', base: expr, fields, span };
        continue;
      }

      // range: expr..hi or expr..=hi — only on same line
      if ((this.check(TokenKind.DotDot) || this.check(TokenKind.DotDotEq)) && curLine === prevLine) {
        const inclusive = this.check(TokenKind.DotDotEq);
        this.advance();
        const hi = this.parsePostfix();
        expr = { kind: 'Range', lo: expr, hi, inclusive, span };
        continue;
      }

      break;
    }

    return expr;
  }

  private parseCallArgs(): CallArg[] {
    const args: CallArg[] = [];
    while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
      // Named arg: name: expr
      if (this.checkIdent() && this.tokens[this.pos + 1]?.kind === TokenKind.Colon) {
        const name = this.advance().value;
        this.advance(); // :
        args.push({ name, value: this.parseExpr() });
      } else {
        args.push({ value: this.parseExpr() });
      }
      if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
    }
    return args;
  }

  private parsePrimary(): Expr {
    const span = this.span();
    const tok  = this.cur();

    // Literals
    if (tok.kind === TokenKind.IntLit) {
      this.advance();
      return { kind: 'IntLit', value: BigInt(tok.value), span };
    }
    if (tok.kind === TokenKind.FloatLit) {
      this.advance();
      return { kind: 'FloatLit', value: parseFloat(tok.value), span };
    }
    if (tok.kind === TokenKind.BoolLit) {
      this.advance();
      return { kind: 'BoolLit', value: tok.value === 'true', span };
    }
    if (tok.kind === TokenKind.StringLit) {
      this.advance();
      return { kind: 'StringLit', value: tok.value, interpolated: false, span };
    }
    if (tok.kind === TokenKind.InterpolatedStringLit) {
      this.advance();
      return { kind: 'StringLit', value: tok.value, interpolated: true, span };
    }
    if (tok.kind === TokenKind.CharLit) {
      this.advance();
      return { kind: 'CharLit', value: tok.value, span };
    }

    // Unit ()
    if (tok.kind === TokenKind.LParen) {
      this.advance();
      if (this.check(TokenKind.RParen)) {
        this.advance();
        return { kind: 'UnitLit', span };
      }
      const e = this.parseExpr();
      if (this.check(TokenKind.Comma)) {
        // Tuple
        const elems = [e];
        while (this.check(TokenKind.Comma)) {
          this.advance();
          if (this.check(TokenKind.RParen)) break;
          elems.push(this.parseExpr());
        }
        this.expect(TokenKind.RParen);
        return { kind: 'Tuple', elems, span };
      }
      this.expect(TokenKind.RParen);
      return e;
    }

    // Block
    if (tok.kind === TokenKind.LBrace) return this.parseBlock();

    // List
    if (tok.kind === TokenKind.LBracket) return this.parseListExpr();

    // if
    if (tok.kind === TokenKind.KwIf) return this.parseIf();

    // match
    if (tok.kind === TokenKind.KwMatch) return this.parseMatch();

    // Zero-argument lambda: || body
    if (tok.kind === TokenKind.Or) {
      this.advance(); // consume ||
      const body = this.check(TokenKind.LBrace) ? this.parseBlock() : this.parseExpr();
      return { kind: 'Lambda', params: [], body, span };
    }

    // Lambda |params| body
    if (tok.kind === TokenKind.Bar) return this.parseLambda();

    // return
    if (tok.kind === TokenKind.KwReturn) {
      this.advance();
      const value = !this.checkStatementEnd() ? this.parseExpr() : null;
      return { kind: 'Return', value, span };
    }

    // break
    if (tok.kind === TokenKind.KwBreak) {
      this.advance();
      const value = !this.checkStatementEnd() ? this.parseExpr() : null;
      return { kind: 'Break', value, span };
    }

    // continue
    if (tok.kind === TokenKind.KwContinue) {
      this.advance();
      return { kind: 'Continue', span };
    }

    // await
    if (tok.kind === TokenKind.KwAwait) {
      this.advance();
      const e = this.parseExpr();
      return { kind: 'Await', expr: e, span };
    }

    // loop expression: loop { ... break value ... }
    if (tok.kind === TokenKind.KwLoop) {
      this.advance();
      const body = this.parseBlock();
      return { kind: 'Loop', body, span };
    }

    // spawn
    if (tok.kind === TokenKind.KwSpawn) {
      this.advance();
      const agentName = this.expectIdent();
      return { kind: 'Spawn', agentName, initMsg: null, span };
    }

    // Ok(e) / Err(e) / Some(e)
    if (tok.kind === TokenKind.KwOk || tok.kind === TokenKind.KwErr ||
        tok.kind === TokenKind.KwSome) {
      this.advance();
      this.expect(TokenKind.LParen);
      const inner = this.parseExpr();
      this.expect(TokenKind.RParen);
      const variant = tok.kind === TokenKind.KwOk  ? 'Ok'
                    : tok.kind === TokenKind.KwErr ? 'Err' : 'Some';
      return { kind: 'EnumVariant', typeName: 'Result', variant, fields: [inner], span };
    }

    // None
    if (tok.kind === TokenKind.KwNone) {
      this.advance();
      return { kind: 'EnumVariant', typeName: 'Option', variant: 'None', fields: [], span };
    }

    // Identifier (or upper-case constructor)
    if (this.checkIdent()) {
      const name = this.advance().value;

      // Record construction: Name { field: val, ... }
      if (this.isUpperIdent(name) && this.check(TokenKind.LBrace)) {
        return this.parseRecordConstruct(name, span);
      }

      return { kind: 'Ident', name, span };
    }

    // Underscore as wildcard identifier
    if (tok.kind === TokenKind.Underscore) {
      this.advance();
      return { kind: 'Ident', name: '_', span };
    }

    throw this.error(`Unexpected token: '${tok.value}' (${tok.kind})`);
  }

  private parseRecordConstruct(typeName: string, span: Span): Expr {
    this.expect(TokenKind.LBrace);
    const fields: { name: string; value: Expr }[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      const n = this.expectIdent();
      this.expect(TokenKind.Colon);
      const v = this.parseExpr();
      fields.push({ name: n, value: v });
      if (this.check(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBrace);
    return { kind: 'Record', typeName, fields, span };
  }

  private parseBlock(): Expr {
    const span = this.span();
    this.expect(TokenKind.LBrace);
    const stmts: Stmt[] = [];

    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      while (this.check(TokenKind.Semicolon)) this.advance();
      if (this.check(TokenKind.RBrace)) break;

      // Try to parse as statement, fall back to tail expression
      const stmt = this.tryParseStmt();
      if (stmt) {
        stmts.push(stmt);
      } else {
        // Must be the tail expression
        const tail = this.parseExpr();
        while (this.check(TokenKind.Semicolon)) this.advance();
        this.expect(TokenKind.RBrace);
        return { kind: 'Block', stmts, tail, span };
      }
    }

    this.expect(TokenKind.RBrace);
    return { kind: 'Block', stmts, tail: null, span };
  }

  private tryParseStmt(): Stmt | null {
    const span = this.span();

    if (this.check(TokenKind.KwLet)) {
      this.advance();
      const isMut = this.check(TokenKind.KwMut) ? (this.advance(), true) : false;
      if (isMut) {
        const name = this.expectIdent();
        let ty: TypeExpr | null = null;
        if (this.check(TokenKind.Colon)) { this.advance(); ty = this.parseType(); }
        this.expect(TokenKind.Assign);
        const init = this.parseExpr();
        this.skipSemicolon();
        return { kind: 'LetMutStmt', name, ty, init, span };
      }
      const pat = this.parsePattern();
      let ty: TypeExpr | null = null;
      if (this.check(TokenKind.Colon)) { this.advance(); ty = this.parseType(); }
      this.expect(TokenKind.Assign);
      const init = this.parseExpr();
      this.skipSemicolon();
      return { kind: 'LetStmt', pat, ty, init, span };
    }

    // Local function declaration: fn name(...) { body } → let name = |params| body
    if (this.check(TokenKind.KwFn)) {
      const fnDecl = this.parseFnDecl('priv', []);
      if (fnDecl.body) {
        const lambda: Expr = { kind: 'Lambda', params: fnDecl.params, body: fnDecl.body, span: fnDecl.span };
        const pat: Pattern = { kind: 'IdentPat', name: fnDecl.name, span: fnDecl.span };
        return { kind: 'LetStmt', pat, ty: null, init: lambda, span };
      }
      return { kind: 'ExprStmt', expr: { kind: 'UnitLit', span: fnDecl.span }, span };
    }

    if (this.check(TokenKind.KwFor)) {
      this.advance();
      const pat = this.parsePattern();
      this.expect(TokenKind.KwIn);
      const iter = this.parseExpr();
      const body = this.parseBlock();
      return { kind: 'ForStmt', pat, iter, body, span };
    }

    if (this.check(TokenKind.KwWhile)) {
      this.advance();
      // while let Pat = Expr { ... }
      if (this.check(TokenKind.KwLet)) {
        this.advance();
        const pat = this.parsePattern();
        this.expect(TokenKind.Assign);
        const value = this.parseExpr();
        const body = this.parseBlock();
        return { kind: 'WhileLetStmt', pat, value, body, span };
      }
      const cond = this.parseExpr();
      const body = this.parseBlock();
      return { kind: 'WhileStmt', cond, body, span };
    }

    // Assignment or expression statement
    // Peek ahead: if we see an ident followed by =, +=, -= etc., it's an assignment
    const savedPos = this.pos;
    try {
      const expr = this.parseExpr();

      // Check if it's an assignment
      const assignOps = [TokenKind.Assign, TokenKind.PlusEq, TokenKind.MinusEq,
                         TokenKind.StarEq, TokenKind.SlashEq];
      if (assignOps.some(k => this.check(k))) {
        const op = this.advance().value;
        const value = this.parseExpr();
        this.skipSemicolon();
        return { kind: 'AssignStmt', target: expr, op, value, span };
      }

      // Explicit semicolon → always a statement
      if (this.check(TokenKind.Semicolon)) {
        this.advance();
        return { kind: 'ExprStmt', expr, span };
      }

      // End of block or file → tail expression (restore and let parseBlock handle it)
      if (this.check(TokenKind.RBrace) || this.check(TokenKind.EOF)) {
        this.pos = savedPos;
        return null;
      }

      // Next token starts a new statement → treat as ExprStmt (no semicolon needed)
      return { kind: 'ExprStmt', expr, span };

    } catch {
      this.pos = savedPos;
      return null;
    }
  }

  private parseIf(): Expr {
    const span = this.span();
    this.expect(TokenKind.KwIf);
    // if let Pat = Expr { ... } else { ... }
    if (this.check(TokenKind.KwLet)) {
      this.advance();
      const pat = this.parsePattern();
      this.expect(TokenKind.Assign);
      const value = this.parseExpr();
      const then = this.parseBlock();
      let else_: Expr | null = null;
      if (this.check(TokenKind.KwElse)) {
        this.advance();
        else_ = this.check(TokenKind.KwIf) ? this.parseIf() : this.parseBlock();
      }
      return { kind: 'IfLet', pat, value, then, else_, span };
    }
    const cond = this.parseExpr();
    const then = this.parseBlock();
    let else_: Expr | null = null;
    if (this.check(TokenKind.KwElse)) {
      this.advance();
      else_ = this.check(TokenKind.KwIf) ? this.parseIf() : this.parseBlock();
    }
    return { kind: 'If', cond, then, else_, span };
  }

  private parseMatch(): Expr {
    const span = this.span();
    this.expect(TokenKind.KwMatch);
    const scrutinee = this.parseExpr();
    this.expect(TokenKind.LBrace);
    const arms: MatchArm[] = [];
    while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
      const pSpan = this.span();
      const pattern = this.parsePattern();
      let guard: Expr | null = null;
      if (this.check(TokenKind.KwIf)) {
        this.advance();
        guard = this.parseExpr();
      }
      this.expect(TokenKind.FatArrow);
      const body = this.parseExpr();
      arms.push({ pattern, guard, body, span: pSpan });
      if (this.check(TokenKind.Comma)) this.advance();
    }
    this.expect(TokenKind.RBrace);
    return { kind: 'Match', scrutinee, arms, span };
  }

  private parseLambda(): Expr {
    const span = this.span();
    this.expect(TokenKind.Bar);
    const params: Param[] = [];
    while (!this.check(TokenKind.Bar) && !this.check(TokenKind.EOF)) {
      params.push(this.parseParam());
      if (!this.check(TokenKind.Bar)) this.expect(TokenKind.Comma);
    }
    this.expect(TokenKind.Bar);
    const body = this.check(TokenKind.LBrace) ? this.parseBlock() : this.parseExpr();
    return { kind: 'Lambda', params, body, span };
  }

  private parseListExpr(): Expr {
    const span = this.span();
    this.expect(TokenKind.LBracket);
    const elems: Expr[] = [];
    let spread: Expr | null = null;
    while (!this.check(TokenKind.RBracket) && !this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.DotDot)) {
        this.advance();
        spread = this.parseExpr();
        break;
      }
      elems.push(this.parseExpr());
      if (!this.check(TokenKind.RBracket)) this.expect(TokenKind.Comma);
    }
    this.expect(TokenKind.RBracket);
    return { kind: 'List', elems, spread, span };
  }

  // ── Patterns ────────────────────────────────────────────

  private parsePattern(): Pattern {
    return this.parseOrPattern();
  }

  private parseOrPattern(): Pattern {
    let left = this.parseAtomPattern();
    while (this.check(TokenKind.Bar)) {
      const span = this.span();
      this.advance();
      const right = this.parseAtomPattern();
      left = { kind: 'OrPat', left, right, span };
    }
    return left;
  }

  private parseAtomPattern(): Pattern {
    const span = this.span();
    const tok  = this.cur();

    if (tok.kind === TokenKind.Underscore) { this.advance(); return { kind: 'WildPat', span }; }

    if (tok.kind === TokenKind.IntLit) {
      this.advance();
      return { kind: 'LitPat', value: { kind: 'IntLit', value: BigInt(tok.value), span }, span };
    }
    if (tok.kind === TokenKind.FloatLit) {
      this.advance();
      return { kind: 'LitPat', value: { kind: 'FloatLit', value: parseFloat(tok.value), span }, span };
    }
    if (tok.kind === TokenKind.BoolLit) {
      this.advance();
      return { kind: 'LitPat', value: { kind: 'BoolLit', value: tok.value === 'true', span }, span };
    }
    if (tok.kind === TokenKind.StringLit || tok.kind === TokenKind.InterpolatedStringLit) {
      this.advance();
      return { kind: 'LitPat', value: { kind: 'StringLit', value: tok.value, interpolated: tok.kind === TokenKind.InterpolatedStringLit, span }, span };
    }
    if (tok.kind === TokenKind.KwNone) {
      this.advance();
      return { kind: 'EnumPat', typeName: 'Option', variant: 'None', fields: [], recordFields: [], span };
    }
    if (tok.kind === TokenKind.KwOk || tok.kind === TokenKind.KwErr || tok.kind === TokenKind.KwSome) {
      this.advance();
      const variant = tok.kind === TokenKind.KwOk ? 'Ok' : tok.kind === TokenKind.KwErr ? 'Err' : 'Some';
      this.expect(TokenKind.LParen);
      const inner = this.parsePattern();
      this.expect(TokenKind.RParen);
      return { kind: 'EnumPat', typeName: 'Result', variant, fields: [inner], recordFields: [], span };
    }

    // Tuple
    if (tok.kind === TokenKind.LParen) {
      this.advance();
      if (this.check(TokenKind.RParen)) { this.advance(); return { kind: 'LitPat', value: { kind: 'UnitLit', span }, span }; }
      const first = this.parsePattern();
      if (this.check(TokenKind.RParen)) { this.advance(); return first; }
      const elems = [first];
      while (this.check(TokenKind.Comma)) { this.advance(); elems.push(this.parsePattern()); }
      this.expect(TokenKind.RParen);
      return { kind: 'TuplePat', elems, span };
    }

    // List
    if (tok.kind === TokenKind.LBracket) {
      this.advance();
      if (this.check(TokenKind.RBracket)) { this.advance(); return { kind: 'ListPat', head: [], tail: null, span }; }
      const head: Pattern[] = [];
      let tail: string | null = null;
      while (!this.check(TokenKind.RBracket) && !this.check(TokenKind.EOF)) {
        if (this.check(TokenKind.DotDot)) {
          this.advance();
          tail = this.checkIdent() ? this.advance().value : '_rest';
          break;
        }
        head.push(this.parsePattern());
        if (!this.check(TokenKind.RBracket)) this.expect(TokenKind.Comma);
      }
      this.expect(TokenKind.RBracket);
      return { kind: 'ListPat', head, tail, span };
    }

    // Identifier or enum constructor
    if (this.checkIdent()) {
      const name = this.advance().value;

      // Bind pattern: name @ pat
      if (this.check(TokenKind.At)) {
        this.advance();
        const inner = this.parseAtomPattern();
        return { kind: 'BindPat', name, inner, span };
      }

      // Enum constructor with record fields: Name { f: p, ... }
      if (this.isUpperIdent(name) && this.check(TokenKind.LBrace)) {
        this.advance();
        const recordFields: { name: string; pat: Pattern }[] = [];
        let rest = false;
        while (!this.check(TokenKind.RBrace) && !this.check(TokenKind.EOF)) {
          if (this.check(TokenKind.DotDot)) { this.advance(); rest = true; break; }
          const fn_ = this.expectIdent();
          let pat: Pattern;
          if (this.check(TokenKind.Colon)) { this.advance(); pat = this.parsePattern(); }
          else { pat = { kind: 'IdentPat', name: fn_, span }; }
          recordFields.push({ name: fn_, pat });
          if (this.check(TokenKind.Comma)) this.advance();
        }
        this.expect(TokenKind.RBrace);
        return { kind: 'EnumPat', typeName: '', variant: name, fields: [], recordFields, span };
      }

      // Enum constructor with tuple fields: Name(p1, p2)
      if (this.isUpperIdent(name) && this.check(TokenKind.LParen)) {
        this.advance();
        const fields: Pattern[] = [];
        while (!this.check(TokenKind.RParen) && !this.check(TokenKind.EOF)) {
          fields.push(this.parsePattern());
          if (!this.check(TokenKind.RParen)) this.expect(TokenKind.Comma);
        }
        this.expect(TokenKind.RParen);
        return { kind: 'EnumPat', typeName: '', variant: name, fields, recordFields: [], span };
      }

      // Plain identifier (binding)
      if (this.isUpperIdent(name)) {
        return { kind: 'EnumPat', typeName: '', variant: name, fields: [], recordFields: [], span };
      }
      return { kind: 'IdentPat', name, span };
    }

    return { kind: 'WildPat', span };
  }

  // ── Utilities ───────────────────────────────────────────

  private parseModulePath(): string[] {
    const path = [this.expectIdent()];
    while (this.check(TokenKind.Dot) || this.check(TokenKind.DoubleColon)) {
      this.advance();
      if (this.checkIdent()) path.push(this.advance().value);
    }
    return path;
  }

  private cur(): Token { return this.tokens[this.pos] ?? { kind: TokenKind.EOF, value: '', line: 0, col: 0 }; }
  private advance(): Token { return this.tokens[this.pos++] ?? { kind: TokenKind.EOF, value: '', line: 0, col: 0 }; }
  private check(kind: TokenKind): boolean { return this.cur().kind === kind; }
  private checkIdent(): boolean {
    const k = this.cur().kind;
    return k === TokenKind.Ident || k === TokenKind.KwFrom || k === TokenKind.KwTo
        || k === TokenKind.KwSend || k === TokenKind.KwAgent;
  }
  private span(): Span { const t = this.cur(); return { line: t.line, col: t.col }; }

  private expect(kind: TokenKind): Token {
    if (!this.check(kind)) throw this.error(`Expected '${kind}', got '${this.cur().value}' (${this.cur().kind})`);
    return this.advance();
  }

  private expectIdent(): string {
    const tok = this.cur();
    // Allow keywords-as-identifiers in some contexts
    if (tok.kind === TokenKind.Ident || tok.kind === TokenKind.KwFrom ||
        tok.kind === TokenKind.KwTo || tok.kind === TokenKind.KwState ||
        tok.kind === TokenKind.KwHot || tok.kind === TokenKind.KwWith ||
        tok.kind === TokenKind.KwOn || tok.kind === TokenKind.KwSend ||
        tok.kind === TokenKind.KwAgent) {
      return this.advance().value;
    }
    throw this.error(`Expected identifier, got '${tok.value}' (${tok.kind})`);
  }

  private skipSemicolon(): void {
    if (this.check(TokenKind.Semicolon)) this.advance();
  }

  private checkStatementEnd(): boolean {
    const k = this.cur().kind;
    return k === TokenKind.RBrace || k === TokenKind.EOF || k === TokenKind.Semicolon;
  }

  private isUpperIdent(name: string): boolean {
    return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
  }

  private error(msg: string): ParseError {
    const tok = this.cur();
    return new ParseError(msg, tok.line, tok.col);
  }
}

export function parse(src: string, file = '<input>'): Program {
  return new Parser(src, file).parse();
}
