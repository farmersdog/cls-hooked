"use strict";

// Unit tests for wrap-emitter, the in-repo replacement for the abandoned
// (and untested) emitter-listener package. Exercises the wrapper directly,
// plus the EventEmitter integration points the design depends on:
// once() delegation, .listener-based removal/introspection, prepend
// ordering, duplicate listeners, and the shared-hook protocol.

import * as tap from "tap";
import { EventEmitter } from "node:events";
import wrapEmitter from "../../wrap-emitter";
import cls from "../../index";

const test = tap.test;

// A minimal wrap hook that tags listener invocations so tests can tell
// wrapped from unwrapped execution.
function taggingHooks(tag: string, calls: string[]) {
  return {
    attach(listener: any) {
      listener.attached = (listener.attached || 0) + 1;
    },
    wrap(listener: any) {
      const wrapped = function (this: any, ...args: any[]) {
        calls.push(tag);
        return listener.apply(this, args);
      };
      return wrapped;
    },
  };
}

test("argument validation matches emitter-listener", function (t) {
  const ee = new EventEmitter();
  t.throws(
    () =>
      (wrapEmitter as any)(
        null,
        () => {},
        (f: any) => f,
      ),
    "rejects non-emitters",
  );
  t.throws(
    () =>
      (wrapEmitter as any)(
        {},
        () => {},
        (f: any) => f,
      ),
    "rejects duck-typed non-emitters",
  );
  t.throws(() => (wrapEmitter as any)(ee, null, (f: any) => f), "requires an add hook");
  t.throws(() => (wrapEmitter as any)(ee, () => {}), "requires a wrap hook");
  t.end();
});

test("attach hook runs on add; wrap hook wraps execution", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const got: any[] = [];
  const listener = function (arg: any) {
    got.push(arg);
  };
  ee.on("data", listener);

  t.equal((listener as any).attached, 1, "attach hook ran once");
  ee.emit("data", "x");
  ee.emit("data", "y");
  t.same(got, ["x", "y"], "listener received both emits");
  t.same(calls, ["w", "w"], "wrapper ran around each invocation");
  t.end();
});

test("wrap hook returning the listener stores it untouched", function (t) {
  const ee = new EventEmitter();
  wrapEmitter(
    ee,
    () => {},
    (fn) => fn,
  );
  const listener = () => {};
  ee.on("data", listener);
  t.equal(ee.rawListeners("data")[0], listener, "original stored as-is");
  ee.removeListener("data", listener);
  t.equal(ee.listenerCount("data"), 0, "native removal works");
  t.end();
});

test("removeListener removes a wrapped listener by the original", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const listener = () => {
    t.fail("removed listener must not fire");
  };
  ee.on("data", listener);
  t.equal(ee.listenerCount("data"), 1);
  ee.removeListener("data", listener);
  t.equal(ee.listenerCount("data"), 0, "wrapped listener removed via original");
  ee.emit("data");
  t.end();
});

test("off() is patched the same as removeListener", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const listener = () => {
    t.fail("removed listener must not fire");
  };
  ee.on("data", listener);
  ee.off("data", listener);
  t.equal(ee.listenerCount("data"), 0, "off() removes the wrapped listener");
  ee.emit("data");
  t.end();
});

test("once() fires wrapped exactly once and self-removes", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  let fired = 0;
  ee.once("data", () => {
    fired++;
  });
  ee.emit("data");
  ee.emit("data");
  t.equal(fired, 1, "once listener fired exactly once");
  t.same(calls, ["w"], "and it fired wrapped");
  t.equal(ee.listenerCount("data"), 0, "once self-removal removed the wrapper");
  t.end();
});

test("once() removed early by the original before firing", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const listener = () => {
    t.fail("removed once listener must not fire");
  };
  ee.once("data", listener);
  ee.removeListener("data", listener);
  t.equal(ee.listenerCount("data"), 0, "once listener removed by original");
  ee.emit("data");
  t.end();
});

test("prependListener is wrapped and keeps prepend ordering", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const order: string[] = [];
  ee.on("data", () => order.push("second"));
  ee.prependListener("data", () => order.push("first"));
  ee.emit("data");
  t.same(order, ["first", "second"], "prepended listener ran first");
  t.same(calls, ["w", "w"], "both ran wrapped");
  t.end();
});

test("prependOnceListener is wrapped via prependListener delegation", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  let fired = 0;
  ee.prependOnceListener("data", () => {
    fired++;
  });
  ee.emit("data");
  ee.emit("data");
  t.equal(fired, 1, "fired once");
  t.same(calls, ["w"], "fired wrapped");
  t.equal(ee.listenerCount("data"), 0, "self-removed");
  t.end();
});

test("duplicate listener registrations remove in native (LIFO) order", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  let counter = 0;
  wrapEmitter(
    ee,
    () => {},
    (fn) => {
      const id = ++counter;
      return function (this: any, ...args: any[]) {
        calls.push("w" + id);
        return fn.apply(this, args);
      };
    },
  );

  const listener = () => {};
  ee.on("data", listener);
  ee.on("data", listener);
  t.equal(ee.listenerCount("data"), 2, "duplicates both registered");

  ee.removeListener("data", listener);
  ee.emit("data");
  t.same(calls, ["w1"], "last-added wrapper removed first, like native Node");

  ee.removeListener("data", listener);
  t.equal(ee.listenerCount("data"), 0, "second removal clears the first wrapper");
  t.end();
});

test("introspection sees originals: listeners(), listenerCount(fn), events", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);

  const newListeners: any[] = [];
  const removedListeners: any[] = [];
  ee.on("newListener", (_ev, fn) => newListeners.push(fn));
  ee.on("removeListener", (_ev, fn) => removedListeners.push(fn));

  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const listener = () => {};
  ee.on("data", listener);
  t.equal(ee.listeners("data")[0], listener, "listeners() returns the original");
  t.equal(ee.listenerCount("data", listener), 1, "listenerCount(fn) matches the original");
  t.not(ee.rawListeners("data")[0], listener, "rawListeners() shows the wrapper");
  t.equal(
    (ee.rawListeners("data")[0] as any).listener,
    listener,
    "wrapper points back via .listener",
  );
  t.equal(newListeners[newListeners.length - 1], listener, "newListener event saw the original");

  ee.removeListener("data", listener);
  t.equal(
    removedListeners[removedListeners.length - 1],
    listener,
    "removeListener event saw the original",
  );
  t.end();
});

test("removeAllListeners clears wrapped listeners and bookkeeping", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const listener = () => calls.push("fired");
  ee.on("data", listener);
  ee.on("other", listener);
  ee.removeAllListeners("data");
  t.equal(ee.listenerCount("data"), 0, "event cleared");
  t.equal(ee.listenerCount("other"), 1, "other event untouched");

  // Re-adding after removeAllListeners must work cleanly.
  ee.on("data", listener);
  ee.emit("data");
  t.same(calls, ["w", "fired"], "re-added listener fires wrapped");

  ee.removeAllListeners();
  t.equal(ee.listenerCount("data") + ee.listenerCount("other"), 0, "no-arg clears everything");
  t.end();
});

test("a throwing listener leaves the emitter fully functional", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const kaboom = () => {
    throw new Error("whoops");
  };
  ee.on("bad", kaboom);
  t.throws(() => ee.emit("bad"), "exception propagates");
  t.equal(ee.listeners("bad")[0], kaboom, "listener still introspectable");
  ee.removeListener("bad", kaboom);
  t.equal(ee.listenerCount("bad"), 0, "and still removable");
  t.doesNotThrow(() => ee.emit("bad"), "emitter still usable");
  t.end();
});

test("second wrapEmitter call adds its hook without re-patching", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const first = taggingHooks("first", calls);
  wrapEmitter(ee, first.attach, first.wrap);
  const onAfterFirst = ee.on;

  // Second binder: only its attach hook is honored (the first wrap hook
  // services every listener) — same contract as emitter-listener, which is
  // why the namespace wrap hook binds all recorded namespaces itself.
  let secondAttach = 0;
  wrapEmitter(
    ee,
    () => {
      secondAttach++;
    },
    (fn) => fn,
  );
  t.equal(ee.on, onAfterFirst, "methods not patched twice");

  ee.on("data", () => {});
  t.equal(secondAttach, 1, "second binder's attach hook runs on add");
  ee.emit("data");
  t.same(calls, ["first"], "first binder's wrap hook services the listener");
  t.end();
});

test("__unwrap restores pristine emitter behavior", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);
  t.ok((ee as any).__wrapped, "marked wrapped");

  (ee as any).__unwrap();
  t.notOk((ee as any).__wrapped, "unmarked");

  const listener = () => calls.push("fired");
  ee.on("data", listener);
  ee.emit("data");
  t.same(calls, ["fired"], "listener runs unwrapped after __unwrap");
  t.equal(ee.rawListeners("data")[0], listener, "stored untouched");
  t.end();
});

test("non-function listeners still fail with the native error", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);
  t.throws(
    () => (ee as any).on("data", "not a function"),
    /listener/,
    "native ERR_INVALID_ARG_TYPE",
  );
  t.end();
});

test("symbol-named events work", function (t) {
  const ee = new EventEmitter();
  const calls: string[] = [];
  const hooks = taggingHooks("w", calls);
  wrapEmitter(ee, hooks.attach, hooks.wrap);

  const sym = Symbol("evt");
  let fired = 0;
  const listener = () => {
    fired++;
  };
  ee.on(sym, listener);
  ee.emit(sym);
  t.equal(fired, 1, "symbol event fired");
  t.same(calls, ["w"], "wrapped");
  ee.removeListener(sym, listener);
  t.equal(ee.listenerCount(sym), 0, "symbol event removable");
  t.end();
});

// End-to-end through the namespace API: the exact once + removal + context
// flow express/sequelize-era code exercises on req/res emitters.
test("namespace.bindEmitter end-to-end: once, removal, context restore", function (t) {
  t.plan(5);
  const ns = cls.createNamespace("wrap-emitter-e2e");
  const ee = new EventEmitter();

  const dropped = () => {
    t.fail("removed listener fired");
  };

  ns.run(() => {
    ns.set("value", "captured");
    ns.bindEmitter(ee);
    ee.once("done", function (arg: any) {
      t.equal(ns.get("value"), "captured", "once listener restored its context");
      t.equal(arg, 42, "arguments pass through");
    });
    ee.on("done", dropped);
  });

  ee.removeListener("done", dropped);
  t.equal(ee.listenerCount("done"), 1, "bound listener removable by original outside context");

  // Emit far from the context, off the synchronous chain entirely.
  setTimeout(() => {
    ee.emit("done", 42);
    t.equal(ee.listenerCount("done"), 0, "once cleaned up after firing");
    t.equal(ns.get("value"), undefined, "no context bleed at emit site");
    cls.destroyNamespace("wrap-emitter-e2e");
  }, 10);
});
