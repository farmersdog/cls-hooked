"use strict";

// Ported from test/promise-context-convention.spec.ts (mocha).
// See https://github.com/othiym23/node-continuation-local-storage/issues/64
// Convention 3: a .then() callback runs in the context where .then() was
// attached — the same convention the async_hooks implementation followed.

import * as tap from "tap";
import cls from "../../index";

const test = tap.test;

test("Promise context convention", function (t) {
  t.plan(1);

  const ns = cls.createNamespace("PromiseConventionNS");
  let promise: Promise<void>;

  ns.run(() => {
    ns.set("test", 2);
    promise = new Promise((resolve) => {
      ns.run(() => {
        ns.set("test", 1);
        resolve();
      });
    });
  });

  ns.run(() => {
    ns.set("test", 3);
    promise.then(() => {
      t.equal(ns.get("test"), 3, "convention should be 3 (context at .then() attachment)");
      cls.destroyNamespace("PromiseConventionNS");
      t.end();
    });
  });
});
