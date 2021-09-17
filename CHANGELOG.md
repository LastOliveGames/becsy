### 0.8.2
- Added `Entity.hold` and `Entity.isSame` methods.
- Stopped returning `this` from `Entity.add` and `Entity.addAll`.  This is technically a breaking change and ought to be a major version bump, but it feels so trivial I didn't want to bother.
- Started checking that `Entity` objects obtained from queries are not used for too long.  This reduced create/delete entity performance by 50% in dev mode, but didn't affect perf mode (where the check is bypassed).
- Documented `Entity` class.

### 0.8.1
- Improved query performance as the number of components grows.  This actually reduced performance on some of the synthetic benchmarks but should have a greatly positive effect in actual applications.
- Improved performance of component initialization, both with and without custom field values.
- Documented query builder and query object.

### 0.8.0
- Implemented automatic ordering of systems for execution.  Systems will *not* be executed in order of definition any more!  You'll need to read the docs for `System.schedule` and add scheduling constraints to your systems.  (You can also schedule whole groups at a time, which can come in handy! Don't forget that `@system` takes an optional group argument to easily group systems together.)
- The execution order gets logged to the console on startup when running in dev mode (unless `NODE_ENV=test` or `production`).  This should help you debug ordering issues.  Eventually, I'd like to draw the actual precedence graph but that's trickier.

### 0.7.0
- Renamed `all` to `current` in queries.
- Fixed issue with resurrected then re-removed components being freed prematurely.
- Merged entity deletion and component removal logs, so the `maxLimboEntities` world parameter is redundant and has been removed.
- Fixed entity creation to record a shape change, so that a component-less entity can satisfy queries.
- Refactored shape tracking arrays to prepare for multithreading.  This caused a 5%-15% performance impact on some workloads in the perf version.

### 0.6.1
- Exported `@system`.

### 0.6.0
- Fixed reactive queries.
- Exported `SystemGroup`.
- Made `@component` decorator automatically add the class to a new world's defs.
- Added a `@system` decorator to automatically add systems to a new world's defs, and optionally group them.
- Changed default component storage strategy to `packed` and elastic.  This will use less memory but decrease performance.  You can change the storage strategy back to the old `sparse` either by setting a component type's `storage` option, or by passing `defaultComponentStorage: 'sparse'` to the world options.

### 0.5.2
- Fixed bug in `weakObject` type.
- Fixed system groups.

### 0.5.1
- Only using `SharedArrayBuffer`s when running in multithreaded mode for maximum compatibility with browsers in singlethreaded mode.
- Added `world.createCustomExecutor` API for applications where not every system gets executed every turn (and some get executed more than once).
- Wrote a lot of doc comments for API methods.

### 0.5.0
- Renamed `@prop` to `@field`.
- Removed `suspend` option from `world.control` options.  I don't think suspension can be implemented given becsy's design.
- Enforced valid use of component instances obtained with `entity.read` and `entity.write`.  This slows down the dev version of becsy by 65%-70%, but the consequences of misusing the component instances would be catastrophic.  The perf version's performance is unaffacted.
- Made world creation and execution async.  You'll need to use `World.create` instead of directly calling the constructor, and await the result of both creating and executing the world.
- Added `system.attach` to create a reference to another system in the same world.
