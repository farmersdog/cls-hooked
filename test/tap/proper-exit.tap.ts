'use strict';

import * as tap from 'tap';
import * as util from 'util';
import cls from '../../index';

const test = tap.test;

test('proper exit on uncaughtException', {skip: true}, function(t) {
  process.on('uncaughtException', function(err: Error) {
    if (err.message === 'oops') {
      //console.log("ok got expected message: %s", err.message);
      t.pass(util.format("ok got expected message: %s", err.message));
    }
    else {
      throw err;
    }
  });

  const ns = cls.createNamespace('x');
  ns.run(function() {
    throw new Error('oops');
  });
});
