import { AsyncLocalStorage, executionAsyncId } from "node:async_hooks";
import type { EventEmitter } from "node:events";
import * as util from "node:util";
import wrapEmitter from "./wrap-emitter";

// String keys (not Symbols) for exact drop-in parity with cls-hooked 4.x:
// ecosystem code and coexisting copies of the library share these keys.
const ERROR_SYMBOL = "error@context";
const CONTEXTS_SYMBOL = "cls@contexts";

type Context = Record<string | symbol, any>;

// Declare the namespace property on process
declare global {
  namespace NodeJS {
    interface Process {
      namespaces: Record<string, Namespace | null>;
    }
  }
}

// Initialize the namespaces object if it doesn't exist.
// Shared registry — coexists with other copies/versions of cls-hooked.
process.namespaces = process.namespaces || Object.create(null);

interface CLSNamespace {
  name: string;
  active: Context | null;
  set<T>(key: string | symbol, value: T): T;
  get(key: string | symbol): any;
  createContext(): Context;
  run<T>(fn: (context: Context) => T): Context;
  runAndReturn<T>(fn: (context: Context) => T): T;
  runPromise<T>(fn: (context: Context) => Promise<T>): Promise<T>;
  bind<T extends Function>(fn: T, context?: Context): T;
  enter(context: Context): void;
  exit(context: Context): void;
  bindEmitter(emitter: EventEmitter): void;
  fromException(exception: any): Context | undefined;
  disableStorage(): void;
}

/**
 * Namespace class to handle continuation-local storage.
 *
 * Contexts propagate through two mechanisms, mirroring cls-hooked 4.x:
 *  - AsyncLocalStorage carries the context across async boundaries
 *    (the job async_hooks' init/before/after used to do).
 *  - `active` + `_set` form the synchronous enter/exit stack, kept only so
 *    the public enter()/exit() API and sync-visible `namespace.active`
 *    behave exactly as before.
 *
 * IMPORTANT invariant: the current context is ALWAYS resolved via
 * _currentContext() (AsyncLocalStorage first). `this.active` must never be
 * written outside enter()/exit() — a stray write leaks one async chain's
 * context into unrelated code, because nothing resets it between callbacks
 * the way the old after() hook did.
 */
class Namespace implements CLSNamespace {
  name: string;
  private _active: Context | null;
  private _set: Array<Context | null>;
  private _storage: AsyncLocalStorage<Context | undefined>;

  constructor(name: string) {
    this.name = name;
    this._active = null;
    this._set = [];
    this._storage = new AsyncLocalStorage<Context | undefined>();
  }

  /**
   * The context current to this execution: the AsyncLocalStorage store when
   * one is present, otherwise the top of the sync enter/exit stack.
   *
   * In cls-hooked 4.x `active` was a plain property that the async_hooks
   * before()/after() hooks kept pointing at the current execution's context.
   * Resolving through AsyncLocalStorage here reproduces those observable
   * semantics (e.g. `ns.active` inside an unbound process.nextTick callback
   * scheduled from within run() is the run's context).
   */
  get active(): Context | null {
    return this._storage.getStore() ?? this._active;
  }

  set active(context: Context | null) {
    this._active = context;
  }

  /**
   * Set a value on the current continuation context
   */
  set<T>(key: string | symbol, value: T): T {
    const context = this.active;

    if (!context) {
      throw new Error("No context available. ns.run() or ns.bind() must be called first.");
    }

    context[key] = value;
    return value;
  }

  /**
   * Get a value from the current continuation context
   */
  get(key: string | symbol): any {
    const context = this.active;

    if (!context) {
      return undefined;
    }

    return context[key];
  }

  /**
   * Create a new context derived from the currently current context
   */
  createContext(): Context {
    // Prototype-inherit the current context so nested contexts see (and can
    // shadow) parent values, exactly like cls-hooked 4.x.
    const current = this.active;
    const context = Object.create(current ? current : Object.prototype);
    context._ns_name = this.name;
    context.id = executionAsyncId();
    return context;
  }

  /**
   * Run the given function within a new context
   */
  run<T>(fn: (context: Context) => T): Context {
    const context = this.createContext();

    return this._storage.run(context, () => {
      this.enter(context);
      try {
        fn(context);
        return context;
      } catch (exception: any) {
        if (exception) {
          exception[ERROR_SYMBOL] = context;
        }
        throw exception;
      } finally {
        this.exit(context);
      }
    });
  }

  /**
   * Run a function within a context and return its value instead of the context
   */
  runAndReturn<T>(fn: (context: Context) => T): T {
    let value: T;
    this.run((context) => {
      value = fn(context);
    });
    return value!;
  }

  /**
   * Run a function that returns a promise within a context
   */
  runPromise<T>(fn: (context: Context) => Promise<T>): Promise<T> {
    const context = this.createContext();

    return this._storage.run(context, () => {
      this.enter(context);

      let promise: Promise<T>;
      try {
        promise = fn(context);
      } catch (exception: any) {
        // cls-hooked 4.x left the context entered on a synchronous throw;
        // exiting here is a deliberate fix, the exception still propagates.
        this.exit(context);
        if (exception) {
          exception[ERROR_SYMBOL] = context;
        }
        throw exception;
      }

      if (!promise || typeof promise.then !== "function" || typeof promise.catch !== "function") {
        this.exit(context);
        throw new Error("fn must return a promise.");
      }

      return promise
        .then((result) => {
          this.exit(context);
          return result;
        })
        .catch((err) => {
          err[ERROR_SYMBOL] = context;
          this.exit(context);
          throw err;
        });
    });
  }

  /**
   * Bind a function to the namespace
   */
  bind<T extends Function>(fn: T, context?: Context): T {
    if (!context) {
      context = this.active || this.createContext();
    }

    const self = this;
    const bound = function (this: any, ...args: any[]) {
      return self._storage.run(context, () => {
        self.enter(context!);
        try {
          return fn.apply(this, args);
        } catch (exception: any) {
          if (exception) {
            exception[ERROR_SYMBOL] = context;
          }
          throw exception;
        } finally {
          self.exit(context!);
        }
      });
    };

    return bound as unknown as T;
  }

  /**
   * Enter a context.
   *
   * Also enters it in AsyncLocalStorage (enterWith) so that async resources
   * created while the context is entered inherit it — the behavior the old
   * async_hooks init hook provided. enterWith affects the remainder of the
   * current synchronous execution; a surrounding _storage.run() (used by
   * run/runPromise/bind) restores its own frame on return, so this is safe
   * to call unconditionally.
   */
  enter(context: Context): void {
    if (!context) {
      throw new Error("context must be provided for entering");
    }

    // Push the sync-stack value (not the getter): enter() may run inside
    // _storage.run() where the getter already resolves to the new context.
    this._set.push(this._active);
    this._active = context;
    this._storage.enterWith(context);
  }

  /**
   * Exit a context
   */
  exit(context: Context): void {
    if (!context) {
      throw new Error("context must be provided for exiting");
    }

    // Fast path for most exits that are at the top of the stack
    if (this.active === context) {
      if (!this._set.length) {
        throw new Error("can't remove top context");
      }

      const popped = this._set.pop();
      this._active = popped === undefined ? null : popped;
      this._storage.enterWith(this._active ?? undefined);
      return;
    }

    // Fast search in the stack using lastIndexOf
    const index = this._set.lastIndexOf(context);

    if (index < 0) {
      throw new Error(
        "context not currently entered; can't exit. \n" +
          util.inspect(this) +
          "\n" +
          util.inspect(context),
      );
    } else {
      if (index === 0) {
        throw new Error("can't remove top context");
      }
      // Exiting a context that is not the current one: remove it from the
      // stack without touching the current frame (matches cls-hooked 4.x).
      this._set.splice(index, 1);
    }
  }

  /**
   * Bind an EventEmitter to this namespace
   */
  bindEmitter(emitter: EventEmitter): void {
    if (!emitter.on || !emitter.addListener || !emitter.emit) {
      throw new Error("can only bind real EventEmitters");
    }

    const namespace = this;
    const thisSymbol = "context@" + this.name;

    // Capture the context current at the time the listener is added.
    function attach(listener: any): void {
      if (!listener) {
        return;
      }

      if (!listener[CONTEXTS_SYMBOL]) {
        listener[CONTEXTS_SYMBOL] = Object.create(null);
      }

      listener[CONTEXTS_SYMBOL][thisSymbol] = {
        namespace: namespace,
        context: namespace.active,
      };
    }

    // Wrap the listener so it fires within the captured context. wrapEmitter
    // invokes this at add time (v4 wrapped at each emit; equivalent, since
    // the contexts were captured at add time there too).
    // Bind for EVERY namespace attached to the listener (not just this one):
    // when an emitter is bound to multiple namespaces, wrapEmitter only
    // invokes the first binder's wrap hook, which must restore all of them.
    function bind(unwrapped: any): any {
      if (!(unwrapped && unwrapped[CONTEXTS_SYMBOL])) {
        return unwrapped;
      }

      let wrapped = unwrapped;
      const unwrappedContexts = unwrapped[CONTEXTS_SYMBOL];
      Object.keys(unwrappedContexts).forEach(function (name) {
        const thunk = unwrappedContexts[name];
        // A null context means the listener was added outside any run() —
        // leave it unbound for that namespace so it runs in the emit-time
        // context, which is what v4's emit-time default resolution did.
        if (thunk.context) {
          wrapped = thunk.namespace.bind(wrapped, thunk.context);
        }
      });
      if (wrapped !== unwrapped) {
        // Keep the recorded contexts introspectable on the stored listener,
        // under the same key where 4.x kept them.
        wrapped[CONTEXTS_SYMBOL] = unwrappedContexts;
      }
      return wrapped;
    }

    wrapEmitter(emitter, attach, bind);
  }

  /**
   * Get the context from an error that was thrown in a namespace
   */
  fromException(exception: any): Context | undefined {
    return exception[ERROR_SYMBOL];
  }

  /**
   * Disable the storage
   */
  disableStorage(): void {
    this._storage.disable();
  }
}

/**
 * Create a new namespace
 */
export function createNamespace(name: string): Namespace {
  if (!name) {
    throw new Error("namespace must be given a name");
  }

  const namespace = new Namespace(name);
  process.namespaces[name] = namespace;
  return namespace;
}

/**
 * Get an existing namespace
 */
export function getNamespace(name: string): Namespace | null | undefined {
  // undefined for never-created, null for destroyed — same as cls-hooked 4.x
  return process.namespaces[name];
}

/**
 * Destroy a namespace
 */
export function destroyNamespace(name: string): void {
  const namespace = getNamespace(name);

  if (!namespace) {
    throw new Error(`can't delete nonexistent namespace! "${name}"`);
  }

  namespace.disableStorage();
  process.namespaces[name] = null;
}

/**
 * Reset all namespaces
 */
export function reset(): void {
  if (process.namespaces) {
    Object.keys(process.namespaces).forEach((name) => {
      if (process.namespaces[name]) {
        destroyNamespace(name);
      }
    });
  }
  process.namespaces = Object.create(null);
}

export { ERROR_SYMBOL };
export type { CLSNamespace, Context };

// Create a default export that has all the main functions
const clsHooked = {
  createNamespace,
  getNamespace,
  destroyNamespace,
  reset,
  ERROR_SYMBOL,
};

export default clsHooked;
