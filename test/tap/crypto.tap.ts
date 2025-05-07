'use strict';

import * as tap from 'tap';
import cls from '../../index';

const test = tap.test;

// Use require for crypto since we need synchronous loading
let crypto: typeof import('crypto') | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  crypto = require('crypto');
} catch (err) {
  // No crypto available
}

if (crypto) {
  test('continuation-local state with crypto.randomBytes', function (t) {
    t.plan(1);

    const namespace = cls.createNamespace('namespace');
    namespace.run(function () {
      namespace.set('test', 0xabad1dea);

      t.test("deflate", function (t) {
        namespace.run(function () {
          namespace.set('test', 42);
          crypto!.randomBytes(100, function (err) {
            if (err) throw err;
            t.equal(namespace.get('test'), 42, "mutated state was preserved");
            t.end();
          });
        });
      });
    });
  });

  test("continuation-local state with crypto.pseudoRandomBytes", function (t) {
    t.plan(1);

    const namespace = cls.createNamespace('namespace');
    namespace.run(function () {
      namespace.set('test', 0xabad1dea);

      t.test("deflate", function (t) {
        namespace.run(function () {
          namespace.set('test', 42);
          crypto!.pseudoRandomBytes(100, function (err) {
            if (err) throw err;
            t.equal(namespace.get('test'), 42, "mutated state was preserved");
            t.end();
          });
        });
      });
    });
  });

  test("continuation-local state with crypto.pbkdf2", function (t) {
    t.plan(1);

    const namespace = cls.createNamespace('namespace');
    namespace.run(function () {
      namespace.set('test', 0xabad1dea);

      t.test("deflate", function (t) {
        namespace.run(function () {
          namespace.set('test', 42);
          crypto!.pbkdf2("s3cr3tz", "451243", 10, 40, 'sha512', function (err) {
            if (err) throw err;
            t.equal(namespace.get('test'), 42, "mutated state was preserved");
            t.end();
          });
        });
      });
    });
  });
}
