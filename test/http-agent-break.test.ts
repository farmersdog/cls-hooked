'use strict';

import * as chai from 'chai';
// @ts-ignore - superagent has internal properties we need to access
import * as superagent from 'superagent';
import * as http from 'http';
import cls from '../index';

const should = chai.should();
const keepAlive = process.env.KEEP_ALIVE !== '0';

// Add chai extension for testing
declare global {
  interface Number {
    should: {
      equal(value: number): void;
    };
  }
}

describe('cls with http Agent', () => {
  let httpAgent: http.Agent;
  let namespace = cls.createNamespace('httpAgent');

  before(() => {
    httpAgent = new http.Agent({
      keepAlive: keepAlive,
      maxSockets: 1,
      keepAliveMsecs: 30000
    });
  });

  describe('when making two http requests', () => {
    let innerRequestContextValue: number;

    it('should retain context during first', (done) => {
      doClsAction(123, () => {
        should.exist(innerRequestContextValue);
        should.equal(innerRequestContextValue, 123);
        done();
      });
    });

    it('should retain context during second', (done) => {
      doClsAction(456, () => {
        should.exist(innerRequestContextValue);
        should.equal(innerRequestContextValue, 456);
        done();
      });
    });

    function doClsAction(id: number, cb: (err?: Error) => void) {
      namespace.run(function () {
        const xid = id;
        namespace.set('xid', xid);
        //process._rawDebug('before calling httpGetRequest: xid value', namespace.get('xid'));

        httpGetRequest(function (e) {
          //process._rawDebug('returned from action xid value', namespace.get('xid'), 'expected', xid);
          innerRequestContextValue = namespace.get('xid');
          //assert.equal(namespace.get('xid'), xid);
          cb(e);
        });
      });
    }

    function httpGetRequest(cb: (err?: Error, result?: any) => void) {
      try {
        // Try to bind the superagent Request prototype safely
        if (superagent && (superagent as any).Request) {
          // Try direct prototype first
          namespace.bindEmitter((superagent as any).Request.prototype);
        }
      } catch (e) {
        console.warn('Could not bind emitter to superagent prototype:', e);
      }

      const req = superagent.get('http://www.google.com');

      if (keepAlive) {
        //process._rawDebug('Keep alive ENABLED, setting http agent');
        req.agent(httpAgent);
      }

      req.end(function (err, res) {
        if (err) {
          cb(err);
        } else {
          //process._rawDebug('http get status', res.status);
          cb(undefined, {status: res.status, statusText: res.text, obj: res.body});
        }
      });
    }
  });
});
