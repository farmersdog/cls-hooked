"use strict";

// Ported from test/net-events2.test.ts (mocha) — cls with net connection,
// server.on('connection') variant.

import * as tap from "tap";
import * as net from "node:net";
import cls from "../../index";

const test = tap.test;

const DATUM1 = "Hello";
const DATUM2 = "GoodBye";
const TEST_VALUE = 0x1337;
const TEST_VALUE2 = "MONKEY";
const keyName = "netTest2";

test("cls with net connection 2", function (t) {
  t.plan(8);

  const namespace = cls.createNamespace("net2");

  namespace.run(function namespaceRun1(ctx: any) {
    namespace.set(keyName, TEST_VALUE);
    t.equal(namespace.get(keyName), ctx[keyName], "context should be the same");
    const server = net.createServer();

    server.on("connection", function OnServerConnection(socket) {
      t.equal(namespace.get(keyName), TEST_VALUE, "state has been mutated");
      // KNOWN DIVERGENCE from the async_hooks implementation: inbound
      // sockets are created in the C++ accept path, so their 'data' events
      // don't inherit the server's creation context under
      // AsyncLocalStorage. bindEmitter is the documented fix.
      namespace.bindEmitter(socket);
      socket.on("data", function OnServerSocketData(data: Buffer) {
        t.equal(data.toString("utf-8"), DATUM1, "should get DATUM1");
        t.equal(namespace.get(keyName), TEST_VALUE, "state is still preserved");

        socket.end(DATUM2);
        server.close();
      });
    });

    server.listen(function onServerListen() {
      namespace.run(function namespaceRun2(ctx2: any) {
        namespace.set(keyName, TEST_VALUE2);
        t.equal(namespace.get(keyName), ctx2[keyName], "context should be the same");

        const port = (server.address() as net.AddressInfo).port;
        const client = net.connect({ port }, function OnClientConnect() {
          t.equal(namespace.get(keyName), TEST_VALUE2, "state preserved for client connection");
          // deliberately unbound: the client socket is created in-context,
          // so its events must propagate on their own
          client.on("data", function OnClientSocketData(data: Buffer) {
            t.equal(data.toString("utf-8"), DATUM2, "should get DATUM2");
            t.equal(namespace.get(keyName), TEST_VALUE2, "state preserved for client data");
          });

          client.on("close", function onClientSocketClose() {
            cls.destroyNamespace("net2");
            t.end();
          });

          client.write(DATUM1);
        });
      });
    });
  });
});
