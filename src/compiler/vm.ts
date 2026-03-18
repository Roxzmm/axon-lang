import { OpCode, BytecodeProgram, BytecodeFunction, Instruction } from './bytecode';
import { RuntimeError } from '../runtime/value';

export class VM {
  private program: BytecodeProgram;
  private globals: any[] = [];
  private hostFuncs: Map<string, Function> = new Map();
  private callStack: { fn: BytecodeFunction; pc: number; locals: any[] }[] = [];
  private stack: any[] = [];
  private stackSize = 0;
  
  private inlineCache: Map<string, { fn: Function; hits: number }> = new Map();

  constructor(program: BytecodeProgram, hostFuncs?: Record<string, Function>) {
    this.program = program;
    this.globals = new Array(program.constants.length).fill(undefined);
    this.stack = new Array(1024);
    if (hostFuncs) {
      this.hostFuncs = new Map(Object.entries(hostFuncs));
    }
  }

  run(): any {
    const main = this.program.functions[this.program.main];
    if (!main) throw new Error('No main function');
    return this.runFunction(main, []);
  }

  private runFunction(fn: BytecodeFunction, args: any[]): any {
    let pc = 0;
    const locals = [...args];
    // Initialize locals array to correct size
    while (locals.length < fn.locals) locals.push(undefined);
    while (pc < fn.code.length) {
      const instr = fn.code[pc++];
      switch (instr.op) {
        case OpCode.NOP: break;
        
        case OpCode.POP: this.stackSize--; break;
        case OpCode.DUP: this.stack[this.stackSize++] = this.stack[this.stackSize - 1]; break;
        
        case OpCode.LOAD_CONST: {
          const c = this.program.constants[instr.arg as number];
          this.stack[this.stackSize++] = c;
          break;
        }
        
        case OpCode.LOAD_LOCAL: {
          const idx = instr.arg as number;
          this.stack[this.stackSize++] = locals[idx];
          break;
        }
        
        case OpCode.STORE_LOCAL: {
          const val = this.stack[--this.stackSize];
          const idx = instr.arg as number;
          locals[idx] = val;
          break;
        }
        
        case OpCode.LOAD_GLOBAL: {
          const name = this.program.constants[instr.arg as number];
          if (typeof name === 'string' && this.hostFuncs.has(name)) {
            this.stack[this.stackSize++] = this.hostFuncs.get(name);
          } else {
            const idx = typeof name === 'string' ? this.globals.indexOf(name) : name;
            this.stack[this.stackSize++] = this.globals[idx] ?? null;
          }
          break;
        }
        
        case OpCode.STORE_GLOBAL: {
          const val = this.stack[--this.stackSize];
          const name = this.program.constants[instr.arg as number];
          const idx = typeof name === 'string' ? this.globals.indexOf(name) : name;
          this.globals[idx] = val;
          break;
        }
        
        case OpCode.CALL: {
          const n = instr.arg as number;
          const callee = this.stack[--this.stackSize];
          const args: any[] = [];
          for (let i = n - 1; i >= 0; i--) args[i] = this.stack[--this.stackSize];
          
          if (typeof callee === 'function') {
             try {
               const result = callee(...args);
               this.stack[this.stackSize++] = result;
             } catch (e: any) {
               throw new Error(`Runtime error: ${e.message}`);
             }
          } else if (typeof callee === 'number') {
             const fn = this.program.functions[callee];
             if (fn) {
               const result = this.runFunction(fn, args);
               this.stack[this.stackSize++] = result;
             } else {
               throw new Error(`Unknown function index: ${callee}`);
             }
          } else {
            throw new Error(`Cannot call non-function: ${callee}`);
          }
          break;
        }
        
        case OpCode.RETURN: {
          const val = this.stack[--this.stackSize];
          return val;
        }
        
        case OpCode.JUMP: {
          pc = instr.arg as number;
          break;
        }
        
        case OpCode.JUMP_IF_FALSE: {
          const cond = this.stack[--this.stackSize];
          if (!cond) pc = instr.arg as number;
          break;
        }
        
        case OpCode.ADD: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a + b;
          break;
        }
        
        case OpCode.SUB: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a - b;
          break;
        }
        
        case OpCode.MUL: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a * b;
          break;
        }
        
        case OpCode.DIV: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          if (b === 0) throw new RuntimeError('Division by zero', undefined, 'E3002');
          this.stack[this.stackSize++] = a / b;
          break;
        }

        case OpCode.MOD: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a % b;
          break;
        }
        
        case OpCode.EQ: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a === b;
          break;
        }
        
        case OpCode.NE: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a !== b;
          break;
        }
        
        case OpCode.LT: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a < b;
          break;
        }

        case OpCode.LE: {
          const b = this.stack[--this.stackSize];
          const a = this.stack[--this.stackSize];
          this.stack[this.stackSize++] = a <= b;
          break;
        }

        case OpCode.GT: {
          const b = this.stack.pop();
          const a = this.stack.pop();
          this.stack.push(a > b);
          break;
        }

        case OpCode.GE: {
          const b = this.stack.pop();
          const a = this.stack.pop();
          this.stack.push(a >= b);
          break;
        }

        case OpCode.AND: {
          const b = this.stack.pop();
          const a = this.stack.pop();
          this.stack.push(a && b);
          break;
        }

        case OpCode.OR: {
          const b = this.stack.pop();
          const a = this.stack.pop();
          this.stack.push(a || b);
          break;
        }
        
        case OpCode.LIST_NEW: {
          this.stack.push([]);
          break;
        }
        
        case OpCode.LIST_APPEND: {
          const val = this.stack.pop();
          const list = this.stack[this.stack.length - 1];
          if (Array.isArray(list)) list.push(val);
          break;
        }
        
        case OpCode.RECORD_NEW: {
          const n = instr.arg as number;
          const fields = this.stack.splice(-n * 2);
          const obj: Record<string, any> = {};
          for (let i = 0; i < n; i++) {
            const val = fields[i * 2];
            const key = fields[i * 2 + 1];
            obj[key] = val;
          }
          this.stack.push(obj);
          break;
        }

        case OpCode.INDEX: {
          const idx = this.stack.pop();
          const obj = this.stack.pop();
          if (Array.isArray(obj)) {
            this.stack.push(obj[idx]);
          } else if (typeof obj === 'string') {
            this.stack.push(obj[idx]);
          } else if (obj && typeof obj === 'object') {
            this.stack.push(obj[idx]);
          } else {
            this.stack.push(undefined);
          }
          break;
        }
        
        case OpCode.HALT: {
          return this.stack.pop();
        }
      }
    }
    return undefined;
  }
}
