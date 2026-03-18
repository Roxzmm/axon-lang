import { BytecodeProgram, BytecodeFunction, OpCode, Instruction } from './bytecode';

export interface WasmModule {
  wat: string;
  binary?: Uint8Array;
}

const WASM_I32 = 'i32';
const WASM_I64 = 'i64';
const WASM_F32 = 'f32';
const WASM_F64 = 'f64';
const WASM_FUNC = 'func';
const WASM_EXTERNREF = 'externref';

export class WasmCompiler {
  private program: BytecodeProgram;
  private functions: string[] = [];
  private locals: Map<string, number[]> = new Map();
  private labelId = 0;
  private currentFn = '';

  constructor(program: BytecodeProgram) {
    this.program = program;
  }

  compile(): WasmModule {
    const sections: string[] = [];
    
    sections.push(this.generateTypes());
    sections.push(this.generateGlobals());
    sections.push(this.generateFunctions());
    sections.push(this.generateExports());
    
    const memory = '(memory 1)';
    
    const wat = `(module\n  ${memory}\n${sections.join('\n')}\n)`;
    
    return { wat };
  }

  private generateGlobals(): string {
    return '(global $global (mut i32) (i32.const 0))';
  }

  private generateTypes(): string {
    const typeDecls: string[] = [];
    
    typeDecls.push('(type $t0 (func (result i32)))');
    
    for (let i = 1; i < this.program.functions.length; i++) {
      typeDecls.push(`(type $t${i} (func (result i32)))`);
    }
    
    return typeDecls.join('\n  ');
  }

  private generateFunctions(): string {
    const funcDefs: string[] = [];
    
    for (let i = 0; i < this.program.functions.length; i++) {
      const fn = this.program.functions[i];
      const funcDef = this.compileFunction(fn, i);
      funcDefs.push(funcDef);
    }
    
    return funcDefs.join('\n  ');
  }

  private compileFunction(fn: BytecodeFunction, index: number): string {
    this.currentFn = fn.name;
    this.labelId = 0;
    
    const localDecls = this.generateLocals(fn);
    const body = this.compileBody(fn.code);
    
    return `(func $${fn.name || 'main'} (export "${fn.name || 'main'}") (type $t${index})\n  ${localDecls}\n  ${body}\n)`;
  }

  private generateLocals(fn: BytecodeFunction): string {
    if (fn.locals <= 0) return '';
    return `;; ${fn.locals} locals reserved`;
  }

  private compileBody(code: Instruction[]): string {
    const instructions: string[] = [];
    
    for (let i = 0; i < code.length; i++) {
      const instr = code[i];
      const wasm = this.compileInstruction(instr, i, code);
      if (wasm) instructions.push(wasm);
    }
    
    if (instructions.length === 0) {
      instructions.push('(i32.const 0)');
    }
    
    return instructions.join('\n    ');
  }

  private compileInstruction(instr: Instruction, pc: number, code: Instruction[]): string | null {
    switch (instr.op) {
      case OpCode.NOP:
        return null;
        
      case OpCode.POP:
        return ';; pop';
        
      case OpCode.DUP:
        return ';; dup';
        
      case OpCode.LOAD_CONST: {
        const idx = instr.arg as number;
        const value = this.program.constants[idx];
        if (typeof value === 'bigint') {
          return `(i32.const ${value})`;
        } else if (typeof value === 'number') {
          if (Number.isInteger(value)) {
            return `(i32.const ${value})`;
          } else {
            const bits = new Uint32Array(new Float64Array([value]).buffer)[0];
            return `(i32.const ${bits})`;
          }
        } else if (typeof value === 'string') {
          return `(i32.const ${this.hashString(value)})`;
        } else if (value === null) {
          return '(i32.const 0)';
        }
        return '(i32.const 0)';
      }
      
      case OpCode.LOAD_LOCAL: {
        const idx = instr.arg as number;
        return `(local.get ${idx})`;
      }
      
      case OpCode.STORE_LOCAL: {
        const idx = instr.arg as number;
        return `(local.set ${idx})`;
      }
      
      case OpCode.LOAD_GLOBAL: {
        const idx = instr.arg as number;
        const constVal = this.program.constants[idx];
        if (typeof constVal === 'string' && this.isFunctionName(constVal)) {
          return `(call $${constVal})`;
        }
        return '(global.get $global)';
      }

      case OpCode.STORE_GLOBAL: {
        return '(global.set $global)';
      }
      
      case OpCode.ADD:
        return '(i32.add)';
        
      case OpCode.SUB:
        return '(i32.sub)';
        
      case OpCode.MUL:
        return '(i32.mul)';
        
      case OpCode.DIV:
        return '(i32.div_s)';
        
      case OpCode.MOD:
        return '(i32.rem_s)';
        
      case OpCode.NEG:
        return '(i32.const -1) (i32.mul)';
        
      case OpCode.EQ:
        return '(i32.eq)';
        
      case OpCode.NE:
        return '(i32.ne)';
        
      case OpCode.LT:
        return '(i32.lt_s)';
        
      case OpCode.LE:
        return '(i32.le_s)';
        
      case OpCode.GT:
        return '(i32.gt_s)';
        
      case OpCode.GE:
        return '(i32.ge_s)';
        
      case OpCode.NOT:
        return '(i32.const 0) (i32.eq)';
        
      case OpCode.AND:
        return '(i32.and)';
        
      case OpCode.OR:
        return '(i32.or)';
        
      case OpCode.JUMP: {
        const target = instr.arg as number;
        return `(br ${this.getLabel(target, code)})`;
      }
      
      case OpCode.JUMP_IF_FALSE: {
        const target = instr.arg as number;
        return `(if (then (br ${this.getLabel(target, code)})))`;
      }
      
      case OpCode.CALL: {
        const arg = instr.arg;
        if (typeof arg === 'number') {
          const constVal = this.program.constants[arg];
          if (typeof constVal === 'string' && this.isFunctionName(constVal)) {
            return `(call $${constVal})`;
          }
        }
        return '(call $unknown)';
      }
      
      case OpCode.RETURN: {
        return ';; return';
      }
      
      case OpCode.HALT:
        return ';; halt';
        
      case OpCode.ERROR:
        return ';; error';
        
      default:
        return `;; unknown opcode ${instr.op}`;
    }
  }

  private getLabel(target: number, code: Instruction[]): number {
    return 0;
  }

  private isFunctionName(name: string): boolean {
    return this.program.functions.some(fn => fn.name === name);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private generateExports(): string {
    const exports: string[] = [];
    for (let i = 0; i < this.program.functions.length; i++) {
      const fn = this.program.functions[i];
      exports.push(`(export "${fn.name || 'main'}" (func $${fn.name || 'main'}))`);
    }
    return exports.join('\n  ');
  }
}

export function compileToWasm(program: BytecodeProgram): WasmModule {
  const compiler = new WasmCompiler(program);
  return compiler.compile();
}
