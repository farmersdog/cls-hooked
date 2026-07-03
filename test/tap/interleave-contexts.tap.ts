"use strict";

import * as tap from "tap";
import cls from "../../index";
import type { Context } from "../../index";

const test = tap.test;

function cleanNamespace(name: string) {
  if (cls.getNamespace(name)) cls.destroyNamespace(name);
  return cls.createNamespace(name);
}

test("interleaved contexts", function (t) {
  t.plan(3);

  t.test("interleaving with run", function (t) {
    t.plan(2);

    const ns = cleanNamespace("test");

    const ctx = ns.createContext();

    ns.enter(ctx);
    ns.run(function () {
      t.equal((ns as any)._set.length, 2, "2 contexts in the active set");
      t.doesNotThrow(function () {
        ns.exit(ctx);
      });
    });
  });

  t.test("entering and exiting staggered", function (t) {
    t.plan(4);

    const ns = cleanNamespace("test");

    const ctx1: Context = ns.createContext();
    const ctx2: Context = ns.createContext();

    t.doesNotThrow(function () {
      ns.enter(ctx1);
    });
    t.doesNotThrow(function () {
      ns.enter(ctx2);
    });

    t.doesNotThrow(function () {
      ns.exit(ctx1);
    });
    t.doesNotThrow(function () {
      ns.exit(ctx2);
    });
  });

  t.test("creating, entering and exiting staggered", function (t) {
    t.plan(4);

    const ns = cleanNamespace("test");

    const ctx1: Context = ns.createContext();
    t.doesNotThrow(function () {
      ns.enter(ctx1);
    });

    const ctx2: Context = ns.createContext();
    t.doesNotThrow(function () {
      ns.enter(ctx2);
    });

    t.doesNotThrow(function () {
      ns.exit(ctx1);
    });
    t.doesNotThrow(function () {
      ns.exit(ctx2);
    });
  });
});
