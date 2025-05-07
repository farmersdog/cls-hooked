'use strict';

import 'mocha';
import * as chai from 'chai';
import * as util from 'util';
import cls from '../index';

const should = chai.should();

describe('multiple namespaces handles them correctly', () => {
  let test1Val: string;
  let test2Val: string;
  let test3Val: string;
  let test4Val: string;

  const ns1 = cls.createNamespace('ONE');
  const ns2 = cls.createNamespace('TWO');

  before((done) => {
    ns1.run(() => {
      ns2.run(() => {
        ns1.set('name', 'tom1');
        ns2.set('name', 'paul2');

        setTimeout(() => {
          ns1.run(() => {
            process.nextTick(() => {
              test1Val = ns1.get('name');
              console.debug(util.inspect(ns1), true);

              test2Val = ns2.get('name');
              console.debug(util.inspect(ns2), true);

              ns1.set('name', 'bob');
              ns2.set('name', 'alice');

              setTimeout(function() {
                test3Val = ns1.get('name');
                test4Val = ns2.get('name');
                done();
              });
            });
          });
        });
      });
    });
  });

  it('name tom1', () => {
    should.equal(test1Val, 'tom1');
  });

  it('name paul2', () => {
    should.equal(test2Val, 'paul2');
  });

  it('name bob', () => {
    should.equal(test3Val, 'bob');
  });

  it('name alice', () => {
    should.equal(test4Val, 'alice');
  });
});

