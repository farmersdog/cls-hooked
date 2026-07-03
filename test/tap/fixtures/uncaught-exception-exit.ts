"use strict";

// Child fixture for proper-exit.tap.ts (kept out of the *.tap.ts glob).
// Throws inside ns.run() so the exception escapes to uncaughtException,
// then verifies the "proper exit" contract from the process's own handler:
// the context stack was unwound on the way out, the error still carries its
// context, and nothing keeps the process alive afterwards.

import cls from "../../../index";

const ns = cls.createNamespace("x");

process.on("uncaughtException", function (err: any) {
  if (err.message !== "oops") {
    console.error("WRONG_ERROR: " + err.message);
    process.exit(2);
  }

  // run()'s unwind already ran: nothing is left entered.
  if (ns.active !== null) {
    console.error("CONTEXT_NOT_EXITED");
    process.exit(3);
  }

  // The escaped error still carries the context it was thrown in.
  const errorContext = ns.fromException(err);
  if (!errorContext || errorContext._ns_name !== "x") {
    console.error("NO_ERROR_CONTEXT");
    process.exit(4);
  }

  console.log("CLEAN_EXIT");
  // Deliberately no process.exit() here: the process must drain and exit 0
  // on its own, proving the namespace holds no lingering handles or state.
});

ns.run(function () {
  throw new Error("oops");
});
