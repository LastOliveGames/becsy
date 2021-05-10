# becsy

A multithreaded Entity Component System (ECS) for TypeScript and JavaScript, inspired by [ECSY](https://github.com/ecsyjs/ecsy) and [bitecs](https://github.com/NateTheGreatt/bitECS), and guided by [ideas from Flecs](https://ajmmertens.medium.com/why-vanilla-ecs-is-not-enough-d7ed4e3bebe5).

From ECSY we take:
- [x] a friendly object-oriented API for both JS and TS clients
- [x] multiple queries per system
- [x] reactive queries (rather than event callbacks)
- [x] explicit mutation tracking
- [x] references to native JS objects in components

From bitecs we take:
- [x] extensive use of `ArrayBuffer` for performance
- [x] a sparse array architecture
- [x] Node and browser compatibility with no dependencies

Then we add:
- [x] native TypeScript implementation, for a type-friendly design and the best typings
- [x] selectable component storage strategies, to adjust the performance/memory trade-off
- [x] weak references to native JS objects, for better integration with other frameworks
- [x] entity references that can be traversed in either direction, with strong referential integrity
- [ ] declarative system ordering based on data dependencies
- [ ] built-in support for representing state machines (per [Sander Mertens](https://ajmmertens.medium.com/why-storing-state-machines-in-ecs-is-a-bad-idea-742de7a18e59))
- [ ] multithreaded system execution
- [ ] an optional but nicely integrated networked data replication system

Overall, becsy aims to be feature rich without sacrificing too much performance.  The goal is to be 10x faster than ECSY when single-threaded, and faster than bitecs when multithreaded as long as the problem is parallelizable.  Here's a snapshot of current performance per [ecs-benchmark](https://github.com/noctjs/ecs-benchmark) -- note that there are separate development and performance builds of becsy, with all safety checks removed from the latter:

|     | packed_1 | packed_5 | simple_iter | frag_iter | entity_cycle | add_remove |
| --- | --: |--: |--: |--: |--: |--: |
| becsy | 14,661 op/s | 15,994 op/s | 2,877 op/s | 29,098 op/s | 1,166 op/s | 5,166 op/s |
| becsy/perf | 57,102 op/s | 56,185 op/s | 35,354 op/s | 93,403 op/s | 1,063 op/s | 6,651 op/s |
| bitecs | 185,036 op/s | 182,400 op/s | 114,440 op/s | 376,528 op/s | 1,790 op/s | 3,357 op/s |
| ecsy | 4,769 op/s | 3,197 op/s | 2,174 op/s | 12,033 op/s | 18 op/s | 397 op/s |
