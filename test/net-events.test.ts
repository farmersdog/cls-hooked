'use strict';

import 'mocha';
import * as chai from 'chai';
import * as net from 'net';
import cls from '../index';

const should = chai.should();

describe('cls with net connection', () => {
  const namespace = cls.createNamespace('net');
  let testValue1: string;
  let testValue2: string;
  let testValue3: string;
  let testValue4: string;

  before(function(done) {
    let serverDone = false;
    let clientDone = false;

    namespace.run(() => {
      namespace.set('test', 'originalValue');

      let server: net.Server;
      namespace.run(() => {
        namespace.set('test', 'newContextValue');

        server = net.createServer((socket) => {
          //namespace.bindEmitter(socket);

          testValue1 = namespace.get('test');

          socket.on('data', () => {
            testValue2 = namespace.get('test');
            server.close();
            socket.end('GoodBye');

            serverDone = true;
            checkDone();
          });
        });

        server.listen(() => {
          const address = server.address() as net.AddressInfo;
          namespace.run(() => {
            namespace.set('test', 'MONKEY');

            const client = net.connect({ port: address.port }, () => {
              //namespace.bindEmitter(client);
              testValue3 = namespace.get('test');
              client.write('Hello');

              client.on('data', () => {
                testValue4 = namespace.get('test');
                clientDone = true;
                checkDone();
              });
            });
          });
        });
      });
    });

    function checkDone() {
      if (serverDone && clientDone) {
        done();
      }
    }
  });

  it('value newContextValue', () => {
    should.exist(testValue1);
    should.equal(testValue1, 'newContextValue');
  });

  it('value newContextValue 2', () => {
    should.exist(testValue2);
    should.equal(testValue2, 'newContextValue');
  });

  it('value MONKEY', () => {
    should.exist(testValue3);
    should.equal(testValue3, 'MONKEY');
  });

  it('value MONKEY 2', () => {
    should.exist(testValue4);
    should.equal(testValue4, 'MONKEY');
  });
});
