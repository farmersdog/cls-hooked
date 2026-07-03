// Named exports keep CommonJS drop-in compatibility with cls-hooked 4.x:
// `require('cls-hooked').createNamespace` must work. The default export is
// kept for ESM/TS consumers.
export {
  createNamespace,
  getNamespace,
  getNamespaces,
  destroyNamespace,
  reset,
  ERROR_SYMBOL,
} from "./cls-async-storage";
export type { CLSNamespace, Context } from "./cls-async-storage";

import cls from "./cls-async-storage";
export default cls;
