import * as readline from 'readline';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface LSPMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

class LSPClient {
  private rl: readline.Interface;
  private pendingRequests = new Map<number | string, { resolve: (v: any) => void, reject: (e: any) => void }>();
  private notificationHandlers = new Map<string, (params: any) => void>();
  private requestHandlers = new Map<string, (params: any) => any>();
  private messageId = 0;
  private buffer = '';

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    process.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });
  }

  private processBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/);
      if (!contentLengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) return;

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body) as LSPMessage;
        this.handleMessage(message);
      } catch (e) {
        console.error('Parse error:', e);
      }
    }
  }

  private handleMessage(message: LSPMessage) {
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      const handler = this.requestHandlers.get(message.method);
      if (handler) {
        const result = handler(message.params);
        if (message.id !== undefined) {
          this.send({ jsonrpc: '2.0', id: message.id, result });
        }
      } else {
        const notifHandler = this.notificationHandlers.get(message.method);
        if (notifHandler) {
          notifHandler(message.params);
        }
      }
    }
  }

  sendRequest<T>(method: string, params: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  sendNotification(method: string, params: any) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  onNotification(method: string, handler: (params: any) => void) {
    this.notificationHandlers.set(method, handler);
  }

  onRequest(method: string, handler: (params: any) => any) {
    this.requestHandlers.set(method, handler);
  }

  private send(message: LSPMessage) {
    const body = JSON.stringify(message);
    const header = `Content-Length: ${body.length}\r\n\r\n`;
    process.stdout.write(header + body);
  }
}

class AxonLanguageServer {
  private client: LSPClient;
  private documents = new Map<string, string>();

  constructor() {
    this.client = new LSPClient();
    this.setupHandlers();
  }

  private setupHandlers() {
    this.client.onRequest('initialize', (_params) => {
      return {
        capabilities: {
          textDocumentSync: 1,
          codeActionProvider: true,
          completionProvider: { resolveProvider: false },
          definitionProvider: true,
          hoverProvider: true,
          diagnosticProvider: true
        }
      };
    });

    this.client.onNotification('textDocument/didOpen', (params) => {
      this.documents.set(params.textDocument.uri, params.textDocument.text);
      this.validateDocument(params.textDocument.uri, params.textDocument.text);
    });

    this.client.onNotification('textDocument/didChange', (params) => {
      const doc = this.documents.get(params.textDocument.uri);
      if (doc && params.contentChanges[0]) {
        this.documents.set(params.textDocument.uri, params.contentChanges[0].text);
        this.validateDocument(params.textDocument.uri, params.contentChanges[0].text);
      }
    });

    this.client.onNotification('textDocument/didSave', (params) => {
      const doc = this.documents.get(params.textDocument.uri);
      if (doc) {
        this.validateDocument(params.textDocument.uri, doc);
      }
    });

    this.client.onNotification('textDocument/didClose', (params) => {
      this.documents.delete(params.textDocument.uri);
    });

    this.client.onRequest('textDocument/completion', (params) => {
      return this.provideCompletion(params);
    });

    this.client.onRequest('textDocument/definition', (params) => {
      return this.provideDefinition(params);
    });

    this.client.onRequest('textDocument/hover', (params) => {
      return this.provideHover(params);
    });

    this.client.onRequest('textDocument/codeAction', (params) => {
      return this.provideCodeAction(params);
    });
  }

  private async validateDocument(uri: string, content: string) {
    try {
      const tempFile = path.join('/tmp', `axon_lsp_${Date.now()}.axon`);
      fs.writeFileSync(tempFile, content);

      const result = await this.runAxonCheck(tempFile);
      
      const diagnostics = result.split('\n')
        .filter(line => line.includes('Error') || line.includes('Warning'))
        .map(line => {
          const match = line.match(/Error at line (\d+): (.+)/);
          if (match) {
            return {
              range: {
                start: { line: parseInt(match[1]) - 1, character: 0 },
                end: { line: parseInt(match[1]) - 1, character: 1000 }
              },
              severity: 1,
              message: match[2]
            };
          }
          return null;
        })
        .filter(d => d !== null);

      this.client.sendNotification('textDocument/publishDiagnostics', { uri, diagnostics });
      fs.unlinkSync(tempFile);
    } catch (e) {}
  }

  private runAxonCheck(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', ['dist/main.js', 'check', filePath], {
        cwd: path.dirname(__dirname)
      });
      let output = '';
      proc.stdout.on('data', d => output += d);
      proc.stderr.on('data', d => output += d);
      proc.on('close', () => resolve(output));
      proc.on('error', reject);
    });
  }

  private provideCompletion(_params: any): any {
    const keywords = [
      'agent', 'state', 'on', 'spawn', 'spawn_parallel', 'send', 'ask',
      'fn', 'let', 'mut', 'if', 'else', 'match', 'type', 'enum',
      'return', 'break', 'continue', 'loop', 'while', 'for',
      'true', 'false', 'null', 'Unit', 'Int', 'Float', 'String', 'Bool',
      'List', 'Map', 'Result', 'Option', 'pub', 'priv', 'impl',
      'with', 'where', 'use', 'module', 'from', 'as'
    ];

    const completions = keywords.map(kw => ({
      label: kw,
      kind: 14,
      insertText: kw
    }));

    const functions = [
      'print', 'read_file', 'write_file', 'fs_mkdir', 'fs_remove',
      'list_map', 'list_filter', 'list_reduce', 'list_sum', 'list_len',
      'map_empty', 'map_insert', 'map_get', 'map_has', 'map_remove',
      'json_parse', 'json_stringify', 'json_get', 'result_ok', 'result_err',
      'option_some', 'option_none', 'option_unwrap', 'result_unwrap'
    ];

    functions.forEach(fn => {
      completions.push({ label: fn, kind: 3, insertText: fn });
    });

    return completions;
  }

  private provideDefinition(_params: any): any {
    return null;
  }

  private provideHover(params: any): any {
    const content = this.documents.get(params.textDocument.uri);
    if (!content) return null;

    const lines = content.split('\n');
    const line = lines[params.position.line] || '';
    
    const keywordDocs: Record<string, string> = {
      'agent': 'Agent definition: A reactive entity with state and message handlers.',
      'spawn': 'Spawn an agent instance.',
      'spawn_parallel': 'Spawn an agent in a separate worker thread.',
      'send': 'Send a fire-and-forget message to an agent.',
      'ask': 'Send a message and wait for response.',
      'fn': 'Function definition.',
      'let': 'Immutable variable binding.',
      'mut': 'Mutable variable binding.',
      'match': 'Pattern matching expression.',
      'type': 'Type alias or type definition.',
      'enum': 'Algebraic data type definition.'
    };

    for (const [kw, doc] of Object.entries(keywordDocs)) {
      if (line.includes(kw)) {
        return { contents: { kind: 'markdown', value: `**${kw}**\n\n${doc}` } };
      }
    }

    return null;
  }

  private provideCodeAction(_params: any): any {
    return [];
  }

  start() {}
}

const server = new AxonLanguageServer();
server.start();
