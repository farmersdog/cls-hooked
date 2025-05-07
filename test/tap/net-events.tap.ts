'use strict';

import * as net from 'net';
import * as tap from 'tap';
import cls from '../../index';

const test = tap.test;

test('continuation-local state with net connection', function(t) {
  t.plan(4);

  const namespace = cls.createNamespace('net');
  namespace.run(function() {
    namespace.set('test', 'originalValue');

    let server: net.Server;
    namespace.run(function() {
      namespace.set('test', 'newContextValue');

      server = net.createServer(function(socket) {
        t.equal(namespace.get('test'), 'newContextValue', 'state has been mutated');
        namespace.bindEmitter(socket);
        socket.on('data', function() {
          t.equal(namespace.get('test'), 'newContextValue', 'state is still preserved');
          server.close();
          socket.end('GoodBye');
        });
      });
      server.listen(function() {
        const address = server.address() as net.AddressInfo;
        namespace.run(function() {
          namespace.set('test', 'MONKEY');
          const client = net.connect(address.port, 'localhost', function() {
            t.equal(namespace.get('test'), 'MONKEY', 'state preserved for client connection');
            client.write('Hello');
            namespace.bindEmitter(client);
            client.on('data', function() {
              t.equal(namespace.get('test'), 'MONKEY', 'state preserved for client data');
              t.end();
            });
          });
        });
      });
    });
  });
});
