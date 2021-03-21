# becsy

A multithreaded Entity Component System (ECS) for TypeScript and JavaScript, inspired by [ECSY](https://github.com/ecsyjs/ecsy) and [bitecs](https://github.com/NateTheGreatt/bitECS), and guided by [ideas from Flecs](https://ajmmertens.medium.com/why-vanilla-ecs-is-not-enough-d7ed4e3bebe5).

From ECSY we take:
- [x] a friendly object-oriented API for both JS and TS clients
- [x] multiple queries per system
- [x] reactive queries (rather than event callbacks)
- [x] explicit mutation tracking
- [ ] references to native JS objects in components

From bitecs we take:
- [x] extensive use of `ArrayBuffer` for performance
- [x] a sparse array architecture
- [ ] Node and browser compatibility with no dependencies

Then we add:
- [ ] entity references that can be traversed in either direction
- [ ] declarative system ordering based on data dependencies
- [ ] built-in support for representing state machines (per [Sander Mertens](https://ajmmertens.medium.com/why-storing-state-machines-in-ecs-is-a-bad-idea-742de7a18e59))
- [ ] multithreaded system execution!

Overall, becsy aims to be feature rich without sacrificing too much performance.  The goal is to be 5x faster than ECSY when single-threaded, and much faster than bitecs when multithreaded as long as the problem is parallelizable.  Here's a snapshot of current performance per [ecs-benchmark](https://github.com/noctjs/ecs-benchmark) -- obviously not quite there yet:

|     | packed_1 | packed_5 | simple_iter | frag_iter | entity_cycle | add_remove |
| --- | --: |--: |--: |--: |--: |--: |
| becsy | 1,079 op/s | 912 op/s | 488 op/s | 1,671 op/s | 717 op/s | 1,737 op/s |
| bitecs | 237,562 op/s | 225,574 op/s | 107,462 op/s | 281,957 op/s | 1,530 op/s | 2,908 op/s |
| ecsy | 4,679 op/s | 3,055 op/s | 2,214 op/s | 14,055 op/s | 17 op/s | 317 op/s |
