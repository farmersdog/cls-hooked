# `cls-hooked` Changelog

## v5.0.0

**Internals rewritten from `async_hooks` to `AsyncLocalStorage`.** The
`async_hooks` module is unstable and unmaintained; `AsyncLocalStorage` is the
stable, supported replacement and is what Node itself optimizes
(`AsyncContextFrame` on Node ≥ 24). The public API is a drop-in replacement
for v4 — verified by differential testing of every API against the v4
implementation, plus end-to-end tests of the express middleware and
Sequelize v6 `useCLS` patterns (byte-identical observable behavior).

### Behavior differences from v4

1. **`await ns.runPromise(...)` no longer bleeds its context into the
   awaiting chain.** In v4, after the await, `ns.get()` returned values from
   the settled context — forever, even in later macrotasks. That was a
   context leak. If any code does `ns.get(...)` _after_ awaiting
   `runPromise` and relies on seeing inner values, it was relying on the
   leak and must read the value inside the callback instead.
2. **`ns.active` is `null` after a `runPromise` settles** instead of
   pointing at the dead context (same leak family).
3. **A synchronous throw inside `runPromise`'s fn now exits the context**
   before the exception propagates; v4 left the context stack permanently
   corrupted.
4. **The namespace registry is module-local instead of `process.namespaces`.**
   Storing it on `process` leaked namespaces across module-registry resets in
   test runners (e.g. a namespace registered by setup code survived into
   later Jest test environments) and shared namespaces by name across
   coexisting copies/versions of the library, mixing incompatible
   implementations. Node's module cache still makes the registry a
   process-wide singleton for a normally deduped install, so
   `createNamespace`/`getNamespace` behave identically there. The registry is
   readable via the new `getNamespaces()` export; the global
   `NodeJS.Process` type augmentation is gone from the shipped declarations.
5. **Known divergence — C++-triggered events on resources created inside a
   context**: an inbound server socket created in the C++ accept path does
   not inherit the context that was active when the _server_ was created,
   so its raw `'data'`-style listeners need `ns.bindEmitter(socket)`.
   `AsyncLocalStorage` propagates along the JS continuation chain, not the
   resource-trigger chain. This does **not** affect the standard express /
   Sequelize patterns (per-request/per-transaction contexts), where v4
   couldn't propagate implicitly either and middleware already binds
   req/res.

### TypeScript declarations (drop-in for @types/cls-hooked)

The package ships hand-authored type declarations (`types/index.d.ts`) shaped
to match `@types/cls-hooked@4.3.x`, so TypeScript consumers can drop the
`@types` package and keep compiling with zero code changes — including the
generic `Namespace<N>` interface, namespace-qualified type access through a
default import (`cls.Namespace`), and partial mock casts in tests. The
declarations, not the (stricter) implementation types, are the public
contract; compatibility is enforced by type-level tests (`npm run
test:types`) compiled under both `bundler` and `NodeNext` module resolution.

New v5 API is declared additively: `getNamespaces()` and `ERROR_SYMBOL`.

One deliberate divergence is retained from `@types/cls-hooked`:
`getNamespace()` is declared to return `Namespace | undefined`, but at
runtime a _destroyed_ namespace returns `null` (falsy either way) — matching
what existing code was written against.

### bindEmitter internals (emitter-listener replaced)

The abandoned, untested `emitter-listener` package (and its transitive
dependency `shimmer`) is replaced by an in-repo module,
[`wrap-emitter.ts`](./wrap-emitter.ts), leaving the package with **zero
runtime dependencies**. Instead of wrapping listeners at every emit —
which required monkeypatching `emit`, transiently rewriting the emitter's
private `_events` map, and wrapping/unwrapping `removeListener` around each
emit — listeners are bound once, when added. The module is unit-tested
(`test/tap/wrap-emitter.tap.ts`) and remains protocol-compatible with
`emitter-listener` (same `'wrap@before'` hook registry and
`__wrapped`/`__unwrap` markers), so a coexisting cls-hooked v4 copy can
safely bind the same emitter. Minor observable differences:

- `emit` on a bound emitter is no longer patched. `rawListeners()` returns
  the bound wrapper (with `.listener` pointing at the original);
  `listeners()`, `listenerCount(fn)`, `removeListener`/`off`, and the
  `newListener`/`removeListener` event arguments all still see the
  original listener.
- `prependListener`/`prependOnceListener` listeners are now bound too (v4
  never attached contexts to prepended listeners).
- A listener added while no context is active now runs unbound, i.e. in
  the emit-time context. v4 bound it at emit time to the then-active
  context (same result) or, when emitting entirely outside any context, to
  a throwaway fresh context — the only visible effect of which was that
  `ns.active` was non-null and `ns.set()` silently wrote to a discarded
  object; now `ns.active` is `null` there and `ns.set()` throws, like
  everywhere else outside a context.

### Other changes

- **Zero runtime dependencies** (see above; was `emitter-listener` +
  `shimmer`).
- Node ≥ 22 required. Tested on 22 (async_hooks-backed ALS) and 24
  (AsyncContextFrame-backed ALS).
- Compiled output targets ES2022 (was ES5) — native classes and
  async/await instead of downleveled helper code.
- Source ported to TypeScript; type declarations shipped (see "TypeScript
  declarations" above — remove `@types/cls-hooked` when upgrading).
- Package exposes the same CommonJS named exports as v4
  (`require('@farmersdog/cls-hooked').createNamespace` etc.) plus a default
  export for ESM/TS consumers.
- Test suite consolidated on `tap` (mocha/chai removed), coverage restored
  to parity with v4 and extended with differential-parity regression tests
  (`test/tap/als-parity.tap.ts`).
- (fixed during the alpha series) `exit()` restores the
  `AsyncLocalStorage` frame recorded at the matching `enter()` instead of
  the sync-stack value, so a `bind()` invoked synchronously inside the very
  context it captured (the context-logger idiom), and raw `enter()`/`exit()`
  pairs in async continuations, no longer wipe the chain's context
  (`test/tap/reentrant-bind-exit.tap.ts`).

### Tooling

- Linting/formatting moved from `eslint` + `@typescript-eslint` to `oxlint`
  and `oxfmt` (configs: `.oxlintrc.json`, `.oxfmtrc.json`; scripts: `lint`,
  `lint:fix`, `format`, `format:check`). Entire repo formatted with `oxfmt`
  defaults.
- TypeScript 6 with `module`/`moduleResolution: NodeNext` and explicit
  `types: ["node"]` (TS 6 removed the implicit `node10` resolution that
  auto-loaded `@types/node`). Emit is unchanged CommonJS since the package
  has no `"type"` field.
- All devDependencies updated to latest; `@types/tap` removed (`tap` v21
  ships its own types). `npm audit`: 0 vulnerabilities.

## v4.5.0

- chore: Update repo reources so this can be re-published as a public module

## v4.4.0

- fix: Null contexts when destorying namespace to avoid memory leak - Thanks @alexgarbarev!
- chore: scope forked package under @farmersdog npm namesepace

## v4.3.0

- chore: update dependenices

## v4.2.2

- bump async-hook-jl version for babel support

## v4.2.1

- chore(release): v4.2.1 - Issue #9, PR #10 - Reduce Memory Leaks - Thanks @JohnCMcDonough!

## v4.2.0

- feat(compat): v4.2 for node v4.7-v8

## v4.1.7

- fix: npm engine semver to allow node 6.10.x.
- chore: forked async-hook to updated its engine semver also

## v4.1.6

- fix: Use the correct `err` variable name in try/catch. Thanks to [@enko](https://github.com/enko).

## v4.1.5

- dep: update engine support ^4.7||^6.9.2||^7.3 to be same as `async-hook`'s
- dep: update `async-hook` to 1.7.1
- test: give `fs.watchFile` a little more time to pass on Travis CI

## v4.1.4

- feat: supports node 4.5.0 now
- test: add node 4 to travis

## v4.1.3

- dep: updated dependencies. Fix eslint issues
- feat: add runPromise

## v4.1.2

- chore: republishing to npm v4.1.2
- test: Update travis and strict npm engine to ^6.2.2

## v4.1.1

- test: Updated travis and strict npm engine to ^6.2.2

## v4.1.0

- feat: add `runAndReturn` method to get return value of `func` (from [@overlookmotel](https://github.com/overlookmotel/node-continuation-local-storage)).

## v4.0.1

- feat: Same API but major change to implementation. Uses **unofficial** [AsyncWrap](https://github.com/nodejs/node-eps/blob/async-wrap-ep/XXX-asyncwrap-api.md) instead of [async-listener](https://github.com/othiym23/async-listener).

### v3.1.0 (2014-07-28):

- Updated to use `async-listener@0.4.7` to pick up bug fixes.

### v3.0.0 (2013-12-14):

- Removed the notion of a "default" or "global" context per namespace.
  It only existed to create a simpler interface for developing and testing the module,
  and created the potential for nasty information disclosure bugs
  (see [issue #14](https://github.com/othiym23/node-continuation-local-storage/issues/14)
  for details). This is potentially a breaking change, if you're depending on the global context,
  so semver says we have to bump the major version.
- Added this changelog.

### v2.6.2 (2013-12-07):

- `async-listener` and `emitter-listener` dependency refresh.

### v2.6.1 (2013-11-29):

- `emitter-listener` has been extracted from `shimmer` into a standalone module
  for `namespace.bindEmitter()`.

### v2.6.0 (2013-11-27):

- When an error is thrown in a CLS-bound continuation chain, attach the active
  context for the namespace to which the chain is bound. This is necessary
  because CLS and asyncListeners actually do too good a job of cleaning up
  after errors, and so they don't escape the continuation chain. New Relic
  needs the context so it can get the transaction active when the error
  happened for error tracing.

### v2.5.2 (2013-10-30):

- `async-listener` dependency refresh for better support of node 0.8.0 - 0.8.3.

### v2.5.1 (2013-10-27):

- `async-listener` dependency refresh.

### v2.5.0 (2013-10-27):

- Relax the requirement that CLS contexts be pushed and popped from a stack,
  instead treating them as a set. This allows context interleaving (i.e.
  using the lower-level `namespace.enter()` and `namespace.exit()` API without
  any strict ordering dependencies). Everything works, but this still makes me
  a little uneasy.
- EEs can now be bound to multiple namespaces, although this is likely to be
  slow.

### v2.4.4 (2013-10-27):

- Even if you use an EE bound to a namespace outside a continuation chain, it
  shouldn't explode.

### v2.4.3 (2013-10-16):

- `async-listener` dependency refresh.

### v2.4.2 (2013-10-13):

- More tweaks for `async-listener` error handlers (just a dependency refresh).

### v2.4.1 (2013-10-12):

- `async-listener` error listeners have gotten lots of tweaks. Update to newest
  API.
- Only exit namespace context on error if a continuation chain is active.

### v2.4.0 (2013-10-11):

- `async-listener` now supports error listeners. Update to newest API.
- Namespace context should be exited on asynchronous errors.

### v2.3.4 (2013-10-03):

- When EEs are in the middle of emitting, make sure that calls to
  `emitter.removeListener` are testing against non-monkeypatched versions of
  the event handlers (necessary so certain Connect middleware functions, such
  as `connect.limit`, run correctly).

### v2.3.3 (2013-10-02):

- Ensure handler rebinding gets called even in case of errors.
- Be consistent about making sure contexts are kept in a sane state when errors
  are thrown in EEs.

### v2.3.2 (2013-10-02):

- Guard `on` / `addListener` remonkeypatching in `namespace.bindEmitter()` so
  that `shimmer` is only called to rebind if the monkeypatched versions have
  actually been replaced.
- Don't try to call emit if there are no listeners on a bound EE.
- Don't use `setImmediate` in tests, because it's not available in Node 0.8.x.

### v2.3.1 (2013-10-01):

- Update to newest version of `async-listener`.
- Fix typo.

### v2.3.0 (2013-09-30):

- EventEmitters can now be bound to CLS namespaces. Because EEs act as coupling
  points between asynchronous domains, it's necessary for the EE binding to
  capture the CLS context both when the listener is added, and when a matching
  handler is firing because of a matching event being emitted.

### v2.2.1 (2013-09-30):

- More tweaks to conform with `asyncListener` API changes.
- Many more test cases to ensure `asyncListener` stuff is working with Node
  0.8.x.

### v2.2.0 (2013-09-26):

- Square up with latest `async-listener` / node PR #6011 changes.

### v2.1.2 (2013-09-09):

- Document `namespace.createContext()`.
- Fix issue where a value was _always_ being returned from `namespace.run()`,
  even on error.

### v2.1.1 (2013-09-03):

- Clean up minor typo in docs.

### v2.1.0 (2013-09-03):

- Incorporate documentation from failed CLS PR.
- `namespace.bind()` now also always exits the domain, even on error.
- Namespaces can be destroyed.
- `cls.reset()` allows tests to nuke all existing namespaces (use with care
  obviously).

### v2.0.0 (2013-09-01):

- Use `async-listener` polyfill instead of `cls-glue`.
- Incorporate tests from `cls-glue`.

### v1.1.1 (2013-09-01):

- Namespace exits context even on error.

### v1.1.0 (2013-07-30):

- Split createContext so it's part of the namespace API.
- Tweak error message to be more informative.

### v1.0.1 (2013-07-25):

- Correct Tim's email address.

### v1.0.0 (2013-07-25):

- Each application of CLS is allocated its own "namespace", which bind data to
  continuation chains, either using `.run()` or `.bind()` to create a new
  nested context. These nested contexts are prototype chains that point back to
  a "default" / "global" context, with the default context for each namespace
  being a prototype-free "data bag" created with `Object.create(null)`.

### v0.1.1 (2013-05-03):

- Document progress thus far.

### v0.1.0 (2013-05-03):

- First attempt: basic API, docs, and tests.
