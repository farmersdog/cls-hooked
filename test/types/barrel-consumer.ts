/**
 * Patterns consuming the re-export barrel.
 */
import cls from "./barrel";
import type { Namespace } from "./barrel";

// Namespace-qualified type access through the re-exported default binding.
export function getClsNamespace(): cls.Namespace | undefined {
  return cls.getNamespace("session");
}

export type StringOrNamespace = string | cls.Namespace;

export const viaNamedType: Namespace | undefined = cls.getNamespace("session");

// Partial mock cast, then used where createNamespace's return type is
// expected (jest's mockReturnValue).
export const mock = {
  set: (() => undefined) as cls.Namespace["set"],
  run: (cb: () => unknown) => cb(),
} as cls.Namespace;
export const created: ReturnType<typeof cls.createNamespace> = mock;
