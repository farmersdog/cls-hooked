import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventEmitter } from 'node:events';
import * as util from 'node:util';
// @ts-ignore - No type definitions available for emitter-listener
import wrapEmitter from 'emitter-listener';

// Symbols used internally
const ERROR_SYMBOL = Symbol('error@context');
const CONTEXTS_SYMBOL = Symbol('cls@contexts');

// Declare the namespace property on process
declare global {
  namespace NodeJS {
    interface Process {
      namespaces: Record<string, Namespace | null>;
    }
  }
}

// Initialize the namespaces object if it doesn't exist
process.namespaces = process.namespaces || Object.create(null);


interface CLSNamespace {
  name: string;
  active: Record<string | symbol, any> | null;
  set<T>(key: string | symbol, value: T): T;
  get(key: string | symbol): any;
  createContext(): Record<string | symbol, any>;
  run<T>(fn: (context: Record<string | symbol, any>) => T): Record<string | symbol, any>;
  runAndReturn<T>(fn: (context: Record<string | symbol, any>) => T): T;
  runPromise<T>(fn: (context: Record<string | symbol, any>) => Promise<T>): Promise<T>;
  bind<T extends Function>(fn: T, context?: Record<string | symbol, any>): T;
  disableStorage(): void;
}
/**
 * Namespace class to handle continuation-local storage
 */
class Namespace implements CLSNamespace {
  name: string;
  active: Record<string | symbol, any> | null;
  private _set: Array<Record<string | symbol, any> | null>;
  private _storage: AsyncLocalStorage<Record<string | symbol, any>>;

  constructor(name: string) {
    this.name = name;
    this.active = null;
    this._set = [];
    this._storage = new AsyncLocalStorage<Record<string | symbol, any>>();
  }

  /**
   * Set a value on the current continuation context
   */
  set<T>(key: string | symbol, value: T): T {
    // First check if the context exists in AsyncLocalStorage
    const asyncContext = this._storage.getStore();

    if (asyncContext) {
      // If found in AsyncLocalStorage, use that
      asyncContext[key] = value;
      this.active = asyncContext;
      return value;
    }

    // Fall back to the regular active context
    if (!this.active) {
      throw new Error(
        'No context available. ns.run() or ns.bind() must be called first.',
      );
    }

    this.active[key] = value;
    return value;
  }

  /**
   * Get a value from the current continuation context
   */
  get(key: string | symbol): any {
    // First check AsyncLocalStorage
    const asyncContext = this._storage.getStore();

    if (asyncContext) {
      // If AsyncLocalStorage has context, use it and update active
      this.active = asyncContext;
      return asyncContext[key];
    }

    // Fall back to the active context
    if (!this.active) {
      return undefined;
    }

    return this.active[key];
  }

  /**
   * Create a new context derived from the currently active context
   */
  createContext(): Record<string | symbol, any> {
    // Check if there's a context in AsyncLocalStorage first
    const asyncContext = this._storage.getStore();

    if (asyncContext) {
      // If we have context in AsyncLocalStorage, base the new context on that
      const context = Object.create(asyncContext);
      context._ns_name = this.name;
      return context;
    }

    // Otherwise fall back to the active context
    const context = Object.create(this.active ? this.active : Object.prototype);
    context._ns_name = this.name;
    return context;
  }

  /**
   * Run the given function within a new context
   */
  run<T>(
    fn: (context: Record<string | symbol, any>) => T,
  ): Record<string | symbol, any> {
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
  runAndReturn<T>(fn: (context: Record<string | symbol, any>) => T): T {
    let value: T;
    this.run(context => {
      value = fn(context);
    });
    return value!;
  }

  /**
   * Run a function that returns a promise within a context
   */
  runPromise<T>(
    fn: (context: Record<string | symbol, any>) => Promise<T>,
  ): Promise<T> {
    const context = this.createContext();

    return this._storage.run(context, () => {
      this.enter(context);

      const promise = fn(context);
      if (
        !promise ||
        typeof promise.then !== 'function' ||
        typeof promise.catch !== 'function'
      ) {
        this.exit(context);
        throw new Error('fn must return a promise.');
      }

      return promise
        .then(result => {
          this.exit(context);
          return result;
        })
        .catch(err => {
          err[ERROR_SYMBOL] = context;
          this.exit(context);
          throw err;
        });
    });
  }

  /**
   * Bind a function to the namespace
   */
  bind<T extends Function>(fn: T, context?: Record<string | symbol, any>): T {
    if (!context) {
      context = this.active || this.createContext();
    }

    const self = this;
    // Use a wrapper function instead of AsyncLocalStorage.bind
    const bound = function (this: any, ...args: any[]) {
      // Use run with AsyncLocalStorage to ensure context propagation
      return self._storage.run(context!, () => {
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
   * Enter a context
   */
  enter(context: Record<string | symbol, any>): void {
    if (!context) {
      throw new Error('context must be provided for entering');
    }

    this._set.push(this.active);
    this.active = context;
  }

  /**
   * Exit a context
   */
  exit(context: Record<string | symbol, any>): void {
    if (!context) {
      throw new Error('context must be provided for exiting');
    }

    // Fast path for most exits that are at the top of the stack
    if (this.active === context) {
      if (!this._set.length) {
        throw new Error("can't remove top context");
      }

      const popped = this._set.pop();
      this.active = popped === undefined ? null : popped;
      return;
    }

    // Fast search in the stack using lastIndexOf
    const index = this._set.lastIndexOf(context);

    if (index < 0) {
      throw new Error(
        "context not currently entered; can't exit. \n" +
          util.inspect(this) +
          '\n' +
          util.inspect(context)
      );
    } else {
      if (index === 0) {
        throw new Error("can't remove top context");
      }
      this._set.splice(index, 1);
    }
  }

  /**
   * Bind an EventEmitter to this namespace
   */
  bindEmitter(emitter: EventEmitter): void {
    if (!emitter.on || !emitter.addListener || !emitter.emit) {
      throw new Error('can only bind real EventEmitters');
    }

    const namespace = this;
    const thisSymbol = 'context@' + this.name;

    // Capture the context active at the time the emitter is bound.
    function attach(listener: any): void {
      if (!listener) {
        return;
      }

      if (!listener[CONTEXTS_SYMBOL]) {
        listener[CONTEXTS_SYMBOL] = Object.create(null);
      }

      // Store the active context for this namespace at the time of binding
      listener[CONTEXTS_SYMBOL][thisSymbol] = {
        namespace: namespace,
        context: namespace.active
      };
    }

    // At emit time, bind the listener within the correct context.
    function bind(unwrapped: any): any {
      if (!(unwrapped && unwrapped[CONTEXTS_SYMBOL])) {
        return unwrapped;
      }

      const unwrappedContexts = unwrapped[CONTEXTS_SYMBOL];
      if (!unwrappedContexts[thisSymbol]) return unwrapped;

      // Create a new wrapped function that preserves the original binding context
      const context = unwrappedContexts[thisSymbol].context;
      const wrapped = function(this: any) {
        return namespace.bind(unwrapped, context).apply(this, arguments);
      };

      // Preserve the contexts metadata on the wrapped function
      wrapped[CONTEXTS_SYMBOL] = unwrappedContexts;

      return wrapped;
    }

    wrapEmitter(emitter, attach, bind);
  }

  /**
   * Get the context from an error that was thrown in a namespace
   */
  fromException(exception: any): Record<string | symbol, any> | undefined {
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
    throw new Error('namespace must be given a name');
  }

  const namespace = new Namespace(name);
  process.namespaces[name] = namespace;
  return namespace;
}

/**
 * Get an existing namespace
 */
export function getNamespace(name: string): Namespace | null {
  return process.namespaces[name] || null;
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
    Object.keys(process.namespaces).forEach(name => {
      if (process.namespaces[name]) {
        destroyNamespace(name);
      }
    });
  }
  process.namespaces = Object.create(null);
}

export type { CLSNamespace };

// Create a default export that has all the main functions
const clsHooked = {
  createNamespace,
  getNamespace,
  destroyNamespace,
  reset,
  ERROR_SYMBOL,
};

export default clsHooked;
