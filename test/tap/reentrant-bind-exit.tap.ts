"use strict";

// Regression tests for exit() restoring the AsyncLocalStorage frame from the
// sync enter/exit stack instead of the store observed at the matching
// enter(). AsyncLocalStorage.run() short-circuits (no frame save/restore)
// when the requested store is already current, so a bind() invoked
// synchronously in the very context it captured relied entirely on exit()
// putting the right value back — restoring the sync-stack value (null by
// then, inside an async continuation) stamped `undefined` into the frame and
// annihilated the chain's context. cls-hooked 4.x never touched async
// propagation from exit(), so these patterns all worked there.
import * as tap from "tap";
import cls from "../../index";

const test = tap.test;

test("bind() invoked synchronously inside its own context keeps the chain's context", async (t) => {
  const ns = cls.createNamespace("reentrant-bind");
  t.teardown(() => cls.destroyNamespace("reentrant-bind"));

  // The context-logger idiom: bind to the currently-active context and call
  // the bound function immediately.
  const readViaBind = (): unknown => {
    const bound = ns.bind(() => ns.get("k"));
    return bound();
  };

  const handler = ns.bind(async () => {
    ns.set("k", "before");
    t.equal(readViaBind(), "before", "re-entrant bind sees the context (sync)");

    await new Promise((resolve) => setTimeout(resolve, 5));

    t.equal(readViaBind(), "before", "re-entrant bind sees the context (after await)");
    ns.set("k2", "after");
    t.equal(ns.get("k"), "before", "context survives the re-entrant bind");

    await new Promise((resolve) => setTimeout(resolve, 5));

    t.equal(ns.get("k2"), "after", "context still propagates after further awaits");
  });

  await handler();
});

test("bind(fn, ns.active) invoked synchronously keeps the chain's context", async (t) => {
  const ns = cls.createNamespace("reentrant-bind-explicit");
  t.teardown(() => cls.destroyNamespace("reentrant-bind-explicit"));

  const handler = ns.bind(async () => {
    ns.set("k", 1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Explicit-context flavor of the same idiom (what bindEmitter's wrap
    // does when an emitter fires inside the context its listener captured).
    const bound = ns.bind(() => ns.get("k"), ns.active!);
    t.equal(bound(), 1, "explicitly re-bound function sees the context");

    ns.set("k", 2);
    t.equal(ns.get("k"), 2, "context survives the re-entrant bind");
  });

  await handler();
});

test("raw enter()/exit() pair inside an async continuation keeps the chain's context", async (t) => {
  const ns = cls.createNamespace("reentrant-enter-exit");
  t.teardown(() => cls.destroyNamespace("reentrant-enter-exit"));

  const handler = ns.bind(async () => {
    ns.set("k", "outer");
    await new Promise((resolve) => setTimeout(resolve, 5));

    const inner = ns.createContext();
    ns.enter(inner);
    ns.set("k", "inner");
    t.equal(ns.get("k"), "inner", "inner context is active between enter/exit");
    ns.exit(inner);

    t.equal(ns.get("k"), "outer", "outer context restored after exit()");
    ns.set("k2", "still here");

    await new Promise((resolve) => setTimeout(resolve, 5));
    t.equal(ns.get("k2"), "still here", "outer context still propagates after awaits");
  });

  await handler();
});

test("out-of-order exit still restores the pre-nesting store", (t) => {
  const ns = cls.createNamespace("reentrant-out-of-order");
  t.teardown(() => cls.destroyNamespace("reentrant-out-of-order"));

  ns.run(() => {
    ns.set("k", "base");

    const a = ns.createContext();
    const b = ns.createContext();
    ns.enter(a);
    ns.enter(b);
    ns.exit(a); // out of order: a is not on top
    t.equal(ns.get("k"), "base", "b (prototype-inheriting) still resolves values");
    ns.exit(b);

    t.equal(ns.get("k"), "base", "run() context restored after unwinding");
    ns.set("k2", "ok");
    t.equal(ns.get("k2"), "ok", "run() context is writable after unwinding");
  });

  t.end();
});
