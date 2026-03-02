// ============================================================
// Axon Language — Agent Runtime
// ============================================================

import {
  AxonValue, ValueTag, AgentRef, AgentHandlerFn,
  mkString, UNIT, displayValue, RuntimeError,
} from './value';
import type { Environment } from './env';
import type { AgentDecl } from '../ast';

// Global registry of all running agents
const agentRegistry = new Map<string, AgentRef>();

export function registerAgent(ref: AgentRef): void {
  agentRegistry.set(ref.id, ref);
}

export function getAgent(id: string): AgentRef | undefined {
  return agentRegistry.get(id);
}

export function listAgents(): AgentRef[] {
  return [...agentRegistry.values()];
}

export function stopAgent(id: string): boolean {
  return agentRegistry.delete(id);
}

// ─── Hot-reload support: update agent handlers ───────────────

export function hotUpdateAgent(agentName: string, newHandlers: Map<string, AgentHandlerFn>): number {
  let updated = 0;
  for (const ref of agentRegistry.values()) {
    if (ref.name === agentName) {
      // Update handlers while preserving state
      for (const [msgType, handler] of newHandlers) {
        ref.handlers.set(msgType, handler);
      }
      updated++;
    }
  }
  return updated;
}

// ─── Supervisor ──────────────────────────────────────────────

export interface SupervisorChildConfig {
  name:        string;
  spawnConfig: AgentSpawnConfig;
}

export class Supervisor {
  private children: Map<string, {
    ref:          AgentRef;
    restartCount: number;
    restartTimes: number[];   // timestamps of recent restarts
    config:       AgentSpawnConfig;
  }> = new Map();

  constructor(
    private strategy:      'OneForOne' | 'AllForOne' | 'RestForOne' = 'OneForOne',
    private maxRestarts:   number = 3,
    private restartWindow: number = 5000,  // ms
  ) {}

  addChild(name: string, ref: AgentRef, config: AgentSpawnConfig): void {
    // Attach crash handler
    ref.onCrash = (crashedRef, err) => this.handleCrash(name, crashedRef, err);
    this.children.set(name, { ref, restartCount: 0, restartTimes: [], config });
  }

  getChild(name: string): AgentRef | undefined {
    return this.children.get(name)?.ref;
  }

  private async handleCrash(name: string, crashedRef: AgentRef, err: Error): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;

    // Prune old restart timestamps outside the window
    const now = Date.now();
    child.restartTimes = child.restartTimes.filter(t => now - t < this.restartWindow);

    if (child.restartTimes.length >= this.maxRestarts) {
      console.error(`[Supervisor] Agent '${name}' exceeded max restarts (${this.maxRestarts}/${this.restartWindow}ms). Stopping.`);
      stopAgent(crashedRef.id);
      this.children.delete(name);
      return;
    }

    child.restartTimes.push(now);
    child.restartCount++;
    console.error(`[Supervisor] Agent '${name}' crashed (${err.message}). Restarting (attempt ${child.restartCount})...`);

    // Stop the crashed agent
    stopAgent(crashedRef.id);

    // Re-spawn with same config
    const newRef = spawnAgent(child.config);
    newRef.onCrash = (r, e) => this.handleCrash(name, r, e);
    child.ref = newRef;

    if (this.strategy === 'AllForOne') {
      // Restart all other children too
      for (const [otherName, other] of this.children) {
        if (otherName !== name) {
          stopAgent(other.ref.id);
          const newOtherRef = spawnAgent(other.config);
          newOtherRef.onCrash = (r, e) => this.handleCrash(otherName, r, e);
          other.ref = newOtherRef;
        }
      }
    }
  }

  stopAll(): void {
    for (const { ref } of this.children.values()) {
      ref.stop();
      stopAgent(ref.id);
    }
    this.children.clear();
  }
}

// ─── Agent spawn helpers for the interpreter ────────────────

export interface AgentSpawnConfig {
  decl:        AgentDecl;
  evalHandler: (decl: AgentDecl, handlerIdx: number, state: Map<string, AxonValue>, args: AxonValue[]) => Promise<AxonValue>;
  evalExpr:    (expr: import('../ast').Expr, env: Environment) => Promise<AxonValue>;
  globalEnv:   Environment;
}

export function spawnAgent(config: AgentSpawnConfig): AgentRef {
  const { decl, evalHandler, evalExpr, globalEnv } = config;

  // Initialize state
  const state = new Map<string, AxonValue>();

  // Build handler map
  const handlers = new Map<string, AgentHandlerFn>();

  for (let i = 0; i < decl.handlers.length; i++) {
    const handler = decl.handlers[i];
    const handlerIdx = i;
    handlers.set(handler.msgType, async (agentState, args) => {
      return evalHandler(decl, handlerIdx, agentState, args);
    });
  }

  const ref = new AgentRef(decl.name, state, handlers);
  registerAgent(ref);
  return ref;
}

// ─── Message send helpers ────────────────────────────────────

export async function sendMessage(
  agentVal: AxonValue,
  msgType:  string,
  args:     AxonValue[]
): Promise<void> {
  if (agentVal.tag !== ValueTag.Agent) {
    throw new RuntimeError(`send: expected Agent, got ${agentVal.tag}`);
  }
  agentVal.ref.send(msgType, args);
}

export async function askMessage(
  agentVal: AxonValue,
  msgType:  string,
  args:     AxonValue[]
): Promise<AxonValue> {
  if (agentVal.tag !== ValueTag.Agent) {
    throw new RuntimeError(`ask: expected Agent, got ${agentVal.tag}`);
  }
  return agentVal.ref.ask(msgType, args);
}
