### Upcoming
- Ensure `cancelIfCoroutineStarted` is respected even if coroutine throws an exception when invoked.

### 0.15.4
- Correctly cancel mutually exclusive scoped coroutines that declare their scope from *inside* the coroutine.

### 0.15.3
- Prevent an internal error when deleting an entity that has refs to it while tracking writes.

### 0.15.2
- Properly block on internal async function calls when executing a frame, even though the functions are effectively synchronous when running single-threaded, to ensure that some exceptions aren't accidentally discarded.

### 0.15.1
- Relax concurrency requirements for the `update` entitlement, so it can run in parallel with any other entitlement.
- Improve internal error messages for logs.

### 0.15.0
- Started enforcing unique system and component type names as it's needed to keep correct stats.  Anonymous types will get an automatically generated name.
- Made component and system types available in `world.stats.components` and `world.stats.systems`, so you can easily get a list of all component and system types for debugging purposes (and to plug as input into other Becsy APIs).

### 0.14.5
- Added `trackMatches` modifier to track changes to the components that match a `withAny` clause.  This is particularly useful to trigger a handler whenever an entity's enum state changes but works with any set of components.  It can be mixed and matched with `trackWrites` but there's no way to tell which tracker caused an entity to be added to the `changed` set.
- Fixed enums to work correctly when the number of elements is a power of 2.
- Checked a bit more thoroughly to ensure that types and enums used in queries are defined in the world.
- Released enum bindings when a world is terminated.

### 0.14.4
- Added `update` entitlement to allow implicit `backrefs` updates concurrently with reads and updates on the same components.
- When writing refs that affect backrefs fields, constrained entitlement checks to the actual component types affected by the backrefs update, rather than arbitrarily checking other ones that happened to get internally binned together.

### 0.14.3
- Fixed crash when a component was added and removed multiple times within one frame.

### 0.14.2
- Improved internal error messages for component storage.

### 0.14.1
- Fixed perf build when validators are used.

### 0.14.0
- Added the `vector` data type, for fixed-length arrays of numbers, optionally with named elements and backed by a rich class of your choosing.  See the [docs](https://lastolivegames.github.io/becsy/guide/architecture/components.html#numeric-vectors) for details.
- Improved the separation between read-only and writable component instances.  You can now safely use `read` and `write` instances of the same component type at the same time, whereas before it would've silently targeted the wrong entity on one of the instances.  This change happened to improve dev mode performance by 10% to 20%, but reduced perf mode performance by up to 10% for `packed` storage (though not for `sparse` storage).
- Added `inAnyOrderWithReadersOf` and `inAnyOrderWithWritersOf` scheduling clauses, to explicitly cancel the automatic order induced by a system's queries' entitlements.  All other scheduling clauses trump these ones, though.
- Renamed `beforeReadsFrom`, `afterReadsFrom`, `beforeWritesTo`, and `afterWritesTo` scheduling clauses to `beforeReadersOf`, `afterReadersOf`, `beforeWritersOf`, and `afterWritersOf` to better reflect their true meaning.
- Renamed the `track` modifier to `trackWrites`.  You'll need to update any queries that used it.
- Validated that queries have `trackWrites` qualifiers iff they have a `changed` result set (or variant).

### 0.13.2
- Added support for enum component types.  You can use them when a set of components is mutually exclusive, and you need to be able to easily find out which (if any) is currently present on an entity.  Enum component types are fully-featured, though they're most often used as tags.
- Added a `withAny` clause for queries that's useful for enums, but also works well with normal component types.
- Fixed `singleton.write` to track changes in every frame when used in a system's declaration.
- Allowed `singleton.read` and `singleton.write` to be used inside `execute` to dynamically access a singleton (and only trigger change tracking when needed).
- Exported `Waitable` to pacify TypeScript when using coroutines, even though it's internal.

### 0.13.1
- Improved performance in a few cases by ~10%.
- Improved query `orderBy` performance.
- Fixed a case where a `current` query could become corrupted after an entity was removed from the results.

### 0.13.0
- Changed query clauses `using` and `usingAll` to **not** automatically grab a `read` entitlement.  You'll need to explicitly suffix with `.read` from now on.  (`with` and `without` still automatically claim `read`.)
- Introduced a `create` entitlement that doesn't create precedence dependencies with other `create` systems, and that will be able to run concurrently under multi-threading.

### 0.12.3
- Added `allSystems` to the schedule builder object to facilitate sweeping precedence constraints.
- Changed `before` and `after` constraints (when used on groups) to ignore any systems that show up in both the subject and target sets.
- Fixed systems getting skipped when initializing / finalizing, and occasional world lock-ups due to that.

### 0.12.2
- Added `hasSomeOf`, `hasAllOf`, `hasAnyOtherThan`, and `countHas` to `Entity`.
- Implemented experimental global component combination validators.  You can add a static `validate(entity)` method to any component type and check for valid combinations of components using the `has` collection of methods, throwing an error if a check fails.  *All* validation methods are executed for *all* entities whose components have changed after each system executes (not just ones that have a component of the method's host type), and the system's read entitlements are bypassed during these checks.  Entities are not validated in response to writes, so validators shouldn't look at fields.  Entities are not validated at all in the perf build.
- Added `Entity.ordinal`.
- Implemented query result ordering via `orderBy`.  Just pass in a function to transform entities into numeric values and all results will be sorted by the function's output in ascending order.  There are some optimizations to avoid unnecessary sorting, especially in the common case of `orderBy(entity => entity.ordinal)`.

### 0.12.1
- Fixed world initialization and finalization to run end-of-cycle processing.

### 0.12.0
- Added `System.finalize`, to be automatically invoked on all systems when a world is terminated.
- Made `Frame.begin` and `Frame.end` async.

### 0.11.0
- Made `World.terminate` async.
- `World.terminate` will now disentangle the world from all its component types, so they can be bound to a new world.

### 0.10.13
- Added `usingAll` query modifier to declare a dependency on all component types in the world.
- Fixed unconstrained queries to actually select all entities.

### 0.10.12
- Prevented starting coroutines in the `World.build` system.
- Prevented use of `World.build` and `World.createEntity` after world has started executing.
- Added `World.terminate` to kill off a world.  This is a no-op for now but in the future will clean up worker threads.
- Improved efficiency of processing systems with no queries.
- Fixed dynamic strings with odd max lengths.

### 0.10.11
- Fixed queries that involve component types beyond the 31st.

### 0.10.10
- Fixed bug with initializing components with backrefs introduced in 0.10.8.

### 0.10.9
- Used stronger transitive precedence paths between systems to override weak cycles.

### 0.10.1, 0.10.2, 0.10.3, 0.10.4, 0.10.5, 0.10.6, 0.10.7, 0.10.8
- Fixed a lot of entity ref bugs.
- Improved reporting of internal errors.

### 0.10.0
- Implemented `compact` storage strategy.  This is very parsimonious in memory usage but also very slow as the number of allocated components grows so you shoud only consider using it if you have just a handful of components of a given type.
- Implemented easy declaration of and access to singleton components.  See `System.singleton.read` and `System.singleton.write` for docs.
- Changed the signature of `System.start`.  `@co` usage is unaffected.
- Added `cancelIfCoroutineStarted` to implement mutually exclusive coroutines.
- Made sure to reset `accessRecentlyDeletedData` between coroutines.
- Fixed system dependency cycle detection to detect cycles that it missed before.

### 0.9.4
- Fixed the perf build, which got broken in 0.9.2.

### 0.9.3
- Put field types directly off the `field` decorator, so you can just do `@field.int32` instead of `@field(Type.int32)`.  Less imports, less typing, more readable -- a win all around!  You still need to use the long form if you want to specify any field options, though.
- Added support for coroutines in systems.  See `System.start` for some docs.
- Fixed worlds with no component types were unable to create (empty) entities.

### 0.9.2
- Allowed duplicate component and system types in world defs.  They'll be deduplicated automatically, though only one copy of a system type is allowed to have initial props specified.
- Added recording of some basic stats about systems in `World.stats`.
- Added a scheduling definition function argument to the `@system` decorator.  This is equivalent to but requires less boilerplate than invoking `this.schedule` in the system itself.
- Fixed `@system` decorator not adding system to world defs if it was passed an argument.
- Made a simple example in both TypeScript and JavaScript flavors.

### 0.9.1
- Fix crash when using backref fields in components with an elastic storage type.

### 0.9.0
- Made `System.initialize` non-async, and added a new `System.prepare` method that is async and gets called first, but isn't allowed to touch entities.  This split was necessary because JS doesn't have a way to carry a context across async calls — Node has `async_hooks` but there's no browser equivalent.
- `System.prepare` methods are run concurrently in accordance with the systems' schedules.  This can help improve performance on load.

### 0.8.4
- Fixed `System.initialize` to not invalidate entities immediately upon creation.

### 0.8.3
- Made `enum`s non-`const` so they don't break in builds with isolated modules.

### 0.8.2
- Added `Entity.hold` and `Entity.isSame` methods.
- Stopped returning `this` from `Entity.add` and `Entity.addAll`.  This is technically a breaking change and ought to be a major version bump, but it feels so trivial I didn't want to bother.
- Started checking that `Entity` objects obtained from queries are not used for too long.  This reduced create/delete entity performance by 50% in dev mode, but didn't affect perf mode (where the check is bypassed).
- Fixed `System.attach` to return actual system, not an internal handle.
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
