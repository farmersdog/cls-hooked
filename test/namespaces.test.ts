'use strict';

import * as chai from 'chai';
import cls from '../index';
import type { CLSNamespace } from '../cls-async-storage';

const should = chai.should();

chai.config.includeStack = true;

describe('cls namespace management', () => {

  it('name is required', () => {
    should.Throw(() => {
      // @ts-expect-error - This should throw
      cls.createNamespace();
    });
  });

  let namespaceTest: CLSNamespace;
  before(() => {
    namespaceTest = cls.createNamespace('test');
  });

  it('namespace is returned upon creation', () => {
    should.exist(namespaceTest);
  });

  it('namespace lookup works', () => {
    should.exist(cls.getNamespace('test'));
    should.equal(cls.getNamespace('test'), namespaceTest);
  });

  it('allows resetting namespaces', () => {
    should.not.Throw(() => {
      cls.reset();
    });
  });

  it('namespaces have been reset', () => {
    should.equal(Object.keys(process.namespaces).length, 0);
  });

  it('namespace is available from global', () => {
    cls.createNamespace('another');
    should.exist(process.namespaces.another);
  });

  it('destroying works', () => {
    should.not.Throw(() => {
      cls.destroyNamespace('another');
    });
  });

  it('namespace has been removed', () => {
    should.not.exist(process.namespaces.another);
  });

});
