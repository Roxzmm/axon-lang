#!/usr/bin/env node
// ============================================================
// Axon Language — CLI Entry Point
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { parse, ParseError } from './parser';
import { LexError } from './lexer';
import { typeCheck, Diagnostic } from './checker';
import { Interpreter } from './interpreter';
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
  ║   Axon Language Interpreter v0.1.0    ║
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

async function runFile(filePath: string, opts: { watch?: boolean; typeCheck?: boolean }): Promise<void> {
  const abs    = path.resolve(filePath);
  const source = fs.readFileSync(abs, 'utf-8');

  // Parse
  let program;
  try {
    program = parse(source, abs);
  } catch (e) {
    if (e instanceof ParseError || e instanceof LexError) {
      console.error(c('red', c('bold', 'Parse error: ')) + e.message);
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  // Type check
  if (opts.typeCheck !== false) {
    const diagnostics = typeCheck(program);
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
      await interpreter.execute(program);
    } catch (e) {
      printRuntimeError(e, abs);
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
      await interpreter.execute(program);
    } catch (e) {
      printRuntimeError(e, abs);
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

// ─── REPL ────────────────────────────────────────────────────

async function startRepl(): Promise<void> {
  const readline = require('readline') as typeof import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: c('cyan', 'axon> ') });

  printBanner();
  console.log(c('gray', 'Interactive REPL. Type :help for commands, :quit to exit.\n'));

  const interpreter = new Interpreter();
  let   lineBuffer  = '';

  rl.prompt();

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();

    // ── REPL meta-commands ────────────────────────────────────
    if (trimmed === ':quit' || trimmed === ':q') {
      console.log(c('gray', 'Goodbye!')); process.exit(0);
    }
    if (trimmed === ':help' || trimmed === ':h') {
      console.log(`
  ${c('cyan', 'Commands:')}
  :quit  :q      Exit the REPL
  :help  :h      Show this help
  :clear         Reset environment

  ${c('cyan', 'Examples:')}
  1 + 2 * 3                          ${c('gray', '=> 7')}
  let x = 42                         ${c('gray', '=> 42')}
  x * 2                              ${c('gray', '=> 84')}
  fn double(n: Int) = n * 2         ${c('gray', '=> defined: double')}
  double(x)                          ${c('gray', '=> 84')}
  [1,2,3,4,5] |> list_filter(|n| n > 2)  ${c('gray', '=> [3, 4, 5]')}
  "hello" + " world"                 ${c('gray', '=> "hello world"')}
`);
      rl.prompt(); return;
    }
    if (trimmed === ':clear') {
      console.log(c('gray', 'Environment cleared.'));
      lineBuffer = '';
      rl.prompt(); return;
    }

    lineBuffer += line + '\n';

    // Check for incomplete multi-line input (unmatched braces/parens)
    let braceDepth = 0, parenDepth = 0;
    for (const ch of lineBuffer) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
    }
    if (braceDepth > 0 || parenDepth > 0) {
      process.stdout.write(c('gray', '... '));
      rl.prompt(); return;
    }

    // ── Evaluate ─────────────────────────────────────────────
    try {
      const input = lineBuffer.trim();
      lineBuffer = '';

      const result = await interpreter.replExec(input);

      // Print result if not Unit
      if (result.tag !== ValueTag.Unit) {
        console.log(c('green', '=> ') + displayValue(result));
      } else if (/^(fn|type|agent|const)\s/.test(input)) {
        // Declaration: show what was defined
        const nameMatch = input.match(/^(?:fn|type|agent|const)\s+(\w+)/);
        if (nameMatch) console.log(c('green', `defined: ${nameMatch[1]}`));
      }

    } catch (e) {
      if (e instanceof ParseError) {
        console.error(c('red', `Parse error: `) + e.message);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(c('red', `Error: `) + msg);
      }
      lineBuffer = '';
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(c('gray', '\nGoodbye!')); process.exit(0);
  });
}

// ─── Error formatting ─────────────────────────────────────────

function printRuntimeError(e: unknown, file: string): void {
  if (e instanceof RuntimeError) {
    console.error(c('red', c('bold', 'Runtime error: ')) + e.message);
    if (e.span) {
      console.error(c('gray', `  at ${file}:${e.span.line}:${e.span.col}`));
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
      const file   = args[1];
      const watch  = args.includes('--watch') || args.includes('-w');
      const noType = args.includes('--no-check');
      if (!file) { console.error('Usage: axon run <file.axon> [--watch]'); process.exit(1); }
      await runFile(file, { watch, typeCheck: !noType });
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
  run <file>     Run an Axon program
  check <file>   Type-check without running
  repl           Start interactive REPL

${c('cyan', 'Options for run:')}
  --watch, -w    Enable hot reload (watch for file changes)
  --no-check     Skip type checking

${c('cyan', 'Examples:')}
  axon run demo/counter.axon
  axon run demo/hot_reload_demo.axon --watch
  axon check demo/type_errors.axon
  axon repl
`);
      break;
    }

    default: {
      // Treat as a file path
      if (fs.existsSync(command)) {
        await runFile(command, {});
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
