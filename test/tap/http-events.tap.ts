"use strict";

// Ported from test/http-events.test.ts (mocha) — cls with http connections.
// The server is created inside a run(); node's http machinery preserves that
// context through the 'request' event and the request's 'data' events.

import * as tap from "tap";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import cls from "../../index";

const test = tap.test;

const DATUM1 = "Hello";
const DATUM2 = "GoodBye";
const TEST_VALUE = 0x1337;

test("cls with http connections", function (t) {
  t.plan(7);

  const namespace = cls.createNamespace("http");

  namespace.run(() => {
    namespace.set("test", TEST_VALUE);
    const server = http.createServer();

    server.on("request", function OnServerConnection(req, res) {
      t.equal(namespace.get("test"), TEST_VALUE, "server request event sees server context");

      req.on("data", function OnServerSocketData(data: Buffer) {
        t.equal(data.toString("utf-8"), DATUM1, "server received client data");
        t.equal(namespace.get("test"), TEST_VALUE, "server request data event sees server context");
        server.close();
        res.end(DATUM2);
      });
    });

    server.listen(0, function OnServerListen() {
      const port = (server.address() as AddressInfo).port;
      namespace.run(() => {
        namespace.set("test", "MONKEY");

        const request = http.request(
          { host: "localhost", port, method: "POST" },
          function OnClientConnect(res) {
            t.equal(namespace.get("test"), "MONKEY", "client response event sees client context");

            res.on("data", function OnClientSocketData(responseData: Buffer) {
              t.equal(responseData.toString("utf-8"), DATUM2, "client received server data");
              // note: matches the mocha original, which asserted the client
              // 'data' listener context via sinon calledWith(DATUM2, 'MONKEY')
              t.equal(
                namespace.get("test"),
                "MONKEY",
                "client response data event sees client context",
              );
              cls.destroyNamespace("http");
              t.end();
            });
          },
        );

        request.end(DATUM1);
      });
    });

    t.equal(namespace.get("test"), TEST_VALUE, "final context value unchanged in outer run");
  });
});
