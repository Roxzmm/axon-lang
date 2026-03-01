// ============================================================
// Axon Language — Hot Reload System
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { parse } from './parser';
import { typeCheck, Diagnostic } from './checker';
import type { Interpreter } from './interpreter';

export interface HotReloadResult {
  success:  boolean;
  file:     string;
  version:  number;
  modules:  number;
  fns:      number;
  agents:   number;
  errors:   Diagnostic[];
  duration: number;
}

export interface HotReloadOptions {
  onReload?:  (result: HotReloadResult) => void;
  onError?:   (error: string, file: string) => void;
  typeCheck?: boolean;  // Whether to run type checker before hot reload (default: true)
}

export class HotReloadManager {
  private watchers:   Map<string, fs.FSWatcher> = new Map();
  private versions:   Map<string, number>        = new Map();
  private lastReload: Map<string, number>        = new Map();
  private debounceMs = 100;

  constructor(
    private interpreter: Interpreter,
    private opts: HotReloadOptions = {}
  ) {}

  watch(filePath: string): void {
    const abs = path.resolve(filePath);
    if (this.watchers.has(abs)) return;

    if (!fs.existsSync(abs)) {
      console.error(`[HotReload] File not found: ${abs}`);
      return;
    }

    const watcher = fs.watch(abs, { persistent: false }, (event) => {
      if (event !== 'change') return;

      // Debounce
      const now   = Date.now();
      const last  = this.lastReload.get(abs) ?? 0;
      if (now - last < this.debounceMs) return;
      this.lastReload.set(abs, now);

      // Run reload in next tick to avoid file lock issues
      setTimeout(() => this.reloadFile(abs), 50);
    });

    this.watchers.set(abs, watcher);
    this.versions.set(abs, 1);
    console.log(`[HotReload] Watching: ${path.basename(abs)}`);
  }

  watchDirectory(dir: string, ext = '.axon'): void {
    if (!fs.existsSync(dir)) return;

    const scan = (d: string) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (entry.name.endsWith(ext)) this.watch(full);
      }
    };
    scan(dir);
  }

  async reloadFile(filePath: string): Promise<HotReloadResult> {
    const start   = Date.now();
    const version = (this.versions.get(filePath) ?? 1) + 1;
    this.versions.set(filePath, version);

    const result: HotReloadResult = {
      success: false, file: filePath, version,
      modules: 0, fns: 0, agents: 0,
      errors: [], duration: 0,
    };

    try {
      const source = fs.readFileSync(filePath, 'utf-8');

      // Parse
      const program = parse(source, filePath);

      // Type check
      if (this.opts.typeCheck !== false) {
        const diagnostics = typeCheck(program);
        const errors = diagnostics.filter(d => d.level === 'error');
        if (errors.length > 0) {
          result.errors = errors;
          result.duration = Date.now() - start;
          this.opts.onError?.(
            errors.map(e => `  ${e.line}:${e.col}: ${e.message}`).join('\n'),
            filePath
          );
          return result;
        }
        // Show warnings
        diagnostics.filter(d => d.level === 'warning').forEach(w => {
          console.log(`[HotReload] Warning ${w.line}:${w.col}: ${w.message}`);
        });
      }

      // Apply hot reload
      const { modules, fns, agents } = await this.interpreter.hotReload(program);
      result.success = true;
      result.modules = modules;
      result.fns     = fns;
      result.agents  = agents;
      result.duration = Date.now() - start;

      this.opts.onReload?.(result);
      return result;

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.duration = Date.now() - start;
      this.opts.onError?.(msg, filePath);
      return result;
    }
  }

  stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  getVersion(filePath: string): number {
    return this.versions.get(path.resolve(filePath)) ?? 1;
  }
}

// ─── Default hot-reload logger ───────────────────────────────

export function createDefaultLogger(useColor = true): HotReloadOptions {
  const green  = useColor ? '\x1b[32m' : '';
  const red    = useColor ? '\x1b[31m' : '';
  const yellow = useColor ? '\x1b[33m' : '';
  const blue   = useColor ? '\x1b[34m' : '';
  const reset  = useColor ? '\x1b[0m'  : '';
  const bold   = useColor ? '\x1b[1m'  : '';

  return {
    onReload(result) {
      const file = path.basename(result.file);
      const stats: string[] = [];
      if (result.fns   > 0) stats.push(`${result.fns} fn`);
      if (result.agents > 0) stats.push(`${result.agents} agent(s) updated`);
      const statsStr = stats.length > 0 ? ` (${stats.join(', ')})` : '';
      console.log(
        `${green}${bold}[HotReload]${reset} ${green}✓${reset} ` +
        `${file} v${result.version}${statsStr} ` +
        `${yellow}${result.duration}ms${reset}`
      );
    },
    onError(error, file) {
      console.error(
        `${red}${bold}[HotReload]${reset} ${red}✗${reset} ` +
        `${path.basename(file)}: Compile error (old version kept running)\n${red}${error}${reset}`
      );
    },
  };
}
