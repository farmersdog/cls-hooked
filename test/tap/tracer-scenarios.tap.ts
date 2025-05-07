'use strict';

import { EventEmitter } from 'events';
import * as assert from 'assert';
import * as tap from 'tap';
import cls from '../../index';

const test = tap.test;

let nextID = 1;
function fresh(name: string) {
  assert.ok(!cls.getNamespace(name), "namespace " + name + " already exists");
  return cls.createNamespace(name);
}

function destroy(name: string) {
  return function destroyer(t: any) {
    cls.destroyNamespace(name);
    assert.ok(!cls.getNamespace(name), "namespace '" + name + "' should no longer exist");
    t.end();
  };
}

function runInTransaction(name: string, fn: Function) {
  const namespace = cls.getNamespace(name);
  assert.ok(namespace, "namespaces " + name + " doesn't exist");

  const context = namespace.createContext();
  context.transaction = ++nextID;
  process.nextTick(namespace.bind(fn, context));
}

test("asynchronous state propagation", function (t) {
  t.plan(24);

  t.test("a. async transaction with setTimeout", function (t) {
    t.plan(2);

    const namespace = fresh('a');

    function handler() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('a', function () { setTimeout(handler, 100); });
  });

  t.test("a. cleanup", destroy('a'));

  t.test("b. async transaction with setInterval", function (t) {
    t.plan(4);

    const namespace = fresh('b');
    let count = 0;
    let handle: NodeJS.Timeout;

    function handler() {
      count += 1;
      if (count > 2) clearInterval(handle);
      t.ok(namespace.get('transaction'), "transaction should be visible");
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('b', function () { handle = setInterval(handler, 50); });
  });

  t.test("b. cleanup", destroy('b'));

  t.test("c. async transaction with process.nextTick", function (t) {
    t.plan(2);

    const namespace = fresh('c');

    function handler() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('c', function () { process.nextTick(handler); });
  });

  t.test("c. cleanup", destroy('c'));

  t.test("d. async transaction with EventEmitter.emit", function (t) {
    t.plan(2);

    const namespace = fresh('d');
    const ee = new EventEmitter();

    function handler() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('d', function () {
      ee.on('transaction', handler);
      ee.emit('transaction');
    });
  });

  t.test("d. cleanup", destroy('d'));

  t.test("e. two overlapping async transactions with setTimeout", function (t) {
    t.plan(6);

    const namespace = fresh('e');
    let first: number;
    let second: number;

    function handler(id: number) {
      t.ok(namespace.get('transaction'), "transaction should be visible");
      t.equal(namespace.get('transaction'), id, "transaction matches");
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('e', function () {
      first = namespace.get('transaction');
      setTimeout(handler.bind(null, first), 100);
    });

    setTimeout(function () {
      runInTransaction('e', function () {
        second = namespace.get('transaction');
        t.not(first, second, "different transaction IDs");
        setTimeout(handler.bind(null, second), 100);
      });
    }, 25);
  });

  t.test("e. cleanup", destroy('e'));

  t.test("f. two overlapping async transactions with setInterval", function (t) {
    t.plan(15);

    const namespace = fresh('f');

    function runInterval() {
      let count = 0;
      let handle: NodeJS.Timeout;
      let id: number;

      function handler() {
        count += 1;
        if (count > 2) clearInterval(handle);
        t.ok(namespace.get('transaction'), "transaction should be visible");
        t.equal(id, namespace.get('transaction'), "transaction ID should be immutable");
      }

      function run() {
        t.ok(namespace.get('transaction'), "transaction should have been created");
        id = namespace.get('transaction');
        handle = setInterval(handler, 50);
      }

      runInTransaction('f', run);
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInterval(); runInterval();
  });

  t.test("f. cleanup", destroy('f'));

  t.test("g. two overlapping async transactions with process.nextTick", function (t) {
    t.plan(6);

    const namespace = fresh('g');
    let first: number;
    let second: number;

    function handler(id: number) {
      const transaction = namespace.get('transaction');
      t.ok(transaction, "transaction should be visible");
      t.equal(transaction, id, "transaction matches");
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('g', function () {
      first = namespace.get('transaction');
      process.nextTick(handler.bind(null, first));
    });

    process.nextTick(function () {
      runInTransaction('g', function () {
        second = namespace.get('transaction');
        t.not(first, second, "different transaction IDs");
        process.nextTick(handler.bind(null, second));
      });
    });
  });

  t.test("g. cleanup", destroy('g'));

  t.test("h. two overlapping async runs with EventEmitter.prototype.emit", function (t) {
    t.plan(3);

    const namespace = fresh('h');
    const ee = new EventEmitter();

    function handler() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
    }

    function lifecycle() {
      ee.once('transaction', process.nextTick.bind(process, handler));
      ee.emit('transaction');
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('h', lifecycle);
    runInTransaction('h', lifecycle);
  });

  t.test("h. cleanup", destroy('h'));

  t.test("i. async transaction with an async sub-call with setTimeout", function (t) {
    t.plan(5);

    const namespace = fresh('i');

    function inner(callback: Function) {
      setTimeout(function () {
        t.ok(namespace.get('transaction'), "transaction should (yep) still be visible");
        callback();
      }, 50);
    }

    function outer() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
      setTimeout(function () {
        t.ok(namespace.get('transaction'), "transaction should still be visible");
        inner(function () {
          t.ok(namespace.get('transaction'), "transaction should even still be visible");
        });
      }, 50);
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('i', setTimeout.bind(null, outer, 50));
  });

  t.test("i. cleanup", destroy('i'));

  t.test("j. async transaction with an async sub-call with setInterval", function (t) {
    t.plan(5);

    const namespace = fresh('j');
    let outerHandle: NodeJS.Timeout;
    let innerHandle: NodeJS.Timeout;

    function inner(callback: Function) {
      innerHandle = setInterval(function () {
        clearInterval(innerHandle);
        t.ok(namespace.get('transaction'), "transaction should (yep) still be visible");
        callback();
      }, 50);
    }

    function outer() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
      outerHandle = setInterval(function () {
        clearInterval(outerHandle);
        t.ok(namespace.get('transaction'), "transaction should still be visible");
        inner(function () {
          t.ok(namespace.get('transaction'), "transaction should even still be visible");
        });
      }, 50);
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('j', outer);
  });

  t.test("j. cleanup", destroy('j'));

  t.test("k. async transaction with an async subcall with process.nextTick", function (t) {
    t.plan(5);

    const namespace = fresh('k');

    function inner(callback: Function) {
      process.nextTick(function () {
        t.ok(namespace.get('transaction'), "transaction should (yep) still be visible");
        callback();
      });
    }

    function outer() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
      process.nextTick(function () {
        t.ok(namespace.get('transaction'), "transaction should still be visible");
        inner(function () {
          t.ok(namespace.get('transaction'), "transaction should even still be visible");
        });
      });
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('k', process.nextTick.bind(process, outer));
  });

  t.test("k. cleanup", destroy('k'));

  t.test("l. async transaction with an async subcall with an EventEmitter", function (t) {
    t.plan(5);

    const namespace = fresh('l');
    const ee = new EventEmitter();

    function outerCallback() {
      t.ok(namespace.get('transaction'), "transaction should be visible");
    }

    function middleCallback() {
      t.ok(namespace.get('transaction'), "transaction should still be visible");
    }

    function innerCallback() {
      t.ok(namespace.get('transaction'), "transaction should even still be visible");
    }

    function inner() {
      t.ok(namespace.get('transaction'), "transaction should still be visible");
      ee.once('inner', innerCallback);
      ee.emit('inner');
    }

    function outer() {
      ee.once('outer', outerCallback);
      ee.emit('outer');
      ee.once('middle', middleCallback);
      ee.emit('middle');
      inner();
    }

    t.notOk(namespace.get('transaction'), "transaction should not yet be visible");
    runInTransaction('l', outer);
  });

  t.test("l. cleanup", destroy('l'));
});
