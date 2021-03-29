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
- [ ] multithreaded system execution
- [ ] an optional but nicely integrated networked data replication system

Overall, becsy aims to be feature rich without sacrificing too much performance.  The goal is to be 10x faster than ECSY when single-threaded, and faster than bitecs when multithreaded as long as the problem is parallelizable.  Here's a snapshot of current performance per [ecs-benchmark](https://github.com/noctjs/ecs-benchmark) -- obviously not quite there yet:

|     | packed_1 | packed_5 | simple_iter | frag_iter | entity_cycle | add_remove |
| --- | --: |--: |--: |--: |--: |--: |
| becsy | 12,405 op/s | 4,787 op/s | 1,773 op/s | 31,431 op/s | 1,466 op/s | 9,146 op/s |
| bitecs | 254,677 op/s | 239,702 op/s | 144,676 op/s | 473,416 op/s | 2,245 op/s | 4,670 op/s |
| ecsy | 6,254 op/s | 3,192 op/s | 2,212 op/s | 14,905 op/s | 18 op/s | 450 op/s |
