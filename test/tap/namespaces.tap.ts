'use strict';

import * as tap from 'tap';
import cls from '../../index';

const test = tap.test;

test("namespace management", function (t) {
  t.plan(8);

  t.throws(function () {
    // @ts-expect-error - Testing missing argument
    cls.createNamespace();
  }, "name is required");

  const namespace = cls.createNamespace('test');
  t.ok(namespace, "namespace is returned upon creation");

  t.equal(cls.getNamespace('test'), namespace, "namespace lookup works");

  t.doesNotThrow(function () { cls.reset(); }, "allows resetting namespaces");

  t.equal(Object.keys(process.namespaces).length, 0, "namespaces have been reset");

  cls.createNamespace('another');
  t.ok(process.namespaces.another, "namespace is available from global");

  t.doesNotThrow(function () {
    cls.destroyNamespace('another');
  }, "destroying works");

  t.notOk(process.namespaces.another, "namespace has been removed");
});
