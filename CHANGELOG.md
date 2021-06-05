### Upcoming
- Only use `SharedArrayBuffer`s when running in multithreaded mode for maximum compatibility with browsers in singlethreaded mode.

### 0.5.0
- Renamed `@prop` to `@field`.
- Removed `suspend` option from `world.control` options.  I don't think suspension can be implemented given becsy's design.
- Enforced valid use of component instances obtained with `entity.read` and `entity.write`.  This slows down the dev version of becsy by 65%-70%, but the consequences of misusing the component instances would be catastrophic.  The perf version's performance is unaffacted.
- Make world creation and execution async.  You'll need to use `World.create` instead of directly calling the constructor, and await the result of both creating and executing the world.
- Add `system.attach` to create a reference to another system in the same world.
