"use strict";

import * as tap from "tap";
import { EventEmitter } from "node:events";
import * as stream from "node:stream";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import cls from "../../index";

const test = tap.test;

// Helper type for augmented EventEmitter/Stream methods
type AugmentedMethod<T> = T & { __wrapped?: boolean };

test("event emitters bound to CLS context", function (t) {
  t.plan(15);

  t.test("handler registered in context, emit out of context", function (t) {
    t.plan(1);

    const n = cls.createNamespace("in");
    const ee = new EventEmitter();

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(ee);
      ee.on("event", function () {
        t.equal(n.get("value"), "hello", "value still set in EE.");
        cls.destroyNamespace("in");
      });
    });

    ee.emit("event");
  });

  t.test("once handler registered in context", function (t) {
    t.plan(1);

    const n = cls.createNamespace("inOnce");
    const ee = new EventEmitter();

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(ee);
      ee.once("event", function () {
        t.equal(n.get("value"), "hello", "value still set in EE.");
        cls.destroyNamespace("inOnce");
      });
    });

    ee.emit("event");
  });

  t.test("handler registered out of context, emit in context", function (t) {
    t.plan(1);

    const n = cls.createNamespace("out");
    const ee = new EventEmitter();

    ee.on("event", function () {
      t.equal(n.get("value"), "hello", "value still set in EE.");
      cls.destroyNamespace("out");
    });

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(ee);

      ee.emit("event");
    });
  });

  t.test("once handler registered out of context", function (t) {
    t.plan(1);

    const n = cls.createNamespace("outOnce");
    const ee = new EventEmitter();

    ee.once("event", function () {
      t.equal(n.get("value"), "hello", "value still set in EE.");
      cls.destroyNamespace("outOnce");
    });

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(ee);

      ee.emit("event");
    });
  });

  t.test("handler registered out of context, emit out of context", function (t) {
    t.plan(1);

    const n = cls.createNamespace("out");
    const ee = new EventEmitter();

    ee.on("event", function () {
      t.equal(n.get("value"), undefined, "no context.");
      cls.destroyNamespace("out");
    });

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(ee);
    });

    ee.emit("event");
  });

  t.test("once handler registered out of context on Readable", function (t) {
    const Readable = stream.Readable;

    if (Readable) {
      t.plan(12);

      const n = cls.createNamespace("outOnceReadable");
      const re = new Readable();

      re._read = function () {};

      t.ok(n.name, "namespace has a name");
      t.equal(n.name, "outOnceReadable", "namespace has a name");

      re.once("data", function (data) {
        t.equal(n.get("value"), "hello", "value still set in EE");
        t.equal(data, "blah", "emit still works");
        cls.destroyNamespace("outOnceReadable");
      });

      n.run(function () {
        n.set("value", "hello");

        // Use type assertion for accessing dynamically added properties
        t.notOk((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit is not wrapped");
        t.notOk((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is not wrapped");
        t.notOk(
          (re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped,
          "addListener is not wrapped",
        );

        n.bindEmitter(re);

        // v5 binds listeners at add time, so emit is deliberately NOT
        // patched; on/addListener are.
        t.notOk((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit needs no wrapping");
        t.ok((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is wrapped");
        t.ok(
          (re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped,
          "addListener is wrapped",
        );

        // Access _events safely
        const events = (re as any)._events || {};
        t.equal(typeof events.data, "function", "only the one data listener");
        t.notOk((events.data as any)["context@outOnceReadable"], "context isn't on listener");

        re.emit("data", "blah");
      });
    } else {
      t.comment("this test requires node 0.10+");
      t.end();
    }
  });

  t.test("emitter with newListener that removes handler", function (t) {
    t.plan(3);

    const n = cls.createNamespace("newListener");
    const ee = new EventEmitter();

    // add monkeypatching to ee
    n.bindEmitter(ee);

    function listen() {
      ee.on("data", function (chunk) {
        t.equal(chunk, "chunk", "listener still works");
      });
    }

    ee.on("newListener", function handler(this: EventEmitter, event) {
      if (event !== "data") return;

      this.removeListener("newListener", handler);
      t.notOk(this.listeners("newListener").length, "newListener was removed");
      process.nextTick(listen);
    });

    ee.on("drain", function (chunk) {
      process.nextTick(function () {
        ee.emit("data", chunk);
      });
    });

    ee.on("data", function (chunk) {
      t.equal(chunk, "chunk", "got data event");
      cls.destroyNamespace("newListener");
    });

    ee.emit("drain", "chunk");
  });

  t.test("handler registered in context on Readable", function (t) {
    const Readable = stream.Readable;

    if (Readable) {
      t.plan(12);

      const n = cls.createNamespace("outOnReadable");
      const re = new Readable();

      re._read = function () {};

      t.ok(n.name, "namespace has a name");
      t.equal(n.name, "outOnReadable", "namespace has a name");

      n.run(function () {
        n.set("value", "hello");

        n.bindEmitter(re);

        // v5 binds listeners at add time; emit is deliberately NOT patched.
        t.notOk((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit needs no wrapping");
        t.ok((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is wrapped");
        t.ok(
          (re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped,
          "addListener is wrapped",
        );

        re.on("data", function (data) {
          t.equal(n.get("value"), "hello", "value still set in EE");
          t.equal(data, "blah", "emit still works");
          cls.destroyNamespace("outOnReadable");
        });
      });

      // Use type assertion for accessing dynamically added properties
      t.notOk(
        (re.emit as AugmentedMethod<typeof re.emit>).__wrapped,
        "emit still needs no wrapping",
      );
      t.ok((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is still wrapped");
      t.ok(
        (re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped,
        "addListener is still wrapped",
      );

      // Access _events safely
      const events = (re as any)._events || {};
      t.equal(typeof events.data, "function", "only the one data listener");

      t.ok(
        (events.data as any)["cls@contexts"]["context@outOnReadable"],
        "context is bound to listener",
      );

      re.emit("data", "blah");
    } else {
      t.comment("this test requires node 0.10+");
      t.end();
    }
  });

  t.test("handler added but used entirely out of context", function (t) {
    t.plan(2);

    const n = cls.createNamespace("none");
    const ee = new EventEmitter();

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(ee);
    });

    ee.on("data", function (data) {
      t.equal(n.get("value"), undefined, "no context on listener");
      t.equal(data, "blah", "emit still works");
      cls.destroyNamespace("none");
    });

    ee.emit("data", "blah");
  });

  t.test("handler added but no listeners registered", function (t) {
    t.plan(3);

    const n = cls.createNamespace("no_listener");

    const server = http.createServer(function (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) {
      n.bindEmitter(req);

      t.doesNotThrow(function () {
        req.emit("event");
      });

      res.writeHead(200, { "Content-Length": 4 });
      res.end("WORD");
    });
    server.listen(0, function () {
      const port = (server.address() as AddressInfo).port;
      http.get("http://localhost:" + port + "/", function (res: http.IncomingMessage) {
        t.equal(res.statusCode, 200, "request came back OK");

        res.setEncoding("ascii");
        res.on("data", function (body: string) {
          t.equal(body, "WORD", "body should match WORD");

          server.close();
          cls.destroyNamespace("no_listener");
        });
      });
    });
  });

  t.test("listener with parameters added but not bound to context", function (t) {
    t.plan(2);

    const ee = new EventEmitter();
    const n = cls.createNamespace("param_list");

    function sent(value: number) {
      t.equal(value, 3, "sent value is correct");
      cls.destroyNamespace("param_list");
    }

    ee.on("send", sent);
    n.bindEmitter(ee);
    t.doesNotThrow(function () {
      ee.emit("send", 3);
    });
  });

  t.test("listener that throws doesn't leave removeListener wrapped", function (t) {
    t.plan(4);

    const ee = new EventEmitter();
    const n = cls.createNamespace("kaboom");

    n.bindEmitter(ee);

    function kaboom() {
      throw new Error("whoops");
    }

    n.run(function () {
      ee.on("bad", kaboom);

      t.throws(function () {
        ee.emit("bad");
      });
      t.equal(typeof ee.removeListener, "function", "removeListener is still there");
      t.notOk(
        (ee.removeListener as AugmentedMethod<typeof ee.removeListener>).__wrapped,
        "removeListener not left wrapped",
      );
      // v5 stores a bound wrapper in _events, but the original stays the
      // publicly visible listener (Node unwraps via the .listener convention).
      t.equal(ee.listeners("bad")[0], kaboom, "original is still the visible listener");
      cls.destroyNamespace("kaboom");
    });
  });

  t.test("feel the hatred / node 0.10+ only test", function (t) {
    const Readable = stream.Readable;

    if (Readable) {
      t.plan(3);

      const n = cls.createNamespace("pipeable");
      const re = new Readable();

      re._read = function () {};

      const onData = (data: stream.Readable) => {
        t.equal(n.get("value"), "hello", "context is still available in listener");
        t.equal(data, "blah", "data was received");
        cls.destroyNamespace("pipeable");
      };

      const listen = () => {
        n.run(function () {
          n.set("value", "hello");
          n.bindEmitter(re);

          re.on("data", onData);
        });
      };

      const kaboom = () => {
        re.on("end", function () {
          t.fail("this should never happen");
        });

        process.nextTick(function () {
          re.emit("data", "blah");
        });
      };

      process.nextTick(listen);
      process.nextTick(kaboom);

      const onTimeout = () => {
        t.ok(true, "listener with context still works");
      };

      setTimeout(onTimeout, 20);
    } else {
      t.comment("this test requires node 0.10+");
      t.end();
    }
  });

  t.test("listeners bound to pipelines don't pass on contexts / Node 0.10+", function (t) {
    const Readable = stream.Readable;
    const Writable = stream.Writable;

    if (!(Readable && Writable)) {
      t.comment("this test requires node 0.10+");
      return t.end();
    }

    t.plan(2);

    const reader = new Readable();
    reader._read = function () {};

    const writer = new Writable();
    writer._write = function _write(chunk, encoding, callback) {
      t.equal(chunk.toString(), "hello", "got write data");
      callback();
    };

    const n = cls.createNamespace("pipe");
    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(reader);
      reader.pipe(writer);
    });

    n.run(function () {
      n.set("value", "goodbye");
      n.bindEmitter(writer);
      writer.on("finish", function () {
        t.equal(
          n.get("value"),
          "goodbye",
          "writer's finish listener doesn't have reader's context",
        );
        cls.destroyNamespace("pipe");
      });
    });

    reader.push("hello");
    reader.push(null);
  });

  t.test("timers with contexts have their contexts cleared / Node 0.10+", function (t) {
    let Timer: any;
    try {
      Timer = (process as any).binding("timer_wrap")?.Timer;
    } catch {
      Timer = null;
    }

    if (!Timer) {
      t.comment('process.binding("timer_wrap").Timer is not available');
      return t.end();
    }

    t.plan(2);

    const n = cls.createNamespace("timers");
    const sent = (value: string) => {
      t.equal(value, "hello");
      t.equal(n.get("value"), undefined);
      cls.destroyNamespace("timers");
    };

    n.run(function () {
      n.set("value", "hello");
      n.bindEmitter(process);

      setTimeout(sent.bind(null, "hello"), 10);
    });
  });
});
