/** A JSON number token, never routed through an IEEE-754 conversion on read/write. */
export class LosslessNumber {
  readonly raw: string;
  constructor(raw: string) {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
      throw new TypeError('Invalid JSON number token');
    }
    this.raw = raw;
    Object.freeze(this);
  }
  toString(): string { return this.raw; }
  /** Prevent accidental corruption by JSON.stringify rather than silently changing the type. */
  toJSON(): never { throw new TypeError('Use stringifyLosslessJSON for lossless numbers'); }
}

export type JsonPrimitive = null | boolean | string | number | LosslessNumber;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export interface ParseOptions { maxDepth?: number; maxLength?: number }
export class SaveFormatError extends Error {
  constructor(message: string, readonly offset?: number) {
    super(offset === undefined ? message : `${message} at offset ${offset}`);
    this.name = 'SaveFormatError';
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    !(value instanceof LosslessNumber) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Number spelling is preserved; safe canonical numbers use JS numbers, all others tokens. */
export function parseLosslessJSON(text: string, options: ParseOptions = {}): JsonValue {
  const maxDepth = options.maxDepth ?? 256;
  const maxLength = options.maxLength ?? 128 * 1024 * 1024;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 1024 ||
      !Number.isSafeInteger(maxLength) || maxLength < 1) throw new TypeError('Invalid parser limits');
  if (typeof text !== 'string' || text.length > maxLength) throw new SaveFormatError('JSON input too large or not text');
  let i = 0;
  const fail = (message: string): never => { throw new SaveFormatError(message, i); };
  const whitespace = () => { while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++; };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      const char = text[i++];
      if (char === '"') {
        try { return JSON.parse(text.slice(start, i)) as string; }
        catch { return fail('Invalid JSON string'); }
      }
      if (char === '\\') i++;
    }
    return fail('Unterminated JSON string');
  };
  const value = (depth: number): JsonValue => {
    if (depth > maxDepth) return fail('JSON nesting limit exceeded');
    whitespace();
    const char = text[i];
    if (char === '"') return string();
    if (char === '{') {
      i++; whitespace();
      const result = Object.create(null) as JsonObject;
      if (text[i] === '}') { i++; return result; }
      while (true) {
        if (text[i] !== '"') return fail('Expected object key');
        const key = string();
        if (Object.hasOwn(result, key)) return fail('Duplicate object key');
        whitespace();
        if (text[i++] !== ':') return fail('Expected colon');
        result[key] = value(depth + 1);
        whitespace();
        if (text[i] === '}') { i++; return result; }
        if (text[i++] !== ',') return fail('Expected object comma');
        whitespace();
      }
    }
    if (char === '[') {
      i++; whitespace();
      const result: JsonValue[] = [];
      if (text[i] === ']') { i++; return result; }
      while (true) {
        result.push(value(depth + 1)); whitespace();
        if (text[i] === ']') { i++; return result; }
        if (text[i++] !== ',') return fail('Expected array comma');
      }
    }
    for (const [token, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, i)) { i += token.length; return literal; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (match) {
      i += match[0].length;
      const numeric = Number(match[0]);
      // Canonically spelled safe values remain convenient for existing domain/UI code.
      // Everything else keeps its exact token (large ints, -0, exponents, rounded decimals).
      if (Number.isFinite(numeric) && (!Number.isInteger(numeric) || Number.isSafeInteger(numeric)) && String(numeric) === match[0]) return numeric;
      return new LosslessNumber(match[0]);
    }
    return fail('Expected JSON value');
  };
  const result = value(0);
  whitespace();
  if (i !== text.length) fail('Unexpected trailing content');
  return result;
}

/** Strict writer: refuses cycles, unsupported objects, undefined, holes and unsafe JS integers. */
export function stringifyLosslessJSON(value: JsonValue, space = 2): string {
  if (!Number.isInteger(space) || space < 0 || space > 10) throw new TypeError('Indent must be 0..10');
  const ancestors = new Set<object>();
  const write = (node: JsonValue, depth: number): string => {
    if (depth > 256) throw new SaveFormatError('JSON nesting limit exceeded');
    if (node instanceof LosslessNumber) {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(node.raw)) throw new SaveFormatError('Invalid JSON number token');
      return node.raw;
    }
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return JSON.stringify(node);
    if (typeof node === 'number') {
      if (!Number.isFinite(node) || (Number.isInteger(node) && !Number.isSafeInteger(node))) {
        throw new SaveFormatError('Unsafe JavaScript number; use LosslessNumber');
      }
      return Object.is(node, -0) ? '-0' : String(node);
    }
    if (!Array.isArray(node) && !isJsonObject(node)) throw new SaveFormatError('Unsupported JSON value');
    if (ancestors.has(node)) throw new SaveFormatError('Cyclic JSON value');
    ancestors.add(node);
    const array = Array.isArray(node);
    const entries: string[] = [];
    if (array) {
      for (let index = 0; index < node.length; index++) {
        if (!Object.hasOwn(node, index)) throw new SaveFormatError('Sparse JSON array');
        entries.push(write(node[index], depth + 1));
      }
    } else {
      if (Object.getOwnPropertySymbols(node).length) throw new SaveFormatError('Symbol JSON keys are unsupported');
      for (const key of Object.keys(node)) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor || !('value' in descriptor)) throw new SaveFormatError('JSON accessors are unsupported');
        entries.push(`${JSON.stringify(key)}:${space ? ' ' : ''}${write(node[key], depth + 1)}`);
      }
    }
    ancestors.delete(node);
    const [open, close] = array ? ['[', ']'] : ['{', '}'];
    if (!entries.length) return open + close;
    if (!space) return open + entries.join(',') + close;
    const indent = ' '.repeat(space * (depth + 1));
    return `${open}\n${indent}${entries.join(`,\n${indent}`)}\n${' '.repeat(space * depth)}${close}`;
  };
  return write(value, 0);
}

export function cloneLosslessJSON<T extends JsonValue>(value: T): T {
  return parseLosslessJSON(stringifyLosslessJSON(value, 0)) as T;
}

/** Only integer tokens within JS's exact range can participate in coordinates/validation. */
export function asSafeInteger(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (!(value instanceof LosslessNumber) || !/^-?(?:0|[1-9]\d*)$/.test(value.raw)) return undefined;
  const number = Number(value.raw);
  return Number.isSafeInteger(number) ? number : undefined;
}
