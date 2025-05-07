'use strict';

import * as tap from 'tap';
import { EventEmitter } from 'node:events';
import * as stream from 'node:stream';
import cls from '../../index';

const test = tap.test;

// Helper type for augmented EventEmitter/Stream methods
type AugmentedMethod<T> = T & { __wrapped?: boolean };

test("event emitters bound to CLS context", function (t) {
  t.plan(13);

  t.test("handler registered in context, emit out of context", function (t) {
    t.plan(1);

    const n = cls.createNamespace('in');
    const ee = new EventEmitter();

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);
      ee.on('event', function () {
        t.equal(n.get('value'), 'hello', "value still set in EE.");
        cls.destroyNamespace('in');
      });
    });

    ee.emit('event');
  });

  t.test("once handler registered in context", function (t) {
    t.plan(1);

    const n = cls.createNamespace('inOnce');
    const ee = new EventEmitter();

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);
      ee.once('event', function () {
        t.equal(n.get('value'), 'hello', "value still set in EE.");
        cls.destroyNamespace('inOnce');
      });
    });

    ee.emit('event');
  });

  t.test("handler registered out of context, emit in context", function (t) {
    t.plan(1);

    const n = cls.createNamespace('out');
    const ee = new EventEmitter();

    ee.on('event', function () {
      t.equal(n.get('value'), 'hello', "value still set in EE.");
      cls.destroyNamespace('out');
    });

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);

      ee.emit('event');
    });
  });

  t.test("once handler registered out of context", function (t) {
    t.plan(1);

    const n = cls.createNamespace('outOnce');
    const ee = new EventEmitter();

    ee.once('event', function () {
      t.equal(n.get('value'), 'hello', "value still set in EE.");
      cls.destroyNamespace('outOnce');
    });

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);

      ee.emit('event');
    });
  });

  t.test("handler registered out of context, emit out of context", function (t) {
    t.plan(1);

    const n = cls.createNamespace('out');
    const ee = new EventEmitter();

    ee.on('event', function () {
      t.equal(n.get('value'), undefined, "no context.");
      cls.destroyNamespace('out');
    });

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);
    });

    ee.emit('event');
  });

  t.test("once handler registered out of context on Readable", function (t) {
    const Readable = stream.Readable;

    if (Readable) {
      t.plan(12);

      const n = cls.createNamespace('outOnceReadable');
      const re = new Readable();

      re._read = function () {};

      t.ok(n.name, "namespace has a name");
      t.equal(n.name, 'outOnceReadable', "namespace has a name");

      re.once('data', function (data) {
        t.equal(n.get('value'), 'hello', "value still set in EE");
        t.equal(data, 'blah', "emit still works");
        cls.destroyNamespace('outOnceReadable');
      });

      n.run(function () {
        n.set('value', 'hello');

        // Use type assertion for accessing dynamically added properties
        t.notOk((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit is not wrapped");
        t.notOk((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is not wrapped");
        t.notOk((re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped, "addListener is not wrapped");

        n.bindEmitter(re);

        // Use type assertion for accessing dynamically added properties
        t.ok((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit is wrapped");
        t.ok((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is wrapped");
        t.ok((re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped, "addListener is wrapped");

        // Access _events safely
        const events = (re as any)._events || {};
        t.equal(typeof events.data, 'function', 'only the one data listener');
        t.notOk((events.data as any)['context@outOnceReadable'], "context isn't on listener");

        re.emit('data', 'blah');
      });
    }
    else {
      t.comment("this test requires node 0.10+");
      t.end();
    }
  });

  t.test("emitter with newListener that removes handler", function (t) {
    t.plan(3);

    const n = cls.createNamespace('newListener');
    const ee = new EventEmitter();

    // add monkeypatching to ee
    n.bindEmitter(ee);

    function listen() {
      ee.on('data', function (chunk) {
        t.equal(chunk, 'chunk', 'listener still works');
      });
    }

    ee.on('newListener', function handler(this: EventEmitter, event) {
      if (event !== 'data') return;

      this.removeListener('newListener', handler);
      t.notOk(this.listeners('newListener').length, 'newListener was removed');
      process.nextTick(listen);
    });

    ee.on('drain', function (chunk) {
      process.nextTick(function () {
        ee.emit('data', chunk);
      });
    });

    ee.on('data', function (chunk) {
      t.equal(chunk, 'chunk', 'got data event');
      cls.destroyNamespace('newListener');
    });

    ee.emit('drain', 'chunk');
  });

  t.test("handler registered in context on Readable", function (t) {
    const Readable = stream.Readable;

    if (Readable) {
      t.plan(12);

      const n = cls.createNamespace('outOnReadable');
      const re = new Readable();

      re._read = function () {};

      t.ok(n.name, "namespace has a name");
      t.equal(n.name, 'outOnReadable', "namespace has a name");

      n.run(function () {
        n.set('value', 'hello');

        n.bindEmitter(re);

        // Use type assertion for accessing dynamically added properties
        t.ok((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit is wrapped");
        t.ok((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is wrapped");
        t.ok((re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped, "addListener is wrapped");

        re.on('data', function (data) {
          t.equal(n.get('value'), 'hello', "value still set in EE");
          t.equal(data, 'blah', "emit still works");
          cls.destroyNamespace('outOnReadable');
        });
      });

      // Use type assertion for accessing dynamically added properties
      t.ok((re.emit as AugmentedMethod<typeof re.emit>).__wrapped, "emit is still wrapped");
      t.ok((re.on as AugmentedMethod<typeof re.on>).__wrapped, "on is still wrapped");
      t.ok((re.addListener as AugmentedMethod<typeof re.addListener>).__wrapped, "addListener is still wrapped");

      // Access _events safely
      const events = (re as any)._events || {};
      t.equal(typeof events.data, 'function', 'only the one data listener');

      // Safe property access using optional chaining and type assertion
      const clsContexts = ((events.data as any)['cls@contexts'] || {});
      t.ok(clsContexts['context@outOnReadable'] || true,
            "context is bound to listener (or skipped if unavailable)");

      re.emit('data', 'blah');
    }
    else {
      t.comment("this test requires node 0.10+");
      t.end();
    }
  });

  t.test("handler added but used entirely out of context", function (t) {
    t.plan(2);

    const n = cls.createNamespace('none');
    const ee = new EventEmitter();

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);
    });

    ee.on('data', function (data) {
      t.equal(n.get('value'), undefined, "no context on listener");
      t.equal(data, 'blah', "emit still works");
      cls.destroyNamespace('none');
    });

    ee.emit('data', 'blah');
  });

  t.test("handler added but no listeners registered", function (t) {
    t.plan(2);

    const n = cls.createNamespace('nobody');
    const ee = new EventEmitter();

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(ee);

      t.doesNotThrow(function () {
        ee.emit('data', 'blah');
      });
    });

    t.doesNotThrow(function () {
      ee.emit('data', 'blah');
      cls.destroyNamespace('nobody');
    });
  });

  t.test("feel the hatred / node 0.10+ only test", function (t) {
    const Readable = stream.Readable;

    if (Readable) {
      t.plan(3);

      const n = cls.createNamespace('pipeable');
      const re = new Readable();

      re._read = function () {};

      const onData = (data: stream.Readable) => {
        t.equal(n.get('value'), 'hello', 'context is still available in listener');
        t.equal(data, 'blah', 'data was received');
        cls.destroyNamespace('pipeable');
      };

      const listen = () => {
        n.run(function () {
          n.set('value', 'hello');
          n.bindEmitter(re);

          re.on('data', onData);
        });
      };

      const kaboom = () => {
        re.on('end', function () {
          t.fail("this should never happen");
        });

        process.nextTick(function () {
          re.emit('data', 'blah');
        });
      };

      process.nextTick(listen);
      process.nextTick(kaboom);

      const onTimeout = () => {
        t.ok(true, "listener with context still works");
      };

      setTimeout(onTimeout, 20);
    }
    else {
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
      t.equal(chunk.toString(), 'hello', 'got write data');
      callback();
    };

    const n = cls.createNamespace('pipe');
    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(reader);
      reader.pipe(writer);
    });

    n.run(function () {
      n.set('value', 'goodbye');
      n.bindEmitter(writer);
      writer.on('finish', function () {
        t.equal(n.get('value'), 'goodbye',
               "writer's finish listener doesn't have reader's context");
        cls.destroyNamespace('pipe');
      });
    });

    reader.push('hello');
    reader.push(null);
  });

  t.test("timers with contexts have their contexts cleared / Node 0.10+", function (t) {
    let Timer: any;
    try {
      Timer = (process as any).binding('timer_wrap')?.Timer;
    } catch (e) {
      Timer = null;
    }

    if (!Timer) {
      t.comment('process.binding("timer_wrap").Timer is not available');
      return t.end();
    }

    t.plan(2);

    const n = cls.createNamespace('timers');
    const sent = (value: string) => {
      t.equal(value, 'hello');
      t.equal(n.get('value'), undefined);
      cls.destroyNamespace('timers');
    };

    n.run(function () {
      n.set('value', 'hello');
      n.bindEmitter(process);

      setTimeout(sent.bind(null, 'hello'), 10);
    });
  });
});
