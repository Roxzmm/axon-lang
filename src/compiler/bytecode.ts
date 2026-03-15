export enum OpCode {
  NOP = 0,
  POP,
  DUP,
  SWAP,
  ROT,
  
  LOAD_CONST,
  LOAD_LOCAL,
  STORE_LOCAL,
  LOAD_GLOBAL,
  STORE_GLOBAL,
  
  CALL,
  CALL_NATIVE,
  RETURN,
  
  JUMP,
  JUMP_IF_FALSE,
  JUMP_IF_NOT_NULL,
  
  EQ, NE, LT, LE, GT, GE,
  ADD, SUB, MUL, DIV, MOD,
  NEG, NOT,
  AND, OR,
  
  LIST_NEW,
  LIST_APPEND,
  MAP_NEW,
  MAP_INSERT,
  RECORD_NEW,
  RECORD_SET,
  INDEX,
  FIELD_ACCESS,
  
  TYPE_CHECK,
  
  HALT,
  ERROR,
}

export interface Instruction {
  op: OpCode;
  arg?: number | string | bigint;
}

export interface BytecodeFunction {
  name: string;
  arity: number;
  locals: number;
  code: Instruction[];
}

export interface BytecodeProgram {
  version: number;
  constants: any[];
  functions: BytecodeFunction[];
  main: number;
}

export function serialize(program: BytecodeProgram): Buffer {
  const chunks: Buffer[] = [];
  
  chunks.push(Buffer.from([0x41, 0x58, 0x4F, 0x4E])); // "AXON"
  chunks.push(Buffer.from([program.version & 0xFF]));
  
  chunks.push(Buffer.from([(program.constants.length >> 24) & 0xFF, (program.constants.length >> 16) & 0xFF, (program.constants.length >> 8) & 0xFF, program.constants.length & 0xFF]));
  
  for (const c of program.constants) {
    const type = typeof c;
    if (type === 'number') {
      chunks.push(Buffer.from([0x01, 0x08]));
      chunks.push(Buffer.alloc(8));
      const view = new DataView(chunks[chunks.length - 1].buffer, chunks[chunks.length - 1].byteOffset, 8);
      view.setFloat64(0, c);
    } else if (type === 'string') {
      chunks.push(Buffer.from([0x02]));
      const bytes = Buffer.from(c, 'utf8');
      chunks.push(Buffer.from([(bytes.length >> 24) & 0xFF, (bytes.length >> 16) & 0xFF, (bytes.length >> 8) & 0xFF, bytes.length & 0xFF]));
      chunks.push(bytes);
    } else if (type === 'bigint') {
      chunks.push(Buffer.from([0x03, 0x10]));
      const bytes = Buffer.alloc(16);
      const view = new DataView(bytes.buffer, bytes.byteOffset, 16);
      view.setBigInt64(0, c);
      chunks.push(bytes);
    } else if (c === null) {
      chunks.push(Buffer.from([0x00]));
    } else {
      chunks.push(Buffer.from([0x00]));
    }
  }
  
  return Buffer.concat(chunks);
}

export function disassemble(program: BytecodeProgram): string {
  const safeStringify = (v: any) => {
    if (typeof v === 'bigint') return v.toString() + 'n';
    return JSON.stringify(v);
  };
  let out = `Axon Bytecode v${program.version}\n`;
  out += `Constants: ${program.constants.length}\n`;
  for (let i = 0; i < program.constants.length; i++) {
    out += `  [${i}] ${safeStringify(program.constants[i])}\n`;
  }
  out += `Functions: ${program.functions.length}\n\n`;
  
  for (let i = 0; i < program.functions.length; i++) {
    const fn = program.functions[i];
    out += `Function ${i}: ${fn.name}/${fn.arity} (locals=${fn.locals})\n`;
    for (let pc = 0; pc < fn.code.length; pc++) {
      const instr = fn.code[pc];
      const arg = instr.arg !== undefined ? ` ${safeStringify(instr.arg)}` : '';
      out += `  ${pc}: ${OpCode[instr.op]}${arg}\n`;
    }
    out += '\n';
  }
  
  return out;
}
