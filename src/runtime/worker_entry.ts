import { parentPort, workerData } from 'worker_threads';
import { Interpreter } from '../interpreter';
import { deserializeAxonValue, serializeAxonValue } from './serializer';
import { AxonValue, AgentHandlerFn } from './value';

if (!parentPort) {
  throw new Error('worker_entry must be run as a worker thread');
}

const { agentName, decl, state: serializedState, timeoutMs, grantedCaps } = workerData;

const state = new Map<string, AxonValue>();
for (const [k, v] of serializedState) {
  state.set(k, deserializeAxonValue(v));
}

const interpreter = new Interpreter();
const caps = grantedCaps ? new Set<string>(grantedCaps) : null;

const handlers = new Map<string, AgentHandlerFn>();
for (let i = 0; i < decl.handlers.length; i++) {
  const idx = i;
  handlers.set(decl.handlers[i].msgType, async (agentState, args) => {
    interpreter.capabilityStack.push(caps);
    try {
      return await interpreter.evalAgentHandler(decl, idx, agentState, args);
    } finally {
      interpreter.capabilityStack.pop();
    }
  });
}

parentPort.on('message', async (msg) => {
  try {
    const handler = handlers.get(msg.handler);
    if (!handler) {
      throw new Error(`Agent ${agentName}: unknown message type '${msg.handler}'`);
    }

    const args = msg.args.map(deserializeAxonValue);
    
    const handlerPromise = handler(state, args);
    const result = timeoutMs != null
      ? await Promise.race([
          handlerPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeoutMs)
          ),
        ])
      : await handlerPromise;

    if (msg.type === 'ask') {
      parentPort!.postMessage({
        id: msg.id,
        type: 'response',
        result: serializeAxonValue(result)
      });
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (msg.type === 'ask') {
      parentPort!.postMessage({
        id: msg.id,
        type: 'response',
        error: err.message
      });
    } else {
      parentPort!.postMessage({
        type: 'crash',
        error: err.message
      });
    }
  }
});
