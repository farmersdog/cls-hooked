/**
 * The implementation must satisfy the declared surface (at the default
 * generic instantiation), so the hand-authored declarations can't silently
 * drift from the code.
 */
import type { Namespace } from "cls-hooked";
import * as decl from "cls-hooked";
import implDefault from "../../index";
import * as impl from "../../index";

export const createNamespace: (name: string) => Namespace = impl.createNamespace;
// Deliberate divergence: runtime returns `null` for a destroyed namespace;
// declared as undefined-only to match the @types/cls-hooked contract.
export const getNamespace: (name: string) => Namespace | null | undefined = impl.getNamespace;
export const destroyNamespace: typeof decl.destroyNamespace = impl.destroyNamespace;
export const reset: typeof decl.reset = impl.reset;
export const getNamespaces: () => Record<string, Namespace | null> = impl.getNamespaces;
export const errorSymbol: typeof decl.ERROR_SYMBOL = impl.ERROR_SYMBOL;

// The default export must carry the same surface.
export const dflt: {
  createNamespace: (name: string) => Namespace;
  getNamespace: (name: string) => Namespace | null | undefined;
  destroyNamespace: typeof decl.destroyNamespace;
  reset: typeof decl.reset;
  getNamespaces: () => Record<string, Namespace | null>;
  ERROR_SYMBOL: string;
} = implDefault;
