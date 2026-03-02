// ============================================================
// Axon Language — Standard Library (Built-in Functions)
// ============================================================

import {
  AxonValue, ValueTag, mkInt, mkFloat, mkString, mkBool, mkList, mkTuple,
  mkRecord, mkEnum, mkNative, mkNativeAsync, mkOk, mkErr, mkSome, mkNone,
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
  floor: (v) => mkInt(Math.floor(toNum(v, 'floor'))),
  ceil:  (v) => mkInt(Math.ceil(toNum(v, 'ceil'))),
  round: (v) => mkInt(Math.round(toNum(v, 'round'))),
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
  tan:   (v) => mkFloat(Math.tan(toNum(v, 'tan'))),
  PI:    ()  => mkFloat(Math.PI),
  E:     ()  => mkFloat(Math.E),
};

// ─── String operations ───────────────────────────────────────

const stringFns: Record<string, NativeFn> = {
  len:        (v) => {
    if (v.tag === ValueTag.String) return mkInt(v.value.length);
    if (v.tag === ValueTag.List)   return mkInt(v.items.length);
    if (v.tag === ValueTag.Tuple)  return mkInt(v.items.length);
    throw new RuntimeError(`len: expected String, List, or Tuple, got ${v.tag}`);
  },
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
  list_from: (v, start) => {
    const items = asList(v, 'from');
    const s = Number((start as any)?.value ?? 0n);
    return mkList(items.slice(s));
  },
  // Tuple operations
  tuple_get: (t, i) => {
    if (t.tag !== ValueTag.Tuple) throw new RuntimeError('tuple_get: expected tuple');
    const idx = Number((i as any).value ?? 0n);
    return t.items[idx] ?? mkNone();
  },
  tuple_len: (t) => {
    if (t.tag !== ValueTag.Tuple) throw new RuntimeError('tuple_len: expected tuple');
    return mkInt(t.items.length);
  },
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

// ─── JSON helpers ─────────────────────────────────────────────

export function jsToAxon(v: any): AxonValue {
  if (v === null || v === undefined) return mkNone();
  if (typeof v === 'boolean') return mkBool(v);
  if (typeof v === 'number') {
    return Number.isInteger(v) ? mkInt(v) : mkFloat(v);
  }
  if (typeof v === 'string') return mkString(v);
  if (Array.isArray(v)) return mkList(v.map(jsToAxon));
  if (typeof v === 'object') {
    const fields = new Map<string, AxonValue>();
    for (const [k, val] of Object.entries(v)) fields.set(k, jsToAxon(val));
    return { tag: ValueTag.Record, typeName: 'Map', fields } as AxonValue;
  }
  return UNIT;
}

export function axonToJs(v: AxonValue): any {
  switch (v.tag) {
    case ValueTag.Int:    return Number(v.value);
    case ValueTag.Float:  return v.value;
    case ValueTag.Bool:   return v.value;
    case ValueTag.String: return v.value;
    case ValueTag.Unit:   return null;
    case ValueTag.List:   return v.items.map(axonToJs);
    case ValueTag.Tuple:  return v.items.map(axonToJs);
    case ValueTag.Record: {
      const obj: Record<string, any> = {};
      for (const [k, val] of v.fields) obj[k] = axonToJs(val);
      return obj;
    }
    case ValueTag.Enum: {
      if (v.variant === 'None') return null;
      if (v.variant === 'Some') return axonToJs(v.fields[0]);
      if (v.variant === 'Ok')   return axonToJs(v.fields[0]);
      return { variant: v.variant, fields: v.fields.map(axonToJs) };
    }
    default: return displayValue(v);
  }
}

const jsonFns: Record<string, NativeFn> = {
  json_parse: (s) => {
    const str = asStr(s, 'json_parse');
    try {
      return mkOk(jsToAxon(JSON.parse(str)));
    } catch (e) {
      return mkErr(mkString(String(e)));
    }
  },
  json_stringify: (v) => {
    try { return mkString(JSON.stringify(axonToJs(v))); }
    catch (e) { throw new RuntimeError(`json_stringify: ${e}`); }
  },
  json_stringify_pretty: (v) => {
    try { return mkString(JSON.stringify(axonToJs(v), null, 2)); }
    catch (e) { throw new RuntimeError(`json_stringify_pretty: ${e}`); }
  },
  json_get: (obj, key) => {
    const k = asStr(key, 'json_get');
    if (obj.tag === ValueTag.Record) {
      const val = obj.fields.get(k);
      return val !== undefined ? mkSome(val) : mkNone();
    }
    return mkNone();
  },
};

// ─── Environment / process ────────────────────────────────────

const envFns: Record<string, NativeFn> = {
  env_get: (name) => {
    const val = process.env[asStr(name, 'env_get')];
    return val !== undefined ? mkSome(mkString(val)) : mkNone();
  },
  env_set: (name, value) => {
    process.env[asStr(name, 'env_set')] = asStr(value, 'env_set');
    return UNIT;
  },
  env_all: () => {
    const fields = new Map<string, AxonValue>();
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) fields.set(k, mkString(v));
    }
    return { tag: ValueTag.Record, typeName: 'Map', fields } as AxonValue;
  },
  args: () => mkList(process.argv.slice(2).map(mkString)),
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
      const label = msg ? displayValue(msg) : 'assertion failed';
      throw new RuntimeError(`Assertion failed: ${label}`);
    }
    return UNIT;
  },
  assert_eq: (a, b, msg) => {
    if (!valuesEqual(a, b)) {
      const label = msg ? ` (${displayValue(msg)})` : '';
      throw new RuntimeError(`assert_eq failed${label}: expected ${displayValue(a)}, got ${displayValue(b)}`);
    }
    return UNIT;
  },
  assert_ne: (a, b, msg) => {
    if (valuesEqual(a, b)) {
      const label = msg ? ` (${displayValue(msg)})` : '';
      throw new RuntimeError(`assert_ne failed${label}: both equal ${displayValue(a)}`);
    }
    return UNIT;
  },
  exit: (code) => {
    process.exit(code?.tag === ValueTag.Int ? Number(code.value) : 0);
  },
};

// ─── HTTP helper (Node.js built-in, no external deps) ─────────

export function httpRequest(url: string, method: string, body?: string, contentType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let urlObj: URL;
    try { urlObj = new URL(url); } catch (e) { reject(new Error(`Invalid URL: ${url}`)); return; }

    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? require('https') : require('http');
    const options: any = {
      hostname: urlObj.hostname,
      port: urlObj.port ? parseInt(urlObj.port) : (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {} as Record<string, string>,
    };
    if (contentType) options.headers['Content-Type'] = contentType;
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body).toString();

    const req = mod.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (e: Error) => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

// ─── Tool Registry access (populated by interpreter for #[tool] fns) ────

// Shared tool registry — interpreter writes to this Map, stdlib reads from it
export const toolRegistry = new Map<string, {
  name: string;
  description: string;
  parameters: Record<string, any>;
  fn?: AxonValue;   // set by interpreter when #[tool] fn is registered
}>();

// ─── Register all stdlib functions ───────────────────────────

export function registerStdlib(env: Environment, define: (name: string, val: AxonValue) => void): void {
  const all = { ...ioFns, ...convFns, ...mathFns, ...stringFns, ...listFns,
                ...mapFns, ...optionFns, ...resultFns, ...cmpFns, ...randomFns,
                ...timeFns, ...ioFileFns, ...utilFns, ...jsonFns, ...envFns };

  for (const [name, fn] of Object.entries(all)) {
    define(name, native(name, fn));
  }

  // ── Async HTTP functions ───────────────────────────────────
  define('http_get', mkNativeAsync('http_get', async (urlVal) => {
    const url = asStr(urlVal, 'http_get');
    try {
      const body = await httpRequest(url, 'GET');
      return mkOk(mkString(body));
    } catch (e) { return mkErr(mkString(String(e))); }
  }));

  define('http_post', mkNativeAsync('http_post', async (urlVal, bodyVal, ctVal) => {
    const url  = asStr(urlVal, 'http_post');
    const body = asStr(bodyVal, 'http_post');
    const ct   = ctVal && ctVal.tag === ValueTag.String ? ctVal.value : 'application/json';
    try {
      const resp = await httpRequest(url, 'POST', body, ct);
      return mkOk(mkString(resp));
    } catch (e) { return mkErr(mkString(String(e))); }
  }));

  define('http_get_json', mkNativeAsync('http_get_json', async (urlVal) => {
    const url = asStr(urlVal, 'http_get_json');
    try {
      const body = await httpRequest(url, 'GET');
      return mkOk(jsToAxon(JSON.parse(body)));
    } catch (e) { return mkErr(mkString(String(e))); }
  }));

  // ── Tool registry functions ────────────────────────────────
  define('tool_list', mkNative('tool_list', () => {
    return mkList([...toolRegistry.keys()].map(mkString));
  }));

  define('tool_schema', mkNative('tool_schema', (nameVal) => {
    const name = asStr(nameVal, 'tool_schema');
    const tool = toolRegistry.get(name);
    if (!tool) return mkNone();
    // Convert schema to Axon Map
    const fields = new Map<string, AxonValue>();
    fields.set('name',        mkString(tool.name));
    fields.set('description', mkString(tool.description));
    fields.set('parameters',  jsToAxon(tool.parameters));
    return mkSome({ tag: ValueTag.Record, typeName: 'Map', fields } as AxonValue);
  }));

  // ── LLM with tools ─────────────────────────────────────────
  define('llm_call_with_tools', mkNativeAsync('llm_call_with_tools', async (promptVal, toolNamesVal, modelVal) => {
    const prompt    = asStr(promptVal, 'llm_call_with_tools');
    const model     = modelVal && modelVal.tag === ValueTag.String ? modelVal.value : 'claude-haiku-4-5-20251001';
    const apiKey    = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return mkErr(mkString('llm_call_with_tools: ANTHROPIC_API_KEY not set'));

    // Collect tool names
    const toolNames: string[] = [];
    if (toolNamesVal && toolNamesVal.tag === ValueTag.List) {
      for (const t of toolNamesVal.items) {
        if (t.tag === ValueTag.String) toolNames.push(t.value);
      }
    }

    // Build tool definitions for Anthropic API
    const tools = toolNames
      .map(n => toolRegistry.get(n))
      .filter(Boolean)
      .map(t => ({
        name:         t!.name,
        description:  t!.description,
        input_schema: t!.parameters,
      }));

    try {
      const reqBody = JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }], tools });
      const result = await new Promise<string>((resolve, reject) => {
        const https = require('https');
        const options = {
          hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
          headers: {
            'Content-Type': 'application/json', 'x-api-key': apiKey,
            'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(reqBody),
          },
        };
        const req = https.request(options, (res: any) => {
          let data = ''; res.on('data', (c: any) => { data += c; }); res.on('end', () => resolve(data));
        });
        req.on('error', (e: Error) => reject(e));
        req.write(reqBody); req.end();
      });
      const resp: any = JSON.parse(result);
      if (resp.error) return mkErr(mkString(resp.error.message ?? String(resp.error)));

      // Return structured response: text content + tool_use blocks
      const blocks: AxonValue[] = [];
      for (const block of (resp.content ?? [])) {
        if (block.type === 'text') {
          const f = new Map<string, AxonValue>();
          f.set('type', mkString('text')); f.set('text', mkString(block.text));
          blocks.push({ tag: ValueTag.Record, typeName: 'Map', fields: f } as AxonValue);
        } else if (block.type === 'tool_use') {
          const f = new Map<string, AxonValue>();
          f.set('type', mkString('tool_use')); f.set('name', mkString(block.name));
          f.set('input', jsToAxon(block.input)); f.set('id', mkString(block.id));
          blocks.push({ tag: ValueTag.Record, typeName: 'Map', fields: f } as AxonValue);
        }
      }
      return mkOk(mkList(blocks));
    } catch (e) { return mkErr(mkString(String(e))); }
  }));

  // ── LLM function (Anthropic API via ANTHROPIC_API_KEY) ─────
  define('llm_call', mkNativeAsync('llm_call', async (promptVal, modelVal) => {
    const prompt = asStr(promptVal, 'llm_call');
    const model  = modelVal && modelVal.tag === ValueTag.String
      ? modelVal.value
      : 'claude-haiku-4-5-20251001';
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return mkErr(mkString('llm_call: ANTHROPIC_API_KEY not set'));

    try {
      const reqBody = JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      const result = await new Promise<string>((resolve, reject) => {
        const https = require('https');
        const options = {
          hostname: 'api.anthropic.com',
          port: 443,
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(reqBody),
          },
        };
        const req = https.request(options, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => { data += chunk; });
          res.on('end', () => resolve(data));
        });
        req.on('error', (e: Error) => reject(e));
        req.write(reqBody);
        req.end();
      });
      const resp: any = JSON.parse(result);
      if (resp.error) return mkErr(mkString(resp.error.message ?? String(resp.error)));
      return mkOk(mkString(resp.content?.[0]?.text ?? ''));
    } catch (e) { return mkErr(mkString(String(e))); }
  }));

  // ── Structured LLM output ──────────────────────────────────
  define('llm_structured', mkNativeAsync('llm_structured', async (promptVal, schemaVal, modelVal) => {
    const prompt   = asStr(promptVal, 'llm_structured');
    const model    = modelVal && modelVal.tag === ValueTag.String ? modelVal.value : 'claude-haiku-4-5-20251001';
    const schemaJs = axonToJs(schemaVal);
    const schemaStr = JSON.stringify(schemaJs, null, 2);
    const apiKey   = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return mkErr(mkString('llm_structured: ANTHROPIC_API_KEY not set'));

    const augmented = `${prompt}\n\nYou MUST respond with a JSON object matching this JSON Schema:\n\`\`\`json\n${schemaStr}\n\`\`\`\nReturn ONLY valid JSON — no prose, no code fences, just the raw JSON object.`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const reqBody = JSON.stringify({ model, max_tokens: 2048, messages: [{ role: 'user', content: augmented }] });
        const raw = await new Promise<string>((resolve, reject) => {
          const https = require('https');
          const opts2 = {
            hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
            headers: {
              'Content-Type': 'application/json', 'x-api-key': apiKey,
              'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(reqBody),
            },
          };
          const req = https.request(opts2, (res: any) => {
            let data = ''; res.on('data', (c: any) => { data += c; }); res.on('end', () => resolve(data));
          });
          req.on('error', (e: Error) => reject(e));
          req.write(reqBody); req.end();
        });
        const resp: any = JSON.parse(raw);
        if (resp.error) { if (attempt < 2) continue; return mkErr(mkString(resp.error.message)); }
        let text = resp.content?.[0]?.text ?? '';
        // Strip ```json ... ``` fences if present
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) text = fenceMatch[1].trim();
        else text = text.trim();
        return mkOk(jsToAxon(JSON.parse(text)));
      } catch (e) {
        if (attempt === 2) return mkErr(mkString(`llm_structured: ${e}`));
      }
    }
    return mkErr(mkString('llm_structured: all retry attempts failed'));
  }));

  // Constants
  define('PI',       mkFloat(Math.PI));
  define('E',        mkFloat(Math.E));
  define('MAX_INT',  mkInt(BigInt(Number.MAX_SAFE_INTEGER)));
  define('MIN_INT',  mkInt(BigInt(Number.MIN_SAFE_INTEGER)));
  define('true',     TRUE);
  define('false',    FALSE);
  define('unit',     UNIT);
}
