"use strict";

import * as tap from "tap";
import { execFile } from "node:child_process";
import * as path from "node:path";

const test = tap.test;

test("proper exit on uncaughtException", function (t) {
  t.plan(2);

  const fixture = path.join(__dirname, "fixtures", "uncaught-exception-exit.ts");

  // Reuse this process's --import loader flags so the TS fixture is
  // compiled exactly the way this test file was.
  execFile(
    process.execPath,
    [...process.execArgv, fixture],
    { timeout: 30000 },
    function (err, stdout, stderr) {
      t.equal(err, null, "child exited cleanly" + (err ? ": " + stderr : ""));
      t.match(stdout, /CLEAN_EXIT/, "handler saw the error with the context unwound");
    },
  );
});
