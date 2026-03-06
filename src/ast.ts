// ============================================================
// Axon Language — AST Node Definitions
// ============================================================

export interface Span { line: number; col: number; }

// ─── Types ──────────────────────────────────────────────────

export type TypeExpr =
  | { kind: 'NameType';    name: string; params: TypeExpr[]; span: Span }
  | { kind: 'TupleType';   elems: TypeExpr[];                span: Span }
  | { kind: 'FnType';      params: TypeExpr[]; ret: TypeExpr; effects: string[]; span: Span }
  | { kind: 'RefineType';  base: TypeExpr; pred: string;     span: Span }
  | { kind: 'UnitType';                                       span: Span }
  | { kind: 'NeverType';                                      span: Span }
  | { kind: 'InferType';                                      span: Span }; // _

// ─── Patterns ───────────────────────────────────────────────

export type Pattern =
  | { kind: 'WildPat';    span: Span }
  | { kind: 'IdentPat';   name: string; span: Span }
  | { kind: 'LitPat';     value: LitExpr; span: Span }
  | { kind: 'TuplePat';   elems: Pattern[]; span: Span }
  | { kind: 'ListPat';    head: Pattern[]; tail: string | null; span: Span }
  | { kind: 'RecordPat';  typeName: string | null; fields: { name: string; pat: Pattern }[]; rest: boolean; span: Span }
  | { kind: 'EnumPat';    typeName: string; variant: string; fields: Pattern[]; recordFields: { name: string; pat: Pattern }[]; span: Span }
  | { kind: 'OrPat';      left: Pattern; right: Pattern; span: Span }
  | { kind: 'BindPat';    name: string; inner: Pattern; span: Span }   // name @ pat
  | { kind: 'RangePat';   lo: LitExpr; hi: LitExpr; inclusive: boolean; span: Span }

// ─── Literal Expressions ────────────────────────────────────

export type LitExpr =
  | { kind: 'IntLit';    value: bigint; span: Span }
  | { kind: 'FloatLit';  value: number; span: Span }
  | { kind: 'BoolLit';   value: boolean; span: Span }
  | { kind: 'StringLit'; value: string; interpolated: boolean; span: Span }
  | { kind: 'CharLit';   value: string; span: Span }
  | { kind: 'UnitLit';   span: Span }

// ─── Expressions ────────────────────────────────────────────

export type Expr =
  | LitExpr
  | { kind: 'Ident';        name: string; span: Span }
  | { kind: 'Block';        stmts: Stmt[]; tail: Expr | null; span: Span }
  | { kind: 'If';           cond: Expr; then: Expr; else_: Expr | null; span: Span }
  | { kind: 'Match';        scrutinee: Expr; arms: MatchArm[]; span: Span }
  | { kind: 'Call';         callee: Expr; args: CallArg[]; typeArgs: TypeExpr[]; span: Span }
  | { kind: 'MethodCall';   obj: Expr; method: string; args: CallArg[]; typeArgs: TypeExpr[]; span: Span }
  | { kind: 'FieldAccess';  obj: Expr; field: string; span: Span }
  | { kind: 'Index';        obj: Expr; index: Expr; span: Span }
  | { kind: 'Unary';        op: string; expr: Expr; span: Span }
  | { kind: 'Binary';       op: string; left: Expr; right: Expr; span: Span }
  | { kind: 'Pipe';         left: Expr; right: Expr; span: Span }
  | { kind: 'Lambda';       params: Param[]; body: Expr; span: Span }
  | { kind: 'List';         elems: Expr[]; spread: Expr | null; span: Span }
  | { kind: 'Tuple';        elems: Expr[]; span: Span }
  | { kind: 'Record';       typeName: string | null; fields: { name: string; value: Expr }[]; span: Span }
  | { kind: 'RecordUpdate'; base: Expr; fields: { name: string; value: Expr }[]; span: Span }
  | { kind: 'Try';          expr: Expr; span: Span }       // expr?
  | { kind: 'Force';        expr: Expr; span: Span }       // expr!
  | { kind: 'Await';        expr: Expr; span: Span }
  | { kind: 'Spawn';        agentName: string; initMsg: Expr | null; timeout: Expr | null; span: Span }
  | { kind: 'Return';       value: Expr | null; span: Span }
  | { kind: 'Break';        value: Expr | null; span: Span }
  | { kind: 'Continue';     span: Span }
  | { kind: 'TypeAscription'; expr: Expr; ty: TypeExpr; span: Span }
  | { kind: 'EnumVariant';  typeName: string; variant: string; fields: Expr[] | { name: string; value: Expr }[]; span: Span }
  | { kind: 'Loop';         body: Expr; span: Span }
  | { kind: 'Range';        lo: Expr; hi: Expr; inclusive: boolean; span: Span }
  | { kind: 'IfLet';        pat: Pattern; value: Expr; then: Expr; else_: Expr | null; span: Span }
  | { kind: 'HandleExpr';  effect: string; handlers: Array<{ name: string; handler: Expr }>; body: Expr; span: Span }

export interface MatchArm {
  pattern: Pattern;
  guard:   Expr | null;
  body:    Expr;
  span:    Span;
}

export interface CallArg {
  name?:  string;   // named argument
  value:  Expr;
}

// ─── Statements ─────────────────────────────────────────────

export type Stmt =
  | { kind: 'LetStmt';    pat: Pattern; ty: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'LetMutStmt'; name: string; ty: TypeExpr | null; init: Expr; span: Span }
  | { kind: 'AssignStmt'; target: Expr; op: string; value: Expr; span: Span }
  | { kind: 'ExprStmt';   expr: Expr; span: Span }
  | { kind: 'ForStmt';       pat: Pattern; iter: Expr; body: Expr; span: Span }
  | { kind: 'WhileStmt';    cond: Expr; body: Expr; span: Span }
  | { kind: 'WhileLetStmt'; pat: Pattern; value: Expr; body: Expr; span: Span }

// ─── Declarations ────────────────────────────────────────────

export interface Param {
  name:     string;
  ty:       TypeExpr | null;
  default_: Expr | null;
  span:     Span;
}

export interface FnDecl {
  kind:            'FnDecl';
  vis:             'pub' | 'priv' | 'internal';
  name:            string;
  typeParams:      string[];
  params:          Param[];
  retTy:           TypeExpr | null;
  effects:         string[];
  effectsExplicit: boolean;   // true = user wrote "| Effect" in source
  body:            Expr | null;   // null = abstract (in trait)
  annots:          string[];
  span:            Span;
}

export interface TypeVariant {
  name:   string;
  fields: TypeVariantField[];
  span:   Span;
}

export type TypeVariantField =
  | { kind: 'Tuple';  types: TypeExpr[] }
  | { kind: 'Record'; fields: { name: string; ty: TypeExpr }[] };

export interface TypeDecl {
  kind:       'TypeDecl';
  vis:        'pub' | 'priv' | 'internal';
  name:       string;
  typeParams: string[];
  def:        TypeDef;
  span:       Span;
}

export type TypeDef =
  | { kind: 'Record';  fields: { name: string; ty: TypeExpr; default_?: Expr }[] }
  | { kind: 'Enum';    variants: TypeVariant[] }
  | { kind: 'Alias';   ty: TypeExpr }
  | { kind: 'Refine';  base: TypeExpr; pred: Expr };

export interface StateField {
  name:    string;
  ty:      TypeExpr | null;
  default_: Expr;
  span:    Span;
}

export interface AgentHandler {
  msgType:         string;
  params:          Param[];
  retTy:           TypeExpr | null;
  effects:         string[];
  effectsExplicit: boolean;
  body:            Expr;
  span:            Span;
}

export interface AgentDecl {
  kind:       'AgentDecl';
  vis:        'pub' | 'priv' | 'internal';
  name:       string;
  requires:   string[];
  stateFields: StateField[];
  handlers:   AgentHandler[];
  annots:     string[];
  span:       Span;
}

export interface ConstDecl {
  kind:  'ConstDecl';
  name:  string;
  ty:    TypeExpr | null;
  value: Expr;
  span:  Span;
}

export interface UseDecl {
  kind: 'UseDecl';
  path: string[];
  items: string[] | null;  // null = import whole module
  alias: string | null;
  span: Span;
}

export interface ModuleDecl {
  kind: 'ModuleDecl';
  path: string[];
  hot:  boolean;
  span: Span;
}

export interface MigrateDecl {
  kind:       'MigrateDecl';
  agentPath:  string[];
  fromFields: { name: string; ty: TypeExpr }[];
  toFields:   { name: string; ty: TypeExpr }[];
  transform:  Expr;   // lambda: |old| { ... }
  span:       Span;
}

export interface ImplDecl {
  kind:       'ImplDecl';
  typeName:   string;
  methods:    FnDecl[];
  span:       Span;
}

export type TopLevel =
  | ModuleDecl
  | UseDecl
  | FnDecl
  | TypeDecl
  | AgentDecl
  | ConstDecl
  | MigrateDecl
  | ImplDecl;

export interface Program {
  module:   ModuleDecl | null;
  items:    TopLevel[];
  span:     Span;
}
