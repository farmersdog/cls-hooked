"use strict";

/*
 * Parity regression tests for the AsyncLocalStorage-based implementation.
 *
 * Each test here encodes a behavior verified differentially against the
 * async_hooks implementation (cls-hooked 4.x / master's context.js). Tests
 * marked INTENTIONAL DIVERGENCE assert behavior that deliberately differs
 * because the old behavior was a context/data leak.
 */

import * as tap from "tap";
import { EventEmitter } from "node:events";
import cls from "../../index";

const test = tap.test;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("no context leak to code outside any run", function (t) {
  t.plan(2);

  // Regression: get()/set() must not publish the calling chain's context
  // into namespace state that unrelated code can observe. (The first ALS
  // rewrite mutated ns.active as a side effect of get/set, so a get() after
  // an await leaked that chain's context to everything outside a run.)
  const ns = cls.createNamespace("leak-test");

  const chain = new Promise<void>((resolve) => {
    ns.run(async () => {
      ns.set("secret", "SECRET");
      await sleep(10);
      ns.get("secret"); // post-await read must not leak the context
      setTimeout(resolve, 20);
    });
  });

  setTimeout(() => {
    t.equal(ns.get("secret"), undefined, "code outside any run cannot read another chain's values");
    t.equal(ns.active, null, "no active context outside any run");
  }, 15);

  t.teardown(async () => {
    await chain;
    cls.destroyNamespace("leak-test");
  });
});

test("bind() without explicit context after an await binds the run context", function (t) {
  t.plan(2);

  // Regression: bind() called in a continuation (post-await) must capture
  // the current context itself — writes in the bound fn are visible on the
  // run's context — not a freshly-created child context.
  const ns = cls.createNamespace("bind-after-await");
  let runCtx: any;

  ns.run(async (ctx) => {
    runCtx = ctx;
    ns.set("x", 1);
    await sleep(10);

    const bound = ns.bind(function () {
      t.equal(ns.get("x"), 1, "bound fn sees the run context");
      ns.set("y", 2);
    });

    setTimeout(() => {
      bound();
      t.equal(runCtx.y, 2, "writes in bound fn land on the run context");
      cls.destroyNamespace("bind-after-await");
      t.end();
    }, 10);
  });
});

test("bare enter()/exit() propagates to async resources created in between", function (t) {
  t.plan(1);

  // The async_hooks implementation captured the active context at resource
  // creation (init hook). AsyncLocalStorage.enterWith() reproduces this for
  // the low-level enter/exit API.
  const ns = cls.createNamespace("enter-exit-async");
  const ctx = ns.createContext();

  ns.enter(ctx);
  ns.set("x", "via-enter");
  setTimeout(() => {
    t.equal(
      ns.get("x"),
      "via-enter",
      "timer created between enter() and exit() carries the context",
    );
    cls.destroyNamespace("enter-exit-async");
    t.end();
  }, 10);
  ns.exit(ctx);
});

test("bindEmitter captures the context current at listener-add time, post-await", function (t) {
  t.plan(1);

  // Regression: attach must resolve the current context through
  // AsyncLocalStorage, not a stale sync-stack value, when the listener is
  // added in a continuation.
  const ns = cls.createNamespace("emitter-after-await");
  const ee = new EventEmitter();
  ns.bindEmitter(ee);

  // foreign chain that emits with no context of its own
  setTimeout(() => ee.emit("evt"), 40);

  ns.run(async () => {
    ns.set("x", 42);
    await sleep(10);
    ee.on("evt", function () {
      t.equal(ns.get("x"), 42, "listener sees the context it was added under");
      cls.destroyNamespace("emitter-after-await");
      t.end();
    });
  });
});

test("ns.active resolves through the async context, like the hooks kept it", function (t) {
  t.plan(2);

  const ns = cls.createNamespace("active-getter");
  ns.run((ctx) => {
    // unbound continuation: the old before() hook re-entered the context so
    // ns.active stayed correct; the ALS-backed getter must match.
    process.nextTick(() => {
      t.equal(ns.active, ctx, "ns.active is the run context in an unbound nextTick");
    });
    setImmediate(() => {
      t.equal(ns.active, ctx, "ns.active is the run context in an unbound setImmediate");
      cls.destroyNamespace("active-getter");
      t.end();
    });
  });
});

test("context object shape matches cls-hooked 4.x", function (t) {
  t.plan(3);

  const ns = cls.createNamespace("ctx-shape");
  ns.run((ctx: any) => {
    t.ok("id" in ctx, "context has an id");
    t.equal(ctx._ns_name, "ctx-shape", "context records its namespace name");
  });
  try {
    ns.run(() => {
      throw new Error("boom");
    });
  } catch (e: any) {
    t.ok(e["error@context"], "thrown errors carry the context at the string key");
  }
  cls.destroyNamespace("ctx-shape");
});

test("INTENTIONAL DIVERGENCE: runPromise does not bleed context into the awaiter", function (t) {
  t.plan(2);

  // cls-hooked 4.x leaked the runPromise context into the awaiting chain
  // permanently: after `await ns.runPromise(...)`, ns.get() returned values
  // from the settled context, forever. That was a context leak, not a
  // feature. The ALS implementation correctly scopes the context to the fn.
  const ns = cls.createNamespace("no-await-bleed");
  ns.runPromise(async () => {
    ns.set("x", "inside");
    await sleep(5);
  }).then(() => {
    t.equal(ns.get("x"), undefined, "context does not follow the awaiting chain after settlement");
    t.equal(ns.active, null, "no active context after settlement");
    cls.destroyNamespace("no-await-bleed");
    t.end();
  });
});

test("interleaved runPromises stay isolated and unwind cleanly", function (t) {
  t.plan(3);

  const ns = cls.createNamespace("interleaved-rp");
  const a = ns.runPromise(async () => {
    ns.set("who", "A");
    await sleep(30);
    return ns.get("who");
  });
  const b = ns.runPromise(async () => {
    ns.set("who", "B");
    await sleep(10);
    return ns.get("who");
  });

  Promise.all([a, b]).then(([ra, rb]) => {
    t.equal(ra, "A", "first runPromise kept its own value");
    t.equal(rb, "B", "second (out-of-order-settling) runPromise kept its own value");
    t.equal(ns.active, null, "stack unwound after out-of-order settlement");
    cls.destroyNamespace("interleaved-rp");
    t.end();
  });
});

test("middleware pattern: per-request contexts with bound req emitters", function (t) {
  t.plan(4);

  // The express-http-context pattern (bindEmitter(req/res) + ns.run in
  // middleware) — the primary production usage. Two sequential requests
  // must each see only their own values, through body 'data'/'end' events
  // and async continuations.
  const http = require("node:http");
  const ns = cls.createNamespace("middleware");
  let n = 0;

  const server = http.createServer((req: any, res: any) => {
    const id = "req-" + ++n;
    ns.bindEmitter(req);
    ns.bindEmitter(res);
    ns.run(() => {
      ns.set("id", id);
      req.on("data", () => {});
      req.on("end", () => {
        setImmediate(async () => {
          await sleep(5);
          t.equal(ns.get("id"), id, id + " context survives to the handler continuation");
          res.end(String(ns.get("id")));
        });
      });
    });
  });

  server.listen(0, async () => {
    const port = (server.address() as any).port;
    const post = () =>
      new Promise<string>((resolve) => {
        const r = http.request({ port, method: "POST", path: "/" }, (res: any) => {
          let body = "";
          res.on("data", (c: any) => (body += c));
          res.on("end", () => resolve(body));
        });
        r.end("hello");
      });

    t.equal(await post(), "req-1", "first request got its own context value");
    t.equal(await post(), "req-2", "second request got its own context value");
    server.close();
    cls.destroyNamespace("middleware");
    t.end();
  });
});
