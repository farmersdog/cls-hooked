/**
 * Consumer patterns that must keep compiling — the idioms codebases written
 * against @types/cls-hooked rely on. Compiled (never executed) by
 * `npm run test:types` under both bundler and NodeNext module resolution.
 */
import cls from "cls-hooked";
import {
  createNamespace,
  destroyNamespace,
  ERROR_SYMBOL,
  getNamespace,
  getNamespaces,
  reset,
} from "cls-hooked";
import type { Namespace } from "cls-hooked";

// Qualified type access through the default import.
export declare const qualified: cls.Namespace;

// getNamespace annotated as `Namespace | undefined` (the @types contract).
export const maybe: Namespace | undefined = cls.getNamespace("session");

// Partial jest-style mock cast directly to Namespace.
export const mockNamespace = {
  set: ((..._args: unknown[]) => undefined) as Namespace["set"],
  get: ((..._args: unknown[]) => undefined) as Namespace["get"],
  runPromise: ((fn: () => Promise<unknown>) => fn()) as Namespace["runPromise"],
  run: (cb: () => unknown) => cb(),
} as Namespace;

// `get` implementations may type the key as plain string.
export const getByInferredKey: Namespace["get"] = (key) => {
  const k: string = key;
  return k;
};
export const getByExplicitString: Namespace["get"] = (key: string) => key;

// Generic namespaces constrain keys and value types.
export const typed = createNamespace<{ userId: number }>("typed");
typed.set("userId", 1);
// @ts-expect-error value type must match the namespace shape
typed.set("userId", "nope");
// @ts-expect-error unknown keys are rejected
typed.get("unknown");

// `active` is any — loose reads compile.
export const activeIsAny: boolean = createNamespace("a").active;

// Remaining named exports keep their v4 call shapes.
export function lifecycle(): void {
  const ns = getNamespace("session");
  ns?.run(() => undefined);
  destroyNamespace("session");
  reset();
}

// New v5 API.
export const registry: Record<string, Namespace | null> = getNamespaces();
export const errKey: string = ERROR_SYMBOL;
