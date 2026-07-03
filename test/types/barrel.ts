/**
 * A common consumption shape: a re-export barrel that imports the library
 * once and re-exports it, with the rest of the codebase consuming the
 * default export — including namespace-qualified type access
 * (`cls.Namespace`) via barrel-consumer.ts.
 */
import hooked from "cls-hooked";
import type { Namespace } from "cls-hooked";
import type CLS from "cls-hooked";

export type { Namespace, CLS };
export default hooked;
