### Upcoming
- Implemented automatic ordering of systems for execution.  Systems will *not* be executed in order of definition any more!  You'll need to read the docs for `System.schedule` and add scheduling constraints to your systems.

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
- Chaned default component storage strategy to `packed` and elastic.  This will use less memory but decrease performance.  You can change the storage strategy back to the old `sparse` either by setting a component type's `storage` option, or by passing `defaultComponentStorage: 'sparse'` to the world options.

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
