// ============================================================
// Axon Language — Runtime Values
// ============================================================

import type { FnDecl, AgentDecl, Expr, Param } from '../ast';
import type { Environment } from './env';

export const enum ValueTag {
  Int           = 'Int',
  Float         = 'Float',
  Bool          = 'Bool',
  String        = 'String',
  Char          = 'Char',
  Unit          = 'Unit',
  List          = 'List',
  Tuple         = 'Tuple',
  Record        = 'Record',
  Enum          = 'Enum',
  Function      = 'Function',
  NativeFn      = 'NativeFn',
  AsyncNativeFn = 'AsyncNativeFn',
  Agent         = 'Agent',
  Option        = 'Option',   // Some(v) | None
  Result        = 'Result',   // Ok(v)  | Err(e)
  Never         = 'Never',
}

export type AxonValue =
  | { tag: ValueTag.Int;           value: bigint }
  | { tag: ValueTag.Float;         value: number }
  | { tag: ValueTag.Bool;          value: boolean }
  | { tag: ValueTag.String;        value: string }
  | { tag: ValueTag.Char;          value: string }
  | { tag: ValueTag.Unit }
  | { tag: ValueTag.List;          items: AxonValue[] }
  | { tag: ValueTag.Tuple;         items: AxonValue[] }
  | { tag: ValueTag.Record;        typeName: string; fields: Map<string, AxonValue> }
  | { tag: ValueTag.Enum;          typeName: string; variant: string; fields: AxonValue[]; recordFields: Map<string, AxonValue> }
  | { tag: ValueTag.Function;      name: string; params: Param[]; body: Expr; closure: Environment; isRecursive?: boolean }
  | { tag: ValueTag.NativeFn;      name: string; fn: (...args: AxonValue[]) => AxonValue }
  | { tag: ValueTag.AsyncNativeFn; name: string; fn: (...args: AxonValue[]) => Promise<AxonValue> }
  | { tag: ValueTag.Agent;         ref: AgentRef }
  | { tag: ValueTag.Never }

// ─── Option helpers ──────────────────────────────────────────
export function mkSome(v: AxonValue): AxonValue {
  return { tag: ValueTag.Enum, typeName: 'Option', variant: 'Some', fields: [v], recordFields: new Map() };
}
export function mkNone(): AxonValue {
  return { tag: ValueTag.Enum, typeName: 'Option', variant: 'None', fields: [], recordFields: new Map() };
}
export function mkOk(v: AxonValue): AxonValue {
  return { tag: ValueTag.Enum, typeName: 'Result', variant: 'Ok', fields: [v], recordFields: new Map() };
}
export function mkErr(e: AxonValue): AxonValue {
  return { tag: ValueTag.Enum, typeName: 'Result', variant: 'Err', fields: [e], recordFields: new Map() };
}
export const UNIT: AxonValue  = { tag: ValueTag.Unit };
export const TRUE: AxonValue  = { tag: ValueTag.Bool, value: true };
export const FALSE: AxonValue = { tag: ValueTag.Bool, value: false };

export function mkInt(n: number | bigint): AxonValue {
  return { tag: ValueTag.Int, value: typeof n === 'bigint' ? n : BigInt(n) };
}
export function mkFloat(n: number): AxonValue {
  return { tag: ValueTag.Float, value: n };
}
export function mkString(s: string): AxonValue {
  return { tag: ValueTag.String, value: s };
}
export function mkBool(b: boolean): AxonValue {
  return b ? TRUE : FALSE;
}
export function mkList(items: AxonValue[]): AxonValue {
  return { tag: ValueTag.List, items: [...items] };
}
export function mkTuple(items: AxonValue[]): AxonValue {
  return { tag: ValueTag.Tuple, items };
}
export function mkRecord(typeName: string, fields: Record<string, AxonValue>): AxonValue {
  return { tag: ValueTag.Record, typeName, fields: new Map(Object.entries(fields)) };
}
export function mkEnum(typeName: string, variant: string, fields: AxonValue[] = [], recordFields: Record<string, AxonValue> = {}): AxonValue {
  return { tag: ValueTag.Enum, typeName, variant, fields, recordFields: new Map(Object.entries(recordFields)) };
}
export function mkNative(name: string, fn: (...args: AxonValue[]) => AxonValue): AxonValue {
  return { tag: ValueTag.NativeFn, name, fn };
}
export function mkNativeAsync(name: string, fn: (...args: AxonValue[]) => Promise<AxonValue>): AxonValue {
  return { tag: ValueTag.AsyncNativeFn, name, fn };
}

// ─── Agent Reference ─────────────────────────────────────────

export interface AgentMessage {
  type:    string;
  args:    AxonValue[];
  resolve: (v: AxonValue) => void;
  reject:  (e: Error) => void;
}

export class AgentRef {
  private queue:     AgentMessage[] = [];
  private processing = false;

  public state:    Map<string, AxonValue>;
  public handlers: Map<string, AgentHandlerFn>;
  public name:     string;
  public id:       string;

  constructor(name: string, state: Map<string, AxonValue>, handlers: Map<string, AgentHandlerFn>) {
    this.name     = name;
    this.id       = `${name}#${Math.random().toString(36).slice(2, 8)}`;
    this.state    = state;
    this.handlers = handlers;
  }

  send(type: string, args: AxonValue[]): void {
    this.enqueue(type, args).catch(() => {}); // fire-and-forget
  }

  ask(type: string, args: AxonValue[]): Promise<AxonValue> {
    return this.enqueue(type, args);
  }

  private enqueue(type: string, args: AxonValue[]): Promise<AxonValue> {
    return new Promise<AxonValue>((resolve, reject) => {
      this.queue.push({ type, args, resolve, reject });
      this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const msg = this.queue.shift()!;
      try {
        const handler = this.handlers.get(msg.type);
        if (!handler) {
          msg.reject(new Error(`Agent ${this.name}: unknown message type '${msg.type}'`));
          continue;
        }
        const result = await handler(this.state, msg.args);
        msg.resolve(result);
      } catch (e) {
        msg.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    this.processing = false;
  }
}

export type AgentHandlerFn = (state: Map<string, AxonValue>, args: AxonValue[]) => Promise<AxonValue>;

// ─── Value display ───────────────────────────────────────────

export function displayValue(v: AxonValue): string {
  switch (v.tag) {
    case ValueTag.Int:     return v.value.toString();
    case ValueTag.Float: {
      const s = v.value.toString();
      return s.includes('.') ? s : s + '.0';
    }
    case ValueTag.Bool:    return v.value ? 'true' : 'false';
    case ValueTag.String:  return v.value;
    case ValueTag.Char:    return v.value;
    case ValueTag.Unit:    return '()';
    case ValueTag.List:    return `[${v.items.map(displayValue).join(', ')}]`;
    case ValueTag.Tuple:   return `(${v.items.map(displayValue).join(', ')})`;
    case ValueTag.Record: {
      const fields = [...v.fields.entries()].map(([k, val]) => `${k}: ${debugValue(val)}`).join(', ');
      return v.typeName ? `${v.typeName} { ${fields} }` : `{ ${fields} }`;
    }
    case ValueTag.Enum: {
      if (v.fields.length === 0 && v.recordFields.size === 0) return v.variant;
      if (v.recordFields.size > 0) {
        const fields = [...v.recordFields.entries()].map(([k, val]) => `${k}: ${debugValue(val)}`).join(', ');
        return `${v.variant} { ${fields} }`;
      }
      return `${v.variant}(${v.fields.map(displayValue).join(', ')})`;
    }
    case ValueTag.Function:      return `<fn ${v.name}>`;
    case ValueTag.NativeFn:      return `<native ${v.name}>`;
    case ValueTag.AsyncNativeFn: return `<native ${v.name}>`;
    case ValueTag.Agent:     return `<agent ${v.ref.id}>`;
    case ValueTag.Never:     return '!';
  }
}

export function debugValue(v: AxonValue): string {
  if (v.tag === ValueTag.String) return `"${v.value.replace(/"/g, '\\"')}"`;
  if (v.tag === ValueTag.Char)   return `'${v.value}'`;
  return displayValue(v);
}

// ─── Type coercions (for operations) ─────────────────────────

export function coerceToNumber(v: AxonValue): number {
  if (v.tag === ValueTag.Int)   return Number(v.value);
  if (v.tag === ValueTag.Float) return v.value;
  throw new RuntimeError(`Expected number, got ${displayValue(v)}`);
}

export function coerceToBool(v: AxonValue): boolean {
  if (v.tag === ValueTag.Bool) return v.value;
  // Truthy coercion
  if (v.tag === ValueTag.Int)  return v.value !== 0n;
  if (v.tag === ValueTag.Enum && v.variant === 'None') return false;
  return true;
}

export function valuesEqual(a: AxonValue, b: AxonValue): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case ValueTag.Int:    return a.value === (b as typeof a).value;
    case ValueTag.Float:  return a.value === (b as typeof a).value;
    case ValueTag.Bool:   return a.value === (b as typeof a).value;
    case ValueTag.String: return a.value === (b as typeof a).value;
    case ValueTag.Char:   return a.value === (b as typeof a).value;
    case ValueTag.Unit:   return true;
    case ValueTag.List: {
      const bl = b as typeof a;
      if (a.items.length !== bl.items.length) return false;
      return a.items.every((item, i) => valuesEqual(item, bl.items[i]));
    }
    case ValueTag.Tuple: {
      const bt = b as typeof a;
      if (a.items.length !== bt.items.length) return false;
      return a.items.every((item, i) => valuesEqual(item, bt.items[i]));
    }
    case ValueTag.Enum: {
      const be = b as typeof a;
      if (a.variant !== be.variant) return false;
      if (a.fields.length !== be.fields.length) return false;
      return a.fields.every((f, i) => valuesEqual(f, be.fields[i]));
    }
    case ValueTag.Record: {
      const br = b as typeof a;
      if (a.typeName !== br.typeName) return false;
      if (a.fields.size !== br.fields.size) return false;
      for (const [k, v] of a.fields) {
        const bv = br.fields.get(k);
        if (!bv || !valuesEqual(v, bv)) return false;
      }
      return true;
    }
    default: return false;
  }
}

// ─── Signal classes for control flow ─────────────────────────

export class ReturnSignal {
  constructor(public value: AxonValue) {}
}
export class BreakSignal {
  constructor(public value: AxonValue) {}
}
export class ContinueSignal {}
export class TrySignal {
  constructor(public value: AxonValue) {}  // carries Err value
}
export class RuntimeError extends Error {
  constructor(msg: string, public span?: { line: number; col: number }) {
    super(msg);
    this.name = 'RuntimeError';
  }
}
