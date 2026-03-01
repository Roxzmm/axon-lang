// ============================================================
// Axon Language — Environment (Lexical Scope)
// ============================================================

import type { AxonValue } from './value';

export class Environment {
  private bindings: Map<string, { value: AxonValue; mutable: boolean }>;
  private parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.bindings = new Map();
    this.parent   = parent;
  }

  // Create a child scope
  child(): Environment {
    return new Environment(this);
  }

  // Define a new variable in the current scope
  define(name: string, value: AxonValue, mutable = false): void {
    this.bindings.set(name, { value, mutable });
  }

  // Get a variable (searches up the scope chain)
  get(name: string): AxonValue {
    const binding = this.lookup(name);
    if (!binding) throw new Error(`Undefined variable: '${name}'`);
    return binding.value;
  }

  // Try to get without throwing
  tryGet(name: string): AxonValue | undefined {
    return this.lookup(name)?.value;
  }

  // Assign to an existing variable (searches up, must be mutable)
  assign(name: string, value: AxonValue): void {
    const env = this.findOwner(name);
    if (!env) throw new Error(`Undefined variable: '${name}'`);
    const binding = env.bindings.get(name)!;
    if (!binding.mutable) throw new Error(`Cannot reassign immutable variable: '${name}'`);
    binding.value = value;
  }

  // Check if variable exists
  has(name: string): boolean {
    return this.lookup(name) !== undefined;
  }

  // Make a snapshot of current scope (for closures)
  snapshot(): Environment {
    const snap = new Environment(this.parent ? this.parent.snapshot() : null);
    for (const [k, v] of this.bindings) {
      snap.bindings.set(k, { value: v.value, mutable: v.mutable });
    }
    return snap;
  }

  private lookup(name: string): { value: AxonValue; mutable: boolean } | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name);
  }

  private findOwner(name: string): Environment | null {
    if (this.bindings.has(name)) return this;
    return this.parent?.findOwner(name) ?? null;
  }

  // Dump for debugging
  dump(indent = 0): string {
    const lines: string[] = [];
    const prefix = '  '.repeat(indent);
    for (const [k, v] of this.bindings) {
      lines.push(`${prefix}${v.mutable ? 'mut ' : ''}${k}`);
    }
    if (this.parent) lines.push(this.parent.dump(indent + 1));
    return lines.join('\n');
  }
}

// Global module environment (holds all module-level definitions)
export class ModuleRegistry {
  private modules: Map<string, Environment> = new Map();

  set(path: string, env: Environment): void {
    this.modules.set(path, env);
  }

  get(path: string): Environment | undefined {
    return this.modules.get(path);
  }

  getOrCreate(path: string): Environment {
    let env = this.modules.get(path);
    if (!env) { env = new Environment(); this.modules.set(path, env); }
    return env;
  }
}
