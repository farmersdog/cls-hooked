'use strict';

// stdlib
import * as tap from 'tap';
import { EventEmitter } from 'events';

// module under test
import cls from '../../index';

const test = tap.test;

// multiple contexts in use
const tracer = cls.createNamespace('tracer');

interface Transaction {
  status: string;
}

class Trace {
  harvester: EventEmitter;

  constructor(harvester: EventEmitter) {
    this.harvester = harvester;
  }

  runHandler(handler: () => void): void {
    let trace = tracer.run(handler);
    this.harvester.emit('finished', (trace as any).transaction);
  }
}

test("simple tracer built on contexts", function (t) {
  t.plan(6);

  const harvester = new EventEmitter();
  const trace = new Trace(harvester);

  harvester.on('finished', function (transaction: Transaction) {
    t.ok(transaction, "transaction should have been passed in");
    t.equal(transaction.status, 'ok', "transaction should have finished OK");
    t.equal(Object.keys(process.namespaces).length, 1, "Should only have one namespace.");
  });

  trace.runHandler(function inScope() {
    t.ok(tracer.active, "tracer should have an active context");
    tracer.set('transaction', {status: 'ok'});
    t.ok(tracer.get('transaction'), "can retrieve newly-set value");
    t.equal(tracer.get('transaction').status, 'ok', "value should be correct");
  });
});
