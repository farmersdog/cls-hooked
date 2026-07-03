"use strict";

// Ported from test/http-agent-break.test.ts (mocha) — the issue #71 repro:
// context retention across keep-alive http.Agent socket reuse.
//
// Differences from the original:
//  - Hits a local server instead of www.google.com (no network dependency).
//  - No bindEmitter on superagent internals. The original bound
//    superagent.Request.super_.super_.prototype (a global emitter-prototype
//    monkey-patch) to work around context loss in Node ≤ 8. Node core has
//    long since made the http client re-associate the async context per
//    request on reused agent sockets, so no binding is needed — and binding
//    a prototype actually SHADOWS correct AsyncLocalStorage propagation with
//    an empty context when events fire on a foreign chain.
//    Verified differentially: old (async_hooks) and new (ALS) both retain
//    context here with no binding, on Node 22 and 24.

import * as tap from "tap";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as superagent from "superagent";
import cls from "../../index";

const test = tap.test;
const keepAlive = process.env.KEEP_ALIVE !== "0";

test("cls with keep-alive http Agent (issue #71)", function (t) {
  t.plan(2);

  const namespace = cls.createNamespace("httpAgent");
  const httpAgent = new http.Agent({
    keepAlive: keepAlive,
    maxSockets: 1,
    keepAliveMsecs: 30000,
  });

  const server = http.createServer((req, res) => res.end("ok"));

  function doClsAction(id: number): Promise<number> {
    return new Promise((resolve, reject) => {
      namespace.run(function () {
        namespace.set("xid", id);
        const port = (server.address() as AddressInfo).port;
        const request = superagent.get("http://localhost:" + port + "/");
        if (keepAlive) {
          request.agent(httpAgent);
        }
        request.end(function (err) {
          if (err) return reject(err);
          resolve(namespace.get("xid"));
        });
      });
    });
  }

  server.listen(0, async () => {
    try {
      t.equal(await doClsAction(123), 123, "context retained during first request");
      // second request reuses the keep-alive socket from the first
      t.equal(
        await doClsAction(456),
        456,
        "context retained during second (socket-reusing) request",
      );
    } finally {
      httpAgent.destroy();
      server.close();
      cls.destroyNamespace("httpAgent");
      t.end();
    }
  });
});
