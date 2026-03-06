#!/usr/bin/env node
// ============================================================
// Axon Language — CLI Entry Point
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { parse, ParseError } from './parser';
import { LexError } from './lexer';
import { typeCheck, Diagnostic } from './checker';
import { Interpreter, ReplResult } from './interpreter';
import { HotReloadManager, createDefaultLogger } from './hot_reload';
import { RuntimeError, ValueTag, displayValue } from './runtime/value';

// ─── Colors ──────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function c(color: keyof typeof C, s: string): string {
  return `${C[color]}${s}${C.reset}`;
}

// ─── Banner ──────────────────────────────────────────────────

function printBanner(): void {
  console.log(c('cyan', c('bold', `
  ╔═══════════════════════════════════════╗
  ║   Axon Language Interpreter v0.5.1    ║
  ║   AI-Native Programming Language      ║
  ╚═══════════════════════════════════════╝`)));
  console.log();
}

// ─── Diagnostics display ─────────────────────────────────────

function printDiagnostics(diagnostics: Diagnostic[], source: string, file: string): void {
  const lines = source.split('\n');
  for (const d of diagnostics) {
    const color  = d.level === 'error' ? 'red' : 'yellow';
    const prefix = d.level === 'error' ? '✗ Error' : '⚠ Warning';
    console.error(`${C[color]}${C.bold}${prefix}${C.reset} at ${file}:${d.line}:${d.col}`);
    console.error(`  ${d.message}`);
    // Show context line
    const line = lines[d.line - 1];
    if (line !== undefined) {
      console.error(`  ${c('gray', `${d.line} |`)} ${line}`);
      console.error(`  ${' '.repeat(d.col + String(d.line).length + 2)}${C[color]}^${C.reset}`);
    }
    console.error();
  }
}

// ─── Run command ─────────────────────────────────────────────

async function runFile(filePath: string, opts: { watch?: boolean; typeCheck?: boolean; strictEffects?: boolean; trace?: boolean; traceFile?: string }): Promise<void> {
  const abs    = path.resolve(filePath);
  const source = fs.readFileSync(abs, 'utf-8');

  // Parse
  let program;
  try {
    program = parse(source, abs);
  } catch (e) {
    if (e instanceof ParseError) {
      const basename = path.basename(abs);
      console.error(c('red', c('bold', 'Parse error: ')) + e.message);
      console.error(c('gray', `  --> ${basename}:${e.line}:${e.col}`));
      const lines = source.split('\n');
      const lineStr = lines[e.line - 1];
      if (lineStr !== undefined) {
        const lineNo = String(e.line).padStart(4);
        console.error(c('gray', `${lineNo} │`) + ' ' + lineStr);
        console.error(c('gray', `     │`) + ' '.repeat(e.col) + c('red', '^'));
      }
    } else if (e instanceof LexError) {
      console.error(c('red', c('bold', 'Lex error: ')) + (e instanceof Error ? e.message : String(e)));
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  // Type check
  if (opts.typeCheck !== false) {
    const diagnostics = typeCheck(program, { strictEffects: opts.strictEffects });
    const errors      = diagnostics.filter(d => d.level === 'error');

    if (errors.length > 0) {
      printDiagnostics(errors, source, abs);
      console.error(c('red', `Found ${errors.length} error(s). Compilation failed.`));
      process.exit(1);
    }

    const warnings = diagnostics.filter(d => d.level === 'warning');
    if (warnings.length > 0) {
      printDiagnostics(warnings, source, abs);
    }

    if (diagnostics.length === 0) {
      console.log(c('green', '✓ Type check passed\n'));
    }
  }

  // Execute
  const interpreter = new Interpreter();
  if (opts.trace || opts.traceFile) {
    interpreter.enableTrace(opts.traceFile);
  }

  if (opts.watch) {
    console.log(c('cyan', `Starting in watch mode...`));
    console.log(c('gray', `Edit ${path.basename(abs)} to trigger hot reload\n`));

    const reloadOpts  = createDefaultLogger(true);
    const hotReloader = new HotReloadManager(interpreter, {
      ...reloadOpts,
      typeCheck: opts.typeCheck,
    });

    // Initial run
    try {
      await interpreter.execute(program, abs);
    } catch (e) {
      printRuntimeError(e, abs, source);
    }

    // Start watching
    hotReloader.watch(abs);

    // Keep alive
    process.stdin.resume();
    process.on('SIGINT', () => {
      console.log(c('yellow', '\nStopping hot reload watcher...'));
      hotReloader.stop();
      process.exit(0);
    });

  } else {
    try {
      await interpreter.execute(program, abs);
    } catch (e) {
      printRuntimeError(e, abs, source);
      process.exit(1);
    }
  }
}

// ─── Check command ───────────────────────────────────────────

async function checkFile(filePath: string): Promise<void> {
  const abs    = path.resolve(filePath);
  const source = fs.readFileSync(abs, 'utf-8');

  console.log(c('cyan', `Checking ${path.basename(abs)}...`));

  let program;
  try {
    program = parse(source, abs);
  } catch (e) {
    console.error(c('red', 'Parse error: ') + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  const diagnostics = typeCheck(program);
  if (diagnostics.length === 0) {
    console.log(c('green', '✓ No errors found'));
  } else {
    printDiagnostics(diagnostics, source, abs);
    const errors = diagnostics.filter(d => d.level === 'error');
    if (errors.length > 0) {
      console.error(c('red', `${errors.length} error(s) found`));
      process.exit(1);
    } else {
      console.log(c('yellow', `${diagnostics.length} warning(s) found`));
    }
  }
}

// ─── REPL helpers ────────────────────────────────────────────

function replValueType(v: any): string {
  switch (v.tag) {
    case ValueTag.Int:    return 'Int';
    case ValueTag.Float:  return 'Float';
    case ValueTag.Bool:   return 'Bool';
    case ValueTag.String: return 'String';
    case ValueTag.Unit:   return 'Unit';
    case ValueTag.List:   return 'List';
    case ValueTag.Tuple:  return 'Tuple';
    case ValueTag.Record: return 'Record';
    case ValueTag.Enum:   return v.typeName ?? 'Enum';
    case ValueTag.Agent:  return 'Agent';
    default:              return 'Fn';
  }
}

function printReplResult(result: ReplResult, interpreter: Interpreter): void {
  switch (result.kind) {
    case 'value':
      if (result.value.tag !== ValueTag.Unit) {
        const t = replValueType(result.value);
        console.log(c('green', '=> ') + c('yellow', t) + ' ' + displayValue(result.value));
        interpreter.globalEnv.define('_', result.value, true);
      }
      break;
    case 'let': {
      const mut = result.mutable ? c('blue', 'mut ') : '';
      const t   = replValueType(result.value);
      console.log(c('green', 'val ') + mut + c('bold', result.name) + ' : ' + c('yellow', t) + ' = ' + displayValue(result.value));
      interpreter.globalEnv.define('_', result.value, true);
      break;
    }
    case 'const': {
      const t = replValueType(result.value);
      console.log(c('green', 'const ') + c('bold', result.name) + ' : ' + c('yellow', t) + ' = ' + displayValue(result.value));
      break;
    }
    case 'fn':    console.log(c('green', 'fn ')    + c('bold', result.name) + c('gray', ' defined')); break;
    case 'type':  console.log(c('green', 'type ')  + c('bold', result.name) + c('gray', ' defined')); break;
    case 'agent': console.log(c('green', 'agent ') + c('bold', result.name) + c('gray', ' defined')); break;
    case 'none':  break;
  }
}

// ─── REPL ────────────────────────────────────────────────────

async function startRepl(): Promise<void> {
  const readline = require('readline') as typeof import('readline');
  const os       = require('os')       as typeof import('os');

  const historyFile = path.join(os.homedir(), '.axon_history');

  // ── Load history ─────────────────────────────────────────
  let savedHistory: string[] = [];
  try {
    if (fs.existsSync(historyFile)) {
      savedHistory = fs.readFileSync(historyFile, 'utf-8')
        .split('\n').map(l => l.trim()).filter(Boolean)
        .reverse()   // readline keeps newest-first internally
        .slice(0, 500);
    }
  } catch { /* not fatal */ }

  const isTTY    = !!(process.stdin as any).isTTY;
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
    historySize: 500, terminal: isTTY,
  });

  if (isTTY && Array.isArray((rl as any).history)) {
    (rl as any).history.push(...savedHistory);
  }

  // ── State ────────────────────────────────────────────────
  let interpreter = new Interpreter();
  let lineBuffer  = '';
  let braceDepth  = 0;
  let parenDepth  = 0;

  interpreter.globalEnv.define('_', { tag: ValueTag.Unit } as any, true);

  const PROMPT_PRIMARY = c('cyan', 'axon') + c('gray', '> ');
  const PROMPT_CONT    = c('gray', '   ...');

  function doPrompt(): void {
    rl.setPrompt(braceDepth > 0 || parenDepth > 0 ? PROMPT_CONT : PROMPT_PRIMARY);
    rl.prompt();
  }

  function saveHistory(): void {
    if (!isTTY) return;
    try {
      const lines = ((rl as any).history as string[] | undefined) ?? [];
      fs.writeFileSync(historyFile, [...lines].reverse().join('\n') + '\n', 'utf-8');
    } catch { /* best-effort */ }
  }

  // ── Sequential line processing queue ─────────────────────
  // Prevents concurrent async evaluations when input is pasted or piped.
  const lineQueue: string[] = [];
  let   processing = false;

  async function drainQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    while (lineQueue.length > 0) {
      const line = lineQueue.shift()!;

      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}' && braceDepth > 0) braceDepth--;
        else if (ch === '(') parenDepth++;
        else if (ch === ')' && parenDepth > 0) parenDepth--;
      }

      lineBuffer += line + '\n';

      if (braceDepth > 0 || parenDepth > 0) {
        doPrompt(); continue;
      }

      const input = lineBuffer;
      lineBuffer  = '';
      await evaluate(input);
      doPrompt();
    }
    processing = false;
  }

  // ── :help ────────────────────────────────────────────────
  function cmdHelp(): void {
    console.log(`
  ${c('bold', 'Axon Interactive REPL')}

  ${c('cyan', 'Meta-commands:')}
  :help   :h           Show this help
  :quit   :q           Exit (history saved automatically)
  :env                 List all user-defined names and values
  :type <expr>         Show the runtime type of an expression
  :load <file>         Load and execute an Axon source file
  :clear               Reset environment

  ${c('cyan', 'Language:')}
  1 + 2 * 3            ${c('gray', '=> Int 7')}
  let x = 42           ${c('gray', 'val x : Int = 42')}
  let mut n = 0        ${c('gray', 'val mut n : Int = 0')}
  fn sq(n: Int) = n*n  ${c('gray', 'fn sq defined')}
  sq(x)                ${c('gray', '=> Int 1764')}
  _                    ${c('gray', 'last result (always available)')}

  ${c('cyan', 'Multi-line:')}
  Opening ${c('gray', '{')} or ${c('gray', '(')} switches to ${c('gray', '...')} continuation prompt.
  Close all brackets to evaluate.

  ${c('cyan', 'History:')}
  ${c('bold', '↑')} / ${c('bold', '↓')} navigate previous commands.
  Saved to ${c('gray', '~/.axon_history')} on exit.
`);
  }

  // ── :env ─────────────────────────────────────────────────
  function cmdEnv(): void {
    const bindings = interpreter.getReplUserBindings().filter(b => b.name !== '_');
    const last     = interpreter.globalEnv.tryGet('_');

    if (bindings.length === 0 && (!last || last.tag === ValueTag.Unit)) {
      console.log(c('gray', '  (no user-defined names yet)'));
      return;
    }
    console.log(c('cyan', '\n  User-defined names:'));
    for (const { name, value, mutable } of bindings) {
      const mut  = mutable ? c('blue', 'mut ') : '';
      const t    = replValueType(value);
      let   val  = displayValue(value);
      if (val.length > 60) val = val.slice(0, 57) + '...';
      console.log(`    ${mut}${c('bold', name)} : ${c('yellow', t)} = ${val}`);
    }
    if (last && last.tag !== ValueTag.Unit) {
      const t   = replValueType(last);
      let   val = displayValue(last);
      if (val.length > 60) val = val.slice(0, 57) + '...';
      console.log(`    ${c('gray', `_ : ${t} = ${val}  (last result)`)}`);
    }
    console.log();
  }

  // ── :type ────────────────────────────────────────────────
  async function cmdType(expr: string): Promise<void> {
    if (!expr) { console.log(c('red', '  Usage: :type <expression>')); return; }
    try {
      const result = await interpreter.replExec(expr);
      if (result.kind === 'value' || result.kind === 'let' || result.kind === 'const') {
        console.log('  ' + c('yellow', replValueType(result.value)));
      } else {
        console.log(c('gray', '  (no value)'));
      }
    } catch (e) {
      console.error(c('red', '  Error: ') + (e instanceof Error ? e.message : String(e)));
    }
  }

  // ── :load ────────────────────────────────────────────────
  async function cmdLoad(filePath: string): Promise<void> {
    if (!filePath) { console.log(c('red', '  Usage: :load <file>')); return; }
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) { console.error(c('red', `  File not found: ${filePath}`)); return; }
    try {
      const source  = fs.readFileSync(abs, 'utf-8');
      const program = parse(source, abs);
      await interpreter.execute(program);
      console.log(c('green', `  ✓ Loaded ${path.basename(abs)}`));
    } catch (e) {
      console.error(c('red', '  Load error: ') + (e instanceof Error ? e.message : String(e)));
    }
  }

  // ── Evaluate one complete input ───────────────────────────
  async function evaluate(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed.startsWith(':')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmd  = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const rest = spaceIdx === -1 ? ''      : trimmed.slice(spaceIdx + 1).trim();

      switch (cmd) {
        case ':quit': case ':q':
          saveHistory(); console.log(c('gray', 'Goodbye!')); process.exit(0); break;
        case ':help': case ':h':
          cmdHelp(); break;
        case ':env':
          cmdEnv(); break;
        case ':type':
          await cmdType(rest); break;
        case ':load':
          await cmdLoad(rest); break;
        case ':clear':
          interpreter = new Interpreter();
          braceDepth  = 0; parenDepth = 0; lineBuffer = '';
          interpreter.globalEnv.define('_', { tag: ValueTag.Unit } as any, true);
          console.log(c('gray', '  Environment cleared.')); break;
        default:
          console.log(c('red', `  Unknown command: ${cmd}`) + c('gray', '  (type :help)'));
      }
      return;
    }

    try {
      const result = await interpreter.replExec(trimmed);
      printReplResult(result, interpreter);
    } catch (e) {
      if (e instanceof ParseError || e instanceof LexError) {
        console.error(c('red', 'Parse error: ') + (e as Error).message);
      } else if (e instanceof RuntimeError) {
        console.error(c('red', 'Runtime error: ') + (e as Error).message);
        if ((e as RuntimeError).span) {
          const s = (e as RuntimeError).span!;
          console.error(c('gray', `  at line ${s.line}:${s.col}`));
        }
      } else {
        console.error(c('red', 'Error: ') + (e instanceof Error ? e.message : String(e)));
      }
    }
  }

  // ── Start ────────────────────────────────────────────────
  printBanner();
  console.log(c('gray', 'Type :help for commands, :quit to exit, ↑/↓ for history.\n'));

  doPrompt();

  rl.on('line', (line: string) => {
    lineQueue.push(line);
    drainQueue();
  });

  rl.on('close', () => {
    saveHistory();
    console.log(c('gray', '\nGoodbye!'));
    process.exit(0);
  });
}

// ─── Error formatting ─────────────────────────────────────────

function printRuntimeError(e: unknown, file: string, source?: string): void {
  if (e instanceof RuntimeError) {
    console.error(c('red', c('bold', 'Runtime error: ')) + e.message);
    if (e.span) {
      const basename = path.basename(file);
      console.error(c('gray', `  --> ${basename}:${e.span.line}:${e.span.col}`));
      if (source) {
        const lines = source.split('\n');
        const lineStr = lines[e.span.line - 1];
        if (lineStr !== undefined) {
          const lineNo = String(e.span.line).padStart(4);
          console.error(c('gray', `${lineNo} │`) + ' ' + lineStr);
          console.error(c('gray', `     │`) + ' '.repeat(e.span.col) + c('red', '^'));
        }
      }
    }
  } else if (e instanceof Error) {
    console.error(c('red', 'Error: ') + e.message);
    if (e.stack) {
      console.error(c('gray', e.stack.split('\n').slice(1, 3).join('\n')));
    }
  } else {
    console.error(c('red', 'Unknown error: ') + String(e));
  }
}

// ─── CLI Parsing ─────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    startRepl();
    return;
  }

  const command = args[0];

  switch (command) {
    case 'run': {
      const file          = args[1];
      const watch         = args.includes('--watch') || args.includes('-w');
      const noType        = args.includes('--no-check');
      const strictEffects = args.includes('--strict-effects');
      const trace         = args.includes('--trace');
      const traceFileIdx  = args.indexOf('--trace-file');
      const traceFile     = traceFileIdx !== -1 ? args[traceFileIdx + 1] : undefined;
      if (!file) { console.error('Usage: axon run <file.axon> [--watch] [--strict-effects] [--trace] [--trace-file <path>]'); process.exit(1); }
      await runFile(file, { watch, typeCheck: !noType, strictEffects, trace, traceFile });
      break;
    }

    case 'replay': {
      // axon replay <trace.jsonl> <program.axon>
      const traceArg = args[1];
      const progArg  = args[2];
      if (!traceArg || !progArg) {
        console.error('Usage: axon replay <trace.jsonl> <program.axon>');
        process.exit(1);
      }
      const traceAbs = path.resolve(traceArg);
      const progAbs  = path.resolve(progArg);
      if (!fs.existsSync(traceAbs)) { console.error(`Trace file not found: ${traceArg}`); process.exit(1); }
      if (!fs.existsSync(progAbs))  { console.error(`Program file not found: ${progArg}`); process.exit(1); }
      const traceJsonl = fs.readFileSync(traceAbs, 'utf-8');
      const source     = fs.readFileSync(progAbs,  'utf-8');
      let program;
      try { program = parse(source, progAbs); }
      catch (e) { console.error('Parse error:', (e as Error).message); process.exit(1); }
      const diags = typeCheck(program);
      const errors = diags.filter(d => d.level === 'error');
      if (errors.length > 0) { printDiagnostics(errors, source, progArg); process.exit(1); }
      const interp = new Interpreter();
      interp.enableReplay(traceJsonl);
      try {
        await interp.execute(program, progAbs);
      } catch (e) {
        console.error(c('red', 'Runtime error:'), (e as Error).message);
        process.exit(1);
      }
      break;
    }

    case 'test': {
      // axon test [dir]   — run all *.axon files in dir (default: tests/axon/)
      const testDir = path.resolve(args[1] || 'tests/axon');
      if (!fs.existsSync(testDir)) {
        console.error(`Test directory not found: ${testDir}`);
        process.exit(1);
      }
      const files = fs.readdirSync(testDir)
        .filter(f => f.endsWith('.axon') && !f.startsWith('_'))
        .sort()
        .map(f => path.join(testDir, f));

      if (files.length === 0) {
        console.log(c('yellow', `No .axon files found in ${testDir}`));
        break;
      }

      let passed = 0, failed = 0;
      const startAll = Date.now();
      const failures: Array<{ file: string; error: string }> = [];

      console.log(c('cyan', c('bold', `\nRunning ${files.length} test files...\n`)));

      for (const f of files) {
        const basename = path.basename(f);
        const start = Date.now();
        const source = fs.readFileSync(f, 'utf-8');
        let ok = true;
        let errMsg = '';
        let prog: ReturnType<typeof parse>;
        try {
          prog = parse(source, f);
          const diags = typeCheck(prog).filter(d => d.level === 'error');
          if (diags.length > 0) throw new Error(diags[0].message);
        } catch (e) {
          ok = false;
          errMsg = (e instanceof Error ? e.message : String(e)).split('\n')[0];
          const ms = Date.now() - start;
          console.log(`  ${c('red', '✗')} ${basename}  ${c('gray', `(${ms}ms)`)}`);
          console.log(`    ${c('red', errMsg)}`);
          failures.push({ file: basename, error: errMsg });
          failed++;
          continue;
        }

        // Check if file has #[test] functions
        const hasTestAnnot = prog.items.some(item =>
          item.kind === 'FnDecl' && item.annots.some(a => a === 'test' || a.startsWith('test(')));

        // Suppress stdout
        const origWrite = process.stdout.write.bind(process.stdout);
        (process.stdout as any).write = (_s: string) => true;

        try {
          const interp = new Interpreter();
          if (hasTestAnnot) {
            // Run individual #[test] functions
            const testResults = await interp.runTests(prog, f);
            (process.stdout as any).write = origWrite;
            if (testResults.length === 0) {
              const ms = Date.now() - start;
              console.log(`  ${c('yellow', '○')} ${basename}  ${c('gray', `no #[test] functions (${ms}ms)`)}`);
              passed++;
            } else {
              let filePassed = true;
              for (const tr of testResults) {
                const ms2 = Date.now() - start;
                if (tr.passed) {
                  console.log(`  ${c('green', '✓')} ${basename}::${tr.name}  ${c('gray', `(${ms2}ms)`)}`);
                  passed++;
                } else {
                  console.log(`  ${c('red', '✗')} ${basename}::${tr.name}  ${c('gray', `(${ms2}ms)`)}`);
                  console.log(`    ${c('red', tr.error ?? 'failed')}`);
                  failures.push({ file: `${basename}::${tr.name}`, error: tr.error ?? 'failed' });
                  failed++;
                  filePassed = false;
                }
              }
            }
          } else {
            // Run whole file as single test
            await interp.execute(prog, f);
            (process.stdout as any).write = origWrite;
            const ms = Date.now() - start;
            console.log(`  ${c('green', '✓')} ${basename}  ${c('gray', `(${ms}ms)`)}`);
            passed++;
          }
        } catch (e) {
          (process.stdout as any).write = origWrite;
          ok = false;
          errMsg = (e instanceof Error ? e.message : String(e)).split('\n')[0];
          const ms = Date.now() - start;
          console.log(`  ${c('red', '✗')} ${basename}  ${c('gray', `(${ms}ms)`)}`);
          console.log(`    ${c('red', errMsg)}`);
          failures.push({ file: basename, error: errMsg });
          failed++;
        }
      }

      const totalMs = Date.now() - startAll;
      console.log();
      if (failed === 0) {
        console.log(c('green', c('bold', `✓ All ${passed} tests passed`)) + c('gray', `  (${totalMs}ms total)`));
      } else {
        console.log(c('red', c('bold', `✗ ${failed} failed`)) + c('gray', `, ${passed} passed  (${totalMs}ms total)`));
        process.exit(1);
      }
      break;
    }

    case 'check': {
      const file = args[1];
      if (!file) { console.error('Usage: axon check <file.axon>'); process.exit(1); }
      await checkFile(file);
      break;
    }

    case 'repl': {
      await startRepl();
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      printBanner();
      console.log(`${c('bold', 'Usage:')} axon <command> [options]

${c('cyan', 'Commands:')}
  run <file>                   Run an Axon program
  test [dir]                   Run all *.axon test files in a directory (default: tests/axon/)
  replay <trace.jsonl> <file>  Replay a program using recorded trace (mock side effects)
  check <file>                 Type-check without running
  repl                         Start interactive REPL

${c('cyan', 'Options for run:')}
  --watch, -w          Enable hot reload (watch for file changes)
  --no-check           Skip type checking
  --strict-effects     Enforce effect declarations on ALL functions (not just annotated ones)
  --trace              Emit JSONL trace events for effectful operations to stderr
  --trace-file <path>  Emit JSONL trace events to a file (instead of stderr)

${c('cyan', 'Examples:')}
  axon run demo/counter.axon
  axon run demo/hot_reload_demo.axon --watch
  axon check demo/type_errors.axon
  axon repl
`);
      break;
    }

    default: {
      // Treat as a file path (with optional flags)
      if (fs.existsSync(command)) {
        const trace        = args.includes('--trace');
        const traceFileIdx = args.indexOf('--trace-file');
        const traceFile    = traceFileIdx !== -1 ? args[traceFileIdx + 1] : undefined;
        const strictEffects = args.includes('--strict-effects');
        await runFile(command, { trace, traceFile, strictEffects });
      } else {
        console.error(`Unknown command: '${command}'. Run 'axon help' for usage.`);
        process.exit(1);
      }
    }
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
