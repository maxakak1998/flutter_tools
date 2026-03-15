import { randomUUID } from 'crypto';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function makeRpcRequest(method: string, params: unknown): JsonRpcRequest {
  return { jsonrpc: '2.0', id: randomUUID(), method, params };
}

export function formatResult(id: string, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function formatError(id: string, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

export function parseRpcRequest(body: string): JsonRpcRequest {
  const parsed = JSON.parse(body);
  if (parsed.jsonrpc !== '2.0' || !parsed.method) {
    throw new Error('Invalid JSON-RPC request');
  }
  return parsed as JsonRpcRequest;
}
