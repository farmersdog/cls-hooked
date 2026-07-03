"use strict";

import * as net from "net";
import * as tap from "tap";
import cls from "../../index";

const test = tap.test;

test("continuation-local state with net connection", function (t) {
  t.plan(4);

  const namespace = cls.createNamespace("net");
  namespace.run(function () {
    namespace.set("test", "originalValue");

    let server: net.Server;
    namespace.run(function () {
      namespace.set("test", "newContextValue");

      server = net.createServer(function (socket) {
        t.equal(namespace.get("test"), "newContextValue", "state has been mutated");
        // KNOWN DIVERGENCE from the async_hooks implementation: an inbound
        // socket's resource is created in the C++ accept path, so
        // AsyncLocalStorage cannot implicitly propagate a context that was
        // active when the *server* was created into the socket's 'data'
        // events. bindEmitter is the documented fix. (The client socket
        // below is created in-context and needs no binding.)
        namespace.bindEmitter(socket);
        socket.on("data", function () {
          t.equal(namespace.get("test"), "newContextValue", "state is still preserved");
          server.close();
          socket.end("GoodBye");
        });
      });
      server.listen(function () {
        const address = server.address() as net.AddressInfo;
        namespace.run(function () {
          namespace.set("test", "MONKEY");
          const client = net.connect(address.port, "localhost", function () {
            t.equal(namespace.get("test"), "MONKEY", "state preserved for client connection");
            client.write("Hello");
            client.on("data", function () {
              t.equal(namespace.get("test"), "MONKEY", "state preserved for client data");
              t.end();
            });
          });
        });
      });
    });
  });
});
