'use strict';

import * as tap from 'tap';
import * as zlib from 'zlib';
import cls from '../../index';

const test = tap.test;

test("continuation-local state with zlib", function (t) {
  t.plan(1);

  const namespace = cls.createNamespace('namespace');
  namespace.run(function () {
    namespace.set('test', 0xabad1dea);

    t.test("deflate", function (t) {
      namespace.run(function () {
        namespace.set('test', 42);
        zlib.deflate(Buffer.from("Goodbye World"), function (err) {
          if (err) throw err;
          t.equal(namespace.get('test'), 42, "mutated state was preserved");
          t.end();
        });
      });
    });
  });
});
