import type { EventEmitter } from "node:events";

/**
 * In-repo replacement for the abandoned `emitter-listener` package.
 *
 * Same job — run a hook when a listener is added, and give the caller a
 * chance to wrap the listener so it fires in the right CLS context — but a
 * fundamentally simpler design. emitter-listener wrapped listeners at *emit*
 * time: it monkeypatched `emit`, transiently rewrote the emitter's private
 * `_events` map on every emit, and wrapped/unwrapped `removeListener` around
 * each emit. All of that existed because with async_hooks the binding target
 * was only cheap to resolve at emit. With AsyncLocalStorage the context is
 * captured when the listener is added, so we wrap listeners once, at add
 * time, and never touch `emit` or `_events` at all.
 *
 * The stored (wrapped) listener gets `.listener` set to the original, which
 * is the same convention Node's own once() wrappers use — so Node's native
 * `removeListener` matching, `listeners()` unwrapping, and the
 * `newListener`/`removeListener` event arguments all keep referring to the
 * original function without any help from us.
 *
 * Protocol compatibility with emitter-listener is preserved on purpose: the
 * add hooks accumulate under the same 'wrap@before' key, and the same
 * `__wrapped` / `__unwrap` markers guard double-patching. A cls-hooked 4.x
 * copy and this module can therefore bind the same emitter: whichever
 * wraps first installs its method patches, both register their add hooks,
 * and each namespace's `bind()` restores its own context.
 */

// Same key emitter-listener uses; the hook registry is shared with it.
const SYMBOL = "wrap@before";

type Listener = (...args: any[]) => void;
type AddHook = (listener: Listener) => void;
type WrapHook = (listener: Listener) => Listener;

// Bookkeeping for wrapped listeners: emitter -> event -> (function the
// caller passed to on/once/etc.) -> stack of wrappers currently registered.
// Needed only for the one removal Node can't resolve natively: a once()
// wrapper removing itself by its own identity, which is hidden inside our
// wrapper. A WeakMap keyed on the emitter avoids property pollution and
// releases everything when the emitter is collected.
const wrappedListeners = new WeakMap<object, Map<string | symbol, Map<Listener, Listener[]>>>();

// Sets a property, preserving its enumerability (same as emitter-listener).
function defineProperty(obj: any, name: string, value: any): void {
  const enumerable = !!obj[name] && Object.prototype.propertyIsEnumerable.call(obj, name);
  Object.defineProperty(obj, name, {
    configurable: true,
    enumerable: enumerable,
    writable: true,
    value: value,
  });
}

function runAddHooks(emitter: any, listener: Listener): void {
  // Read the registry at call time: hooks registered later (another
  // namespace, another copy of the library) must apply to this add too.
  const hooks = emitter[SYMBOL];
  if (typeof hooks === "function") {
    hooks(listener);
  } else if (Array.isArray(hooks)) {
    for (const hook of hooks) {
      hook(listener);
    }
  }
}

function rememberWrapped(
  emitter: object,
  event: string | symbol,
  key: Listener,
  wrapped: Listener,
): void {
  let events = wrappedListeners.get(emitter);
  if (!events) {
    events = new Map();
    wrappedListeners.set(emitter, events);
  }
  let byKey = events.get(event);
  if (!byKey) {
    byKey = new Map();
    events.set(event, byKey);
  }
  const stack = byKey.get(key);
  if (stack) {
    stack.push(wrapped);
  } else {
    byKey.set(key, [wrapped]);
  }
}

function lastWrapped(emitter: object, event: string | symbol, key: Listener): Listener | undefined {
  const stack = wrappedListeners.get(emitter)?.get(event)?.get(key);
  return stack && stack.length ? stack[stack.length - 1] : undefined;
}

// Drop one bookkeeping entry by wrapper identity, wherever it is keyed.
function forgetWrapped(emitter: object, event: string | symbol, wrapped: Listener): void {
  const byKey = wrappedListeners.get(emitter)?.get(event);
  if (!byKey) {
    return;
  }
  for (const [key, stack] of byKey) {
    const index = stack.lastIndexOf(wrapped);
    if (index !== -1) {
      stack.splice(index, 1);
      if (!stack.length) {
        byKey.delete(key);
      }
      return;
    }
  }
}

function forgetEvent(emitter: object, event?: string | symbol): void {
  if (event === undefined) {
    wrappedListeners.delete(emitter);
  } else {
    wrappedListeners.get(emitter)?.delete(event);
  }
}

export default function wrapEmitter(
  emitter: EventEmitter,
  onAddListener: AddHook,
  onWrapListener: WrapHook,
): void {
  const target = emitter as any;

  if (!target || !target.on || !target.addListener || !target.removeListener || !target.emit) {
    throw new Error("can only wrap real EEs");
  }
  if (!onAddListener) {
    throw new Error("must have function to run on listener addition");
  }
  if (!onWrapListener) {
    throw new Error("must have function to wrap listeners when emitting");
  }

  // Register the add hook. Multiple bindings — more namespaces, or a
  // coexisting emitter-listener — accumulate in the shared registry.
  const hooks = target[SYMBOL];
  if (!hooks) {
    defineProperty(target, SYMBOL, onAddListener);
  } else if (typeof hooks === "function") {
    defineProperty(target, SYMBOL, [hooks, onAddListener]);
  } else if (Array.isArray(hooks)) {
    hooks.push(onAddListener);
  }

  // Core methods are patched once per emitter; later calls only contribute
  // their hook above. The first caller's wrap hook services every listener —
  // it is responsible for restoring ALL recorded contexts, which the
  // namespace bind hook does by iterating the listener's recorded thunks.
  if (target.__wrapped) {
    return;
  }

  const originals: Record<string, Listener> = {};

  // once() and prependOnceListener() need no patch of their own: Node
  // implements them as this.on(...) / this.prependListener(...) with a
  // wrapper whose .listener is the original, so they dispatch through the
  // patches below (verified on 22 and 24 in test/tap/wrap-emitter.tap.ts).
  function makeAddPatch(original: Listener): Listener {
    const added = function (this: any, event: string | symbol, listener: any) {
      if (typeof listener !== "function") {
        // Let Node produce its usual ERR_INVALID_ARG_TYPE.
        return original.call(this, event, listener);
      }

      runAddHooks(this, listener);

      const wrapped = onWrapListener(listener);
      if (wrapped === listener) {
        // Nothing to bind — store the original untouched.
        return original.call(this, event, listener);
      }

      // Node's own once-wrapper convention: with .listener pointing at the
      // original, native removeListener/listeners()/listenerCount and the
      // newListener/removeListener event arguments all resolve to the
      // original function. For a once() wrapper, point past it to the
      // user's function, matching what v4 exposed.
      (wrapped as any).listener = listener.listener ?? listener;
      rememberWrapped(this, event, listener, wrapped);
      return original.call(this, event, wrapped);
    };
    (added as any).__wrapped = true;
    return added;
  }

  function makeRemovePatch(original: Listener): Listener {
    // No __wrapped marker here: v4 only ever wrapped removeListener
    // transiently during an emit, so nothing should see it marked.
    return function (this: any, event: string | symbol, listener: any) {
      // Resolve the exact stored function Node would remove, replicating
      // its own scan (last occurrence, matching identity or .listener), so
      // bookkeeping stays in lockstep with what actually gets removed.
      const list: any[] = typeof this.rawListeners === "function" ? this.rawListeners(event) : [];
      let stored: any = null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === listener || (list[i] && list[i].listener === listener)) {
          stored = list[i];
          break;
        }
      }

      if (stored === null) {
        // The one case native matching can't see: a once() wrapper removing
        // itself by its own (hidden) identity. Resolve it via bookkeeping.
        stored = lastWrapped(this, event, listener) ?? listener;
      }

      forgetWrapped(this, event, stored);
      return original.call(this, event, stored);
    };
  }

  function makeRemoveAllPatch(original: Listener): Listener {
    return function (this: any, ...args: any[]) {
      if (args.length === 0) {
        forgetEvent(this);
      } else {
        forgetEvent(this, args[0]);
      }
      return original.apply(this, args);
    };
  }

  function patch(name: string, make: (original: Listener) => Listener): void {
    const original = target[name];
    if (typeof original !== "function") {
      return;
    }
    originals[name] = original;
    defineProperty(target, name, make(original));
  }

  patch("addListener", makeAddPatch);
  patch("on", makeAddPatch);
  patch("prependListener", makeAddPatch);
  patch("removeListener", makeRemovePatch);
  patch("off", makeRemovePatch);
  patch("removeAllListeners", makeRemoveAllPatch);

  defineProperty(target, "__unwrap", function () {
    Object.keys(originals).forEach(function (name) {
      defineProperty(target, name, originals[name]);
    });
    wrappedListeners.delete(target);
    delete target[SYMBOL];
    delete target.__wrapped;
  });
  defineProperty(target, "__wrapped", true);
}
