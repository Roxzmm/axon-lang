#!/usr/bin/env ts-node
// ============================================================
// Axon Language — Test Runner
// ============================================================
// Runs all .axon files in tests/axon/ and reports pass/fail.
// A test passes if it exits 0. Assertion failures produce
// non-zero exit and are reported.

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';

// ─── Colors ──────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};
const ok   = (s: string) => `${C.green}${C.bold}✓${C.reset} ${s}`;
const fail = (s: string) => `${C.red}${C.bold}✗${C.reset} ${s}`;
const info = (s: string) => `${C.cyan}${s}${C.reset}`;
const dim  = (s: string) => `${C.gray}${s}${C.reset}`;

// ─── Test result ─────────────────────────────────────────────
interface TestResult {
  name:    string;
  file:    string;
  passed:  boolean;
  stdout?: string;
  stderr?: string;
  error?:  string;
  ms:      number;
}

// ─── Run one test ─────────────────────────────────────────────
function runTest(file: string): TestResult {
  const name  = basename(file, '.axon');
  const start = Date.now();

  const root    = resolve(__dirname, '..');
  const mainJs  = join(root, 'dist', 'main.js');
  const opts: ExecSyncOptionsWithStringEncoding = {
    encoding: 'utf-8',
    timeout:  15_000,
    cwd:      root,
  };

  try {
    const stdout = execSync(`node ${mainJs} run ${file} --no-check`, opts);
    return { name, file, passed: true, stdout, ms: Date.now() - start };
  } catch (e: any) {
    return {
      name,
      file,
      passed: false,
      stdout: e.stdout as string,
      stderr: e.stderr as string,
      error:  e.message,
      ms:     Date.now() - start,
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────
async function main(): Promise<void> {
  const testDir = join(__dirname, 'axon');

  if (!existsSync(testDir)) {
    console.error(`Test directory not found: ${testDir}`);
    process.exit(1);
  }

  // Collect test files
  const files = readdirSync(testDir)
    .filter(f => f.endsWith('.axon'))
    .sort()
    .map(f => join(testDir, f));

  // Filter by pattern if provided
  const pattern = process.argv[2];
  const filtered = pattern
    ? files.filter(f => basename(f).includes(pattern))
    : files;

  if (filtered.length === 0) {
    console.log(dim('No test files found.'));
    return;
  }

  console.log(info(`\nAxon Test Suite — ${filtered.length} test(s)\n`));

  const results: TestResult[] = [];
  let   maxWidth = 0;

  for (const file of filtered) {
    const result = runTest(file);
    results.push(result);
    maxWidth = Math.max(maxWidth, result.name.length);

    const pad   = ' '.repeat(maxWidth - result.name.length + 2);
    const ms    = dim(`${result.ms}ms`);

    if (result.passed) {
      console.log(`  ${ok(result.name)}${pad}${ms}`);
    } else {
      console.log(`  ${fail(result.name)}${pad}${ms}`);
      // Show first meaningful error line
      const errLines = (result.stderr || result.error || '').split('\n');
      const firstErr = errLines.find(l => l.trim() && !l.startsWith('['));
      if (firstErr) {
        console.log(`    ${C.red}${firstErr.trim()}${C.reset}`);
      }
      if (result.stdout?.trim()) {
        console.log(`    ${C.gray}stdout: ${result.stdout.trim().split('\n').slice(-2).join(' | ')}${C.reset}`);
      }
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total  = results.length;
  const pct    = Math.round(100 * passed / total);

  console.log();
  if (failed === 0) {
    console.log(`${C.green}${C.bold}All ${total} tests passed.${C.reset}\n`);
  } else {
    console.log(`${C.bold}${passed}/${total} passed${C.reset} (${pct}%)`);

    // Show failed tests detail
    console.log(`\n${C.red}${C.bold}Failed tests:${C.reset}`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`\n  ${C.bold}${r.name}${C.reset} (${r.file})`);
      const err = r.stderr || r.error || '';
      for (const line of err.split('\n').slice(0, 8)) {
        if (line.trim()) console.log(`    ${line}`);
      }
    }
    console.log();
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
