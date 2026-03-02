// ============================================================
// Axon Language — Lexer (Tokenizer)
// ============================================================

export const enum TokenKind {
  // Literals
  IntLit    = 'INT',
  FloatLit  = 'FLOAT',
  StringLit = 'STRING',
  BoolLit   = 'BOOL',
  CharLit   = 'CHAR',

  // Identifier
  Ident = 'IDENT',

  // Keywords
  KwModule   = 'module',
  KwUse      = 'use',
  KwFn       = 'fn',
  KwLet      = 'let',
  KwMut      = 'mut',
  KwConst    = 'const',
  KwType     = 'type',
  KwTrait    = 'trait',
  KwImpl     = 'impl',
  KwFor      = 'for',
  KwIn       = 'in',
  KwIf       = 'if',
  KwElse     = 'else',
  KwMatch    = 'match',
  KwLoop     = 'loop',
  KwWhile    = 'while',
  KwBreak    = 'break',
  KwContinue = 'continue',
  KwReturn   = 'return',
  KwPub      = 'pub',
  KwPriv     = 'priv',
  KwWhere    = 'where',
  KwAs       = 'as',
  KwIs       = 'is',
  KwWith     = 'with',

  // Agent keywords
  KwAgent    = 'agent',
  KwOn       = 'on',
  KwState    = 'state',
  KwSpawn    = 'spawn',
  KwSend     = 'send',
  KwAwait    = 'await',
  KwEmit     = 'emit',
  KwRequires = 'requires',

  // Hot reload keywords
  KwHot      = 'hot',
  KwMigrate  = 'migrate',
  KwFrom     = 'from',
  KwTo       = 'to',

  // Built-in constructors
  KwOk       = 'Ok',
  KwErr      = 'Err',
  KwSome     = 'Some',
  KwNone     = 'None',

  // Operators
  Plus    = '+',
  Minus   = '-',
  Star    = '*',
  Slash   = '/',
  Percent = '%',
  Power   = '**',

  Eq    = '==',
  Neq   = '!=',
  Lt    = '<',
  Gt    = '>',
  Lte   = '<=',
  Gte   = '>=',

  And   = '&&',
  Or    = '||',
  Not   = '!',

  BitAnd   = '&',
  BitOr    = '|',
  BitXor   = '^',
  BitNot   = '~',
  Shl      = '<<',
  Shr      = '>>',

  // Special operators
  Pipe      = '|>',
  Question  = '?',
  Bang      = '!!',
  DotDot    = '..',
  DotDotEq  = '..=',
  Arrow     = '->',
  FatArrow  = '=>',

  // Assignment
  Assign    = '=',
  PlusEq    = '+=',
  MinusEq   = '-=',
  StarEq    = '*=',
  SlashEq   = '/=',

  // Punctuation
  Dot          = '.',
  Comma        = ',',
  Semicolon    = ';',
  Colon        = ':',
  DoubleColon  = '::',
  At           = '@',
  Hash         = '#',
  Underscore   = '_',
  Backslash    = '\\',

  // Delimiters
  LParen   = '(',
  RParen   = ')',
  LBrace   = '{',
  RBrace   = '}',
  LBracket = '[',
  RBracket = ']',

  // Pipe for type alternatives (in enums)
  Bar = 'BAR',

  // End of file
  EOF = 'EOF',
}

export interface Token {
  kind:   TokenKind;
  value:  string;
  line:   number;
  col:    number;
}

// String interpolation segment
export type StringSegment =
  | { type: 'text';  value: string }
  | { type: 'expr';  tokens: Token[] };

// Extended token for interpolated strings
export interface InterpolatedString {
  segments: StringSegment[];
}

const KEYWORDS: Record<string, TokenKind> = {
  module:   TokenKind.KwModule,
  use:      TokenKind.KwUse,
  fn:       TokenKind.KwFn,
  let:      TokenKind.KwLet,
  mut:      TokenKind.KwMut,
  const:    TokenKind.KwConst,
  type:     TokenKind.KwType,
  trait:    TokenKind.KwTrait,
  impl:     TokenKind.KwImpl,
  for:      TokenKind.KwFor,
  in:       TokenKind.KwIn,
  if:       TokenKind.KwIf,
  else:     TokenKind.KwElse,
  match:    TokenKind.KwMatch,
  loop:     TokenKind.KwLoop,
  while:    TokenKind.KwWhile,
  break:    TokenKind.KwBreak,
  continue: TokenKind.KwContinue,
  return:   TokenKind.KwReturn,
  pub:      TokenKind.KwPub,
  priv:     TokenKind.KwPriv,
  where:    TokenKind.KwWhere,
  as:       TokenKind.KwAs,
  is:       TokenKind.KwIs,
  with:     TokenKind.KwWith,
  agent:    TokenKind.KwAgent,
  on:       TokenKind.KwOn,
  state:    TokenKind.KwState,
  spawn:    TokenKind.KwSpawn,
  send:     TokenKind.KwSend,
  await:    TokenKind.KwAwait,
  emit:     TokenKind.KwEmit,
  requires: TokenKind.KwRequires,
  hot:      TokenKind.KwHot,
  migrate:  TokenKind.KwMigrate,
  from:     TokenKind.KwFrom,
  to:       TokenKind.KwTo,
  true:     TokenKind.BoolLit,
  false:    TokenKind.BoolLit,
  Ok:       TokenKind.KwOk,
  Err:      TokenKind.KwErr,
  Some:     TokenKind.KwSome,
  None:     TokenKind.KwNone,
};

export class LexError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(`Lex error at ${line}:${col}: ${msg}`);
    this.name = 'LexError';
  }
}

export class Lexer {
  private pos  = 0;
  private line = 1;
  private col  = 1;
  private tokens: Token[] = [];

  constructor(private src: string, private file = '<input>') {}

  tokenize(): Token[] {
    while (this.pos < this.src.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.src.length) break;
      this.tokens.push(this.nextToken());
    }
    this.tokens.push(this.makeToken(TokenKind.EOF, ''));
    return this.tokens;
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];

      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance(); continue;
      }
      if (ch === '\n') {
        this.advance(); this.line++; this.col = 1; continue;
      }

      // Single-line comment
      if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.advance();
        continue;
      }

      // Block comment (nested)
      if (ch === '/' && this.peek(1) === '*') {
        this.advance(); this.advance();
        let depth = 1;
        while (this.pos < this.src.length && depth > 0) {
          if (this.src[this.pos] === '/' && this.peek(1) === '*') {
            depth++; this.advance(); this.advance();
          } else if (this.src[this.pos] === '*' && this.peek(1) === '/') {
            depth--; this.advance(); this.advance();
          } else {
            if (this.src[this.pos] === '\n') { this.line++; this.col = 1; }
            this.advance();
          }
        }
        continue;
      }

      break;
    }
  }

  private nextToken(): Token {
    const startLine = this.line;
    const startCol  = this.col;
    const ch = this.src[this.pos];

    // Numbers — negative literals handled by parser's unary minus
    if (this.isDigit(ch)) {
      return this.readNumber(startLine, startCol);
    }

    // Identifiers and keywords
    if (this.isAlpha(ch)) {
      return this.readIdent(startLine, startCol);
    }

    // Strings
    if (ch === '"') {
      return this.readString(startLine, startCol);
    }

    // Characters
    if (ch === "'") {
      return this.readChar(startLine, startCol);
    }

    // Operators and punctuation
    return this.readOperator(startLine, startCol);
  }

  private readNumber(line: number, col: number): Token {
    let value = '';
    let isFloat = false;

    // Hex
    if (this.src[this.pos] === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      value += '0x';
      this.advance(); this.advance();
      while (this.pos < this.src.length && /[0-9a-fA-F_]/.test(this.src[this.pos])) {
        if (this.src[this.pos] !== '_') value += this.src[this.pos];
        this.advance();
      }
      return { kind: TokenKind.IntLit, value, line, col };
    }

    // Binary
    if (this.src[this.pos] === '0' && (this.peek(1) === 'b' || this.peek(1) === 'B')) {
      value += '0b';
      this.advance(); this.advance();
      while (this.pos < this.src.length && /[01_]/.test(this.src[this.pos])) {
        if (this.src[this.pos] !== '_') value += this.src[this.pos];
        this.advance();
      }
      return { kind: TokenKind.IntLit, value, line, col };
    }

    // Decimal / Float
    while (this.pos < this.src.length && (this.isDigit(this.src[this.pos]) || this.src[this.pos] === '_')) {
      if (this.src[this.pos] !== '_') value += this.src[this.pos];
      this.advance();
    }

    if (this.pos < this.src.length && this.src[this.pos] === '.' && this.isDigit(this.peek(1))) {
      isFloat = true;
      value += '.';
      this.advance();
      while (this.pos < this.src.length && (this.isDigit(this.src[this.pos]) || this.src[this.pos] === '_')) {
        if (this.src[this.pos] !== '_') value += this.src[this.pos];
        this.advance();
      }
    }

    // Exponent
    if (this.pos < this.src.length && (this.src[this.pos] === 'e' || this.src[this.pos] === 'E')) {
      isFloat = true;
      value += 'e';
      this.advance();
      if (this.pos < this.src.length && (this.src[this.pos] === '+' || this.src[this.pos] === '-')) {
        value += this.src[this.pos]; this.advance();
      }
      while (this.pos < this.src.length && this.isDigit(this.src[this.pos])) {
        value += this.src[this.pos]; this.advance();
      }
    }

    return { kind: isFloat ? TokenKind.FloatLit : TokenKind.IntLit, value, line, col };
  }

  private readIdent(line: number, col: number): Token {
    let value = '';
    while (this.pos < this.src.length && (this.isAlphaNum(this.src[this.pos]) || this.src[this.pos] === '_')) {
      value += this.src[this.pos];
      this.advance();
    }
    const kind = KEYWORDS[value] ?? TokenKind.Ident;
    return { kind, value, line, col };
  }

  private readString(line: number, col: number): Token {
    this.advance(); // consume opening "
    let value = '';

    // Triple-quoted string
    if (this.src[this.pos] === '"' && this.peek(1) === '"') {
      this.advance(); this.advance();
      while (this.pos < this.src.length) {
        if (this.src[this.pos] === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
          this.advance(); this.advance(); this.advance();
          break;
        }
        if (this.src[this.pos] === '\n') { this.line++; this.col = 1; }
        value += this.src[this.pos];
        this.advance();
      }
      // Trim common indent
      value = trimCommonIndent(value);
      return { kind: TokenKind.StringLit, value, line, col };
    }

    // Regular string (with interpolation encoded as special markers)
    while (this.pos < this.src.length && this.src[this.pos] !== '"') {
      if (this.src[this.pos] === '\\') {
        this.advance();
        const esc = this.src[this.pos];
        switch (esc) {
          case 'n':  value += '\n'; break;
          case 't':  value += '\t'; break;
          case 'r':  value += '\r'; break;
          case '"':  value += '"';  break;
          case '\\': value += '\\'; break;
          case '{':  value += '{';  break;
          default:   value += '\\' + esc;
        }
        this.advance();
      } else if (this.src[this.pos] === '{') {
        // String interpolation: collect raw "{...}" including braces
        value += '{';
        this.advance();
        let depth = 1;
        while (this.pos < this.src.length && depth > 0) {
          const c = this.src[this.pos];
          if (c === '{') depth++;
          if (c === '}') { depth--; if (depth === 0) { value += '}'; this.advance(); break; } }
          value += c;
          this.advance();
        }
      } else {
        value += this.src[this.pos];
        this.advance();
      }
    }
    this.advance(); // consume closing "
    return { kind: TokenKind.StringLit, value, line, col };
  }

  private readChar(line: number, col: number): Token {
    this.advance(); // consume '
    let value = '';
    if (this.src[this.pos] === '\\') {
      this.advance();
      const esc = this.src[this.pos];
      switch (esc) {
        case 'n':  value = '\n'; break;
        case 't':  value = '\t'; break;
        case "'":  value = "'";  break;
        default:   value = esc;
      }
      this.advance();
    } else {
      value = this.src[this.pos];
      this.advance();
    }
    if (this.src[this.pos] === "'") this.advance(); // consume closing '
    return { kind: TokenKind.CharLit, value, line, col };
  }

  private readOperator(line: number, col: number): Token {
    const ch  = this.src[this.pos];
    const ch2 = this.peek(1);
    const ch3 = this.peek(2);

    const tok = (kind: TokenKind, len: number): Token => {
      const value = this.src.slice(this.pos, this.pos + len);
      for (let i = 0; i < len; i++) this.advance();
      return { kind, value, line, col };
    };

    // Three-char operators
    if (ch === '.' && ch2 === '.' && ch3 === '=') return tok(TokenKind.DotDotEq, 3);

    // Two-char operators
    if (ch === '|' && ch2 === '>') return tok(TokenKind.Pipe, 2);
    if (ch === '-' && ch2 === '>') return tok(TokenKind.Arrow, 2);
    if (ch === '=' && ch2 === '>') return tok(TokenKind.FatArrow, 2);
    if (ch === '.' && ch2 === '.') return tok(TokenKind.DotDot, 2);
    if (ch === ':' && ch2 === ':') return tok(TokenKind.DoubleColon, 2);
    if (ch === '=' && ch2 === '=') return tok(TokenKind.Eq, 2);
    if (ch === '!' && ch2 === '=') return tok(TokenKind.Neq, 2);
    if (ch === '<' && ch2 === '=') return tok(TokenKind.Lte, 2);
    if (ch === '>' && ch2 === '=') return tok(TokenKind.Gte, 2);
    if (ch === '<' && ch2 === '<') return tok(TokenKind.Shl, 2);
    if (ch === '>' && ch2 === '>') return tok(TokenKind.Shr, 2);
    if (ch === '&' && ch2 === '&') return tok(TokenKind.And, 2);
    if (ch === '|' && ch2 === '|') return tok(TokenKind.Or, 2);
    if (ch === '*' && ch2 === '*') return tok(TokenKind.Power, 2);
    if (ch === '+' && ch2 === '=') return tok(TokenKind.PlusEq, 2);
    if (ch === '-' && ch2 === '=') return tok(TokenKind.MinusEq, 2);
    if (ch === '*' && ch2 === '=') return tok(TokenKind.StarEq, 2);
    if (ch === '/' && ch2 === '=') return tok(TokenKind.SlashEq, 2);
    if (ch === '!' && ch2 === '!') return tok(TokenKind.Bang, 2);

    // Single-char operators
    switch (ch) {
      case '+': return tok(TokenKind.Plus,       1);
      case '-': return tok(TokenKind.Minus,      1);
      case '*': return tok(TokenKind.Star,       1);
      case '/': return tok(TokenKind.Slash,      1);
      case '%': return tok(TokenKind.Percent,    1);
      case '=': return tok(TokenKind.Assign,     1);
      case '<': return tok(TokenKind.Lt,         1);
      case '>': return tok(TokenKind.Gt,         1);
      case '!': return tok(TokenKind.Not,        1);
      case '&': return tok(TokenKind.BitAnd,     1);
      case '|': return tok(TokenKind.Bar,        1);
      case '^': return tok(TokenKind.BitXor,     1);
      case '~': return tok(TokenKind.BitNot,     1);
      case '?': return tok(TokenKind.Question,   1);
      case '.': return tok(TokenKind.Dot,        1);
      case ',': return tok(TokenKind.Comma,      1);
      case ';': return tok(TokenKind.Semicolon,  1);
      case ':': return tok(TokenKind.Colon,      1);
      case '@': return tok(TokenKind.At,         1);
      case '#': return tok(TokenKind.Hash,       1);
      case '_': return tok(TokenKind.Underscore, 1);
      case '(': return tok(TokenKind.LParen,     1);
      case ')': return tok(TokenKind.RParen,     1);
      case '{': return tok(TokenKind.LBrace,     1);
      case '}': return tok(TokenKind.RBrace,     1);
      case '[': return tok(TokenKind.LBracket,   1);
      case ']': return tok(TokenKind.RBracket,   1);
    }

    throw new LexError(`Unexpected character: '${ch}'`, this.line, this.col);
  }

  private makeToken(kind: TokenKind, value: string): Token {
    return { kind, value, line: this.line, col: this.col };
  }

  private advance(): void {
    this.pos++;
    this.col++;
  }

  private peek(offset: number): string {
    return this.src[this.pos + offset] ?? '';
  }

  private isDigit(ch: string): boolean   { return ch >= '0' && ch <= '9'; }
  private isAlpha(ch: string): boolean   { return /[a-zA-Z_]/.test(ch); }
  private isAlphaNum(ch: string): boolean { return /[a-zA-Z0-9_]/.test(ch); }
}

function trimCommonIndent(s: string): string {
  const lines = s.split('\n');
  if (lines[0] === '') lines.shift();
  if (lines[lines.length - 1].trim() === '') lines.pop();
  const indent = lines.reduce((min, l) => {
    if (l.trim() === '') return min;
    const m = l.match(/^(\s*)/);
    return Math.min(min, m ? m[1].length : 0);
  }, Infinity);
  return lines.map(l => l.slice(indent === Infinity ? 0 : indent)).join('\n');
}
