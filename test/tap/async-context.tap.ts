'use strict';

import * as tap from 'tap';
import cls from '../../index';

const test = tap.test;

test("asynchronously propagating state with local-context-domains", function (t) {
  t.plan(2);

  const namespace = cls.createNamespace('namespace');
  t.ok(process.namespaces.namespace, "namespace has been created");

  namespace.run(function () {
    namespace.set('test', 1337);
    t.equal(namespace.get('test'), 1337, "namespace is working");
  });
});
