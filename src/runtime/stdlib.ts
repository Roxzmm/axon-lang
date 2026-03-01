// ============================================================
// Axon Language — Standard Library (Built-in Functions)
// ============================================================

import {
  AxonValue, ValueTag, mkInt, mkFloat, mkString, mkBool, mkList, mkTuple,
  mkRecord, mkEnum, mkNative, mkOk, mkErr, mkSome, mkNone,
  UNIT, TRUE, FALSE, displayValue, debugValue, valuesEqual, RuntimeError,
} from './value';
import type { Environment } from './env';

type NativeFn = (...args: AxonValue[]) => AxonValue;

function native(name: string, fn: NativeFn): AxonValue {
  return mkNative(name, fn);
}

function assertTag(v: AxonValue, tag: ValueTag, fnName: string): void {
  if (v.tag !== tag) throw new RuntimeError(`${fnName}: expected ${tag}, got ${v.tag}`);
}

// Type-narrowing helpers
function asStr(v: AxonValue, fn: string): string {
  assertTag(v, ValueTag.String, fn); return (v as Extract<AxonValue, { tag: ValueTag.String }>).value;
}
function asList(v: AxonValue, fn: string): AxonValue[] {
  assertTag(v, ValueTag.List, fn); return (v as Extract<AxonValue, { tag: ValueTag.List }>).items;
}
function asInt(v: AxonValue, fn: string): bigint {
  if (v.tag !== ValueTag.Int) throw new RuntimeError(`${fn}: expected Int, got ${v.tag}`);
  return (v as Extract<AxonValue, { tag: ValueTag.Int }>).value;
}
function asAny(v: AxonValue): any { return v as any; }

function toNum(v: AxonValue, fn: string): number {
  if (v.tag === ValueTag.Int)   return Number(v.value);
  if (v.tag === ValueTag.Float) return v.value;
  throw new RuntimeError(`${fn}: expected number, got ${v.tag}`);
}

function compareValues(a: AxonValue, b: AxonValue): number {
  if (a.tag === ValueTag.Int && b.tag === ValueTag.Int) {
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  if ((a.tag === ValueTag.Int || a.tag === ValueTag.Float) &&
      (b.tag === ValueTag.Int || b.tag === ValueTag.Float)) {
    const an = toNum(a, 'compare'), bn = toNum(b, 'compare');
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  if (a.tag === ValueTag.String && b.tag === ValueTag.String) {
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  if (a.tag === ValueTag.Bool && b.tag === ValueTag.Bool) {
    return (a.value ? 1 : 0) - (b.value ? 1 : 0);
  }
  return 0;
}

// ─── IO ──────────────────────────────────────────────────────

const ioFns: Record<string, NativeFn> = {
  print:   (...args) => { console.log(args.map(displayValue).join(' ')); return UNIT; },
  println: (...args) => { console.log(args.map(displayValue).join(' ')); return UNIT; },
  eprint:  (...args) => { console.error(args.map(displayValue).join(' ')); return UNIT; },
  str:     (v)       => mkString(displayValue(v)),
  debug:   (v)       => mkString(debugValue(v)),
  repr:    (v)       => { console.log(debugValue(v)); return UNIT; },
};

// ─── Type Conversions ────────────────────────────────────────

const convFns: Record<string, NativeFn> = {
  int: (v) => {
    if (v.tag === ValueTag.Int)    return v;
    if (v.tag === ValueTag.Float)  return mkInt(Math.trunc(v.value));
    if (v.tag === ValueTag.String) {
      const n = parseInt(v.value, 10);
      if (isNaN(n)) throw new RuntimeError(`int: cannot parse "${v.value}"`);
      return mkInt(n);
    }
    if (v.tag === ValueTag.Bool)   return mkInt(v.value ? 1 : 0);
    throw new RuntimeError(`int: cannot convert ${v.tag}`);
  },
  float: (v) => {
    if (v.tag === ValueTag.Float)  return v;
    if (v.tag === ValueTag.Int)    return mkFloat(Number(v.value));
    if (v.tag === ValueTag.String) {
      const n = parseFloat(v.value);
      if (isNaN(n)) throw new RuntimeError(`float: cannot parse "${v.value}"`);
      return mkFloat(n);
    }
    throw new RuntimeError(`float: cannot convert ${v.tag}`);
  },
  bool: (v) => {
    if (v.tag === ValueTag.Bool) return v;
    if (v.tag === ValueTag.Int)  return mkBool(v.value !== 0n);
    return TRUE;
  },
  string: (v) => mkString(displayValue(v)),
  char:   (v) => {
    if (v.tag === ValueTag.String && v.value.length === 1) return { tag: ValueTag.Char, value: v.value };
    throw new RuntimeError(`char: need single-char string`);
  },
};

// ─── Math ────────────────────────────────────────────────────

const mathFns: Record<string, NativeFn> = {
  abs:   (v) => v.tag === ValueTag.Int ? mkInt(v.value < 0n ? -v.value : v.value) : mkFloat(Math.abs(toNum(v, 'abs'))),
  sqrt:  (v) => mkFloat(Math.sqrt(toNum(v, 'sqrt'))),
  floor: (v) => mkFloat(Math.floor(toNum(v, 'floor'))),
  ceil:  (v) => mkFloat(Math.ceil(toNum(v, 'ceil'))),
  round: (v) => mkFloat(Math.round(toNum(v, 'round'))),
  pow:   (a, b) => {
    if (a.tag === ValueTag.Int && b.tag === ValueTag.Int && b.value >= 0n) return mkInt(a.value ** b.value);
    return mkFloat(Math.pow(toNum(a, 'pow'), toNum(b, 'pow')));
  },
  min:   (a, b) => compareValues(a, b) <= 0 ? a : b,
  max:   (a, b) => compareValues(a, b) >= 0 ? a : b,
  clamp: (v, lo, hi) => compareValues(v, lo) < 0 ? lo : compareValues(v, hi) > 0 ? hi : v,
  log:   (v) => mkFloat(Math.log(toNum(v, 'log'))),
  log2:  (v) => mkFloat(Math.log2(toNum(v, 'log2'))),
  sin:   (v) => mkFloat(Math.sin(toNum(v, 'sin'))),
  cos:   (v) => mkFloat(Math.cos(toNum(v, 'cos'))),
  PI:    ()  => mkFloat(Math.PI),
  E:     ()  => mkFloat(Math.E),
};

// ─── String operations ───────────────────────────────────────

const stringFns: Record<string, NativeFn> = {
  len:        (v) => mkInt(asStr(v, 'len').length),
  upper:      (v) => mkString(asStr(v, 'upper').toUpperCase()),
  lower:      (v) => mkString(asStr(v, 'lower').toLowerCase()),
  trim:       (v) => mkString(asStr(v, 'trim').trim()),
  trim_start: (v) => mkString(asStr(v, 'trim_start').trimStart()),
  trim_end:   (v) => mkString(asStr(v, 'trim_end').trimEnd()),
  contains:   (v, s) => mkBool(asStr(v, 'contains').includes(asStr(s, 'contains'))),
  starts_with:(v, s) => mkBool(asStr(v, 'starts_with').startsWith(asStr(s, 'starts_with'))),
  ends_with:  (v, s) => mkBool(asStr(v, 'ends_with').endsWith(asStr(s, 'ends_with'))),
  split:      (v, sep) => mkList(asStr(v, 'split').split(asStr(sep, 'split')).map(mkString)),
  join:       (list, sep) => mkString(asList(list, 'join').map(displayValue).join(asStr(sep, 'join'))),
  replace:    (v, from, to) => {
    const s = asStr(v, 'replace');
    const f = asStr(from, 'replace'); const t = asStr(to, 'replace');
    return mkString(s.split(f).join(t));
  },
  slice:      (v, start, end) => {
    const s2 = asStr(v, 'slice');
    const s = Number(asAny(start).value);
    const e = end ? Number(asAny(end).value) : undefined;
    return mkString(s2.slice(s, e));
  },
  char_at:    (v, i) => {
    const s = asStr(v, 'char_at');
    const idx = Number(asAny(i).value);
    const ch  = s[idx];
    return ch !== undefined ? mkSome({ tag: ValueTag.Char, value: ch }) : mkNone();
  },
  chars:      (v) => mkList([...asStr(v, 'chars')].map(c => ({ tag: ValueTag.Char as const, value: c }))),
  parse_int:  (v) => {
    const s = asStr(v, 'parse_int');
    const n = parseInt(s, 10);
    return isNaN(n) ? mkErr(mkString(`Cannot parse "${s}" as Int`)) : mkOk(mkInt(n));
  },
  parse_float: (v) => {
    const s = asStr(v, 'parse_float');
    const n = parseFloat(s);
    return isNaN(n) ? mkErr(mkString(`Cannot parse "${s}" as Float`)) : mkOk(mkFloat(n));
  },
  repeat:     (v, n) => mkString(asStr(v, 'repeat').repeat(Number(asAny(n).value))),
  lines:      (v) => mkList(asStr(v, 'lines').split('\n').map(mkString)),
};

// ─── List operations ─────────────────────────────────────────

const listFns: Record<string, NativeFn> = {
  list_len:    (v) => mkInt(asList(v, 'len').length),
  list_is_empty: (v) => mkBool(asList(v, 'is_empty').length === 0),
  list_head:   (v) => { const it = asList(v, 'head'); return it.length > 0 ? mkSome(it[0]) : mkNone(); },
  list_tail:   (v) => { const it = asList(v, 'tail'); return it.length > 0 ? mkList(it.slice(1)) : mkNone(); },
  list_last:   (v) => { const it = asList(v, 'last'); return it.length > 0 ? mkSome(it[it.length - 1]) : mkNone(); },
  list_get:    (v, i) => {
    const it = asList(v, 'get'); const idx = Number(asAny(i).value);
    return idx < it.length ? mkSome(it[idx]) : mkNone();
  },
  list_take:   (v, n) => mkList(asList(v, 'take').slice(0, Number(asAny(n).value))),
  list_drop:   (v, n) => mkList(asList(v, 'drop').slice(Number(asAny(n).value))),
  list_prepend:(item, v) => mkList([item, ...asList(v, 'prepend')]),
  list_append: (v, item) => mkList([...asList(v, 'append'), item]),
  list_concat: (a, b) => mkList([...asList(a, 'concat'), ...asList(b, 'concat')]),
  list_reverse:(v) => mkList([...asList(v, 'reverse')].reverse()),
  list_contains:(v, item) => mkBool(asList(v, 'contains').some(i => valuesEqual(i, item))),
  list_sum:    (v) => {
    const it = asList(v, 'sum');
    if (it.length === 0) return mkInt(0);
    if (it[0].tag === ValueTag.Float) return mkFloat(it.reduce((s, i) => s + toNum(i, 'sum'), 0));
    return mkInt(it.reduce((s, i) => s + asAny(i).value, 0n));
  },
  list_zip:    (a, b) => {
    const al = asList(a, 'zip'), bl = asList(b, 'zip');
    return mkList(Array.from({ length: Math.min(al.length, bl.length) }, (_, i) => mkTuple([al[i], bl[i]])));
  },
  list_flatten:(v) => {
    const result: AxonValue[] = [];
    for (const i of asList(v, 'flatten')) {
      if (i.tag === ValueTag.List) result.push(...i.items); else result.push(i);
    }
    return mkList(result);
  },
  list_unique: (v) => {
    const seen: AxonValue[] = [];
    for (const item of asList(v, 'unique')) {
      if (!seen.some(s => valuesEqual(s, item))) seen.push(item);
    }
    return mkList(seen);
  },
  list_range:  (lo, hi) => {
    const l = Number(asAny(lo).value), h = Number(asAny(hi).value);
    return mkList(Array.from({ length: Math.max(0, h - l) }, (_, i) => mkInt(l + i)));
  },
  list_range_inclusive: (lo, hi) => {
    const l = Number(asAny(lo).value), h = Number(asAny(hi).value);
    return mkList(Array.from({ length: Math.max(0, h - l + 1) }, (_, i) => mkInt(l + i)));
  },
  list_enumerate: (v) => mkList(asList(v, 'enumerate').map((item, i) => mkTuple([mkInt(i), item]))),
  list_from:   (v) => v,
};

// Higher-order list functions (need interpreter callback)
// These are registered by the interpreter directly.

// ─── Map operations ──────────────────────────────────────────

const mapFns: Record<string, NativeFn> = {
  map_empty:  ()      => mkRecord('Map', {}),
  map_new:    (entries) => {
    if (entries.tag !== ValueTag.List) throw new RuntimeError('Map.from: expected list');
    const fields = new Map<string, AxonValue>();
    for (const entry of entries.items) {
      if (entry.tag !== ValueTag.Tuple || entry.items.length !== 2)
        throw new RuntimeError('Map.from: each entry must be a 2-tuple');
      const key = displayValue(entry.items[0]);
      fields.set(key, entry.items[1]);
    }
    return { tag: ValueTag.Record, typeName: 'Map', fields } as AxonValue;
  },
  map_get:    (m, k) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.get: expected map');
    const key = displayValue(k);
    const val = m.fields.get(key);
    return val !== undefined ? mkSome(val) : mkNone();
  },
  map_insert: (m, k, v) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.insert: expected map');
    const newFields = new Map(m.fields);
    newFields.set(displayValue(k), v);
    return { tag: ValueTag.Record, typeName: 'Map', fields: newFields } as AxonValue;
  },
  map_remove: (m, k) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.remove: expected map');
    const newFields = new Map(m.fields);
    newFields.delete(displayValue(k));
    return { tag: ValueTag.Record, typeName: 'Map', fields: newFields } as AxonValue;
  },
  map_has:    (m, k) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.has: expected map');
    return mkBool(m.fields.has(displayValue(k)));
  },
  map_len:    (m) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.len: expected map');
    return mkInt(m.fields.size);
  },
  map_keys:   (m) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.keys: expected map');
    return mkList([...m.fields.keys()].map(mkString));
  },
  map_values: (m) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.values: expected map');
    return mkList([...m.fields.values()]);
  },
  map_entries:(m) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.entries: expected map');
    return mkList([...m.fields.entries()].map(([k, v]) => mkTuple([mkString(k), v])));
  },
  map_is_empty:(m) => {
    if (m.tag !== ValueTag.Record) throw new RuntimeError('Map.is_empty: expected map');
    return mkBool(m.fields.size === 0);
  },
};

// ─── Option operations ───────────────────────────────────────

const optionFns: Record<string, NativeFn> = {
  option_is_some: (v) => mkBool(v.tag === ValueTag.Enum && v.variant === 'Some'),
  option_is_none: (v) => mkBool(v.tag === ValueTag.Enum && v.variant === 'None'),
  option_unwrap:  (v) => {
    if (v.tag === ValueTag.Enum && v.variant === 'Some') return v.fields[0];
    throw new RuntimeError('option_unwrap: called on None');
  },
  option_unwrap_or: (v, def) => {
    if (v.tag === ValueTag.Enum && v.variant === 'Some') return v.fields[0];
    return def;
  },
  option_ok_or: (v, err) => {
    if (v.tag === ValueTag.Enum && v.variant === 'Some') return mkOk(v.fields[0]);
    return mkErr(err);
  },
};

// ─── Result operations ───────────────────────────────────────

const resultFns: Record<string, NativeFn> = {
  result_is_ok:  (v) => mkBool(v.tag === ValueTag.Enum && v.variant === 'Ok'),
  result_is_err: (v) => mkBool(v.tag === ValueTag.Enum && v.variant === 'Err'),
  result_unwrap: (v) => {
    if (v.tag === ValueTag.Enum && v.variant === 'Ok') return v.fields[0];
    const e = v.tag === ValueTag.Enum ? displayValue(v.fields[0]) : 'unknown';
    throw new RuntimeError(`result_unwrap: called on Err(${e})`);
  },
  result_unwrap_or: (v, def) => {
    if (v.tag === ValueTag.Enum && v.variant === 'Ok') return v.fields[0];
    return def;
  },
  result_unwrap_err: (v) => {
    if (v.tag === ValueTag.Enum && v.variant === 'Err') return v.fields[0];
    throw new RuntimeError('result_unwrap_err: called on Ok');
  },
};

// ─── Comparison ──────────────────────────────────────────────

const cmpFns: Record<string, NativeFn> = {
  compare: (a, b) => {
    const c = compareValues(a, b);
    return mkEnum('Ordering', c < 0 ? 'Less' : c > 0 ? 'Greater' : 'Equal');
  },
  min_val: (a, b) => compareValues(a, b) <= 0 ? a : b,
  max_val: (a, b) => compareValues(a, b) >= 0 ? a : b,
};

// ─── Random ──────────────────────────────────────────────────

const randomFns: Record<string, NativeFn> = {
  random:      () => mkFloat(Math.random()),
  random_int:  (lo, hi) => {
    const l = Number((lo as any).value), h = Number((hi as any).value);
    return mkInt(l + Math.floor(Math.random() * (h - l + 1)));
  },
  random_bool: () => mkBool(Math.random() >= 0.5),
};

// ─── Time ────────────────────────────────────────────────────

const timeFns: Record<string, NativeFn> = {
  now_ms:    () => mkInt(Date.now()),
  now_s:     () => mkFloat(Date.now() / 1000),
  timestamp: () => mkString(new Date().toISOString()),
};

// ─── File IO (sync, for demo purposes) ───────────────────────

const ioFileFns: Record<string, NativeFn> = {
  read_file: (path) => {
    const p = asStr(path, 'read_file');
    try {
      const fs = require('fs') as typeof import('fs');
      return mkOk(mkString(fs.readFileSync(p, 'utf-8')));
    } catch (e) { return mkErr(mkString(String(e))); }
  },
  write_file: (path, content) => {
    const p = asStr(path, 'write_file'); const c = asStr(content, 'write_file');
    try {
      const fs = require('fs') as typeof import('fs');
      fs.writeFileSync(p, c, 'utf-8'); return mkOk(UNIT);
    } catch (e) { return mkErr(mkString(String(e))); }
  },
  file_exists: (path) => {
    const p = asStr(path, 'file_exists');
    const fs = require('fs') as typeof import('fs');
    return mkBool(fs.existsSync(p));
  },
};

// ─── UUID / ID generation ─────────────────────────────────────

const utilFns: Record<string, NativeFn> = {
  uuid: () => {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return mkString(`${hex()}${hex()}${hex()}${hex()}-${hex()}${hex()}-4${hex().slice(1)}-${((Math.floor(Math.random() * 4) + 8) * 16).toString(16)[0]}${hex().slice(1)}-${hex()}${hex()}${hex()}${hex()}${hex()}${hex()}`);
  },
  type_of: (v) => {
    const tags: Record<string, string> = {
      [ValueTag.Int]: 'Int', [ValueTag.Float]: 'Float', [ValueTag.Bool]: 'Bool',
      [ValueTag.String]: 'String', [ValueTag.Char]: 'Char', [ValueTag.Unit]: 'Unit',
      [ValueTag.List]: 'List', [ValueTag.Tuple]: 'Tuple',
      [ValueTag.Record]: v.tag === ValueTag.Record ? v.typeName || 'Record' : 'Record',
      [ValueTag.Enum]: v.tag === ValueTag.Enum ? v.typeName || 'Enum' : 'Enum',
      [ValueTag.Function]: 'Function', [ValueTag.NativeFn]: 'Function',
      [ValueTag.Agent]: 'Agent',
    };
    return mkString(tags[v.tag] || 'Unknown');
  },
  panic: (msg) => {
    throw new RuntimeError(`panic: ${displayValue(msg)}`);
  },
  assert: (cond, msg) => {
    if (cond.tag !== ValueTag.Bool || !cond.value) {
      throw new RuntimeError(`Assertion failed: ${msg ? displayValue(msg) : 'assertion failed'}`);
    }
    return UNIT;
  },
  exit: (code) => {
    process.exit(code?.tag === ValueTag.Int ? Number(code.value) : 0);
  },
};

// ─── Register all stdlib functions ───────────────────────────

export function registerStdlib(env: Environment, define: (name: string, val: AxonValue) => void): void {
  const all = { ...ioFns, ...convFns, ...mathFns, ...stringFns, ...listFns,
                ...mapFns, ...optionFns, ...resultFns, ...cmpFns, ...randomFns,
                ...timeFns, ...ioFileFns, ...utilFns };

  for (const [name, fn] of Object.entries(all)) {
    define(name, native(name, fn));
  }

  // Constants
  define('PI',       mkFloat(Math.PI));
  define('E',        mkFloat(Math.E));
  define('MAX_INT',  mkInt(BigInt(Number.MAX_SAFE_INTEGER)));
  define('MIN_INT',  mkInt(BigInt(Number.MIN_SAFE_INTEGER)));
  define('true',     TRUE);
  define('false',    FALSE);
  define('unit',     UNIT);
}
