/**
 * Hand-authored public type declarations.
 *
 * The shape deliberately mirrors `@types/cls-hooked@4.3.x` (DefinitelyTyped,
 * MIT licensed) so that v4 consumers switching to v5 keep compiling with zero
 * code changes — the declarations, not the (stricter) implementation types,
 * are the public contract. New v5 API is declared additively at the bottom.
 * Type-level compatibility is enforced by `npm run test:types`.
 */

import { EventEmitter } from "node:events";

export interface Namespace<N = Record<string, any>> {
  active: any;

  set<K extends keyof N = keyof N>(key: K, value: N[K]): N[K];
  get<K extends keyof N = keyof N>(key: K): N[K];
  run(fn: (...args: any[]) => void): void;
  runAndReturn<T>(fn: (...args: any[]) => T): T;
  runPromise<T>(fn: (...args: any[]) => Promise<T>): Promise<T>;
  bind<F extends Function>(fn: F, context?: any): F;
  bindEmitter(emitter: EventEmitter): void;
  createContext(): any;
  enter(context: any): void;
  exit(context: any): void;
}

export function createNamespace<N = Record<string, any>>(name: string): Namespace<N>;
/**
 * Declared as `Namespace | undefined` to match the `@types/cls-hooked`
 * contract existing code was written against; at runtime a *destroyed*
 * namespace returns `null` (falsy either way).
 */
export function getNamespace<N = Record<string, any>>(name: string): Namespace<N> | undefined;
export function destroyNamespace(name: string): void;
export function reset(): void;

// --- New in v5 (not present in @types/cls-hooked) ---

/**
 * The registry of all namespaces, keyed by name (`null` marks a destroyed
 * namespace). Replaces v4's `process.namespaces`.
 */
export function getNamespaces(): Record<string, Namespace | null>;

/** Key under which run/bind attach the failing context to a thrown error. */
export const ERROR_SYMBOL: string;
