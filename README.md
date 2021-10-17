# Becsy

Becsy is a (soon to be) multi-threaded Entity Component System (ECS) for TypeScript and JavaScript. It's inspired by [ECSY](https://github.com/ecsyjs/ecsy) and [bitecs](https://github.com/NateTheGreatt/bitECS), and guided by [ideas from Flecs](https://ajmmertens.medium.com/why-vanilla-ecs-is-not-enough-d7ed4e3bebe5).

ECS is an architectural pattern where computation is defined as a list of systems operating on a set of entities, each of which consists of a dynamic set of pure data components.  Systems select the entities to process via means of persistent, efficient queries over the entities' component "shapes".

## Project priorities

Becsy positions itself within the wider ecosystem of ECS frameworks with the following set of priorities:
1. Multi-threaded: all apps developed with Becsy can be effectively run on multiple threads with minimal or no modifications from their single-threaded version.  I believe that multi-threading is the only way to scale performance and that ECS is the ideal architecture for making multi-threading effortless and practical in JavaScript.
2. Ergonomic: the API is powerful, expressive, and safe, rather than minimal or low-level.  I believe that developers choose TypeScript / JavaScript because it's a high level language, where they can express ideas quickly and succinctly.  If they need to prioritize performance they'll pick a language and ECS implementation better suited to that objective.
3. Performant: the point above notwithstanding, Becsy does its best not to unnecessarily leave potential performance on the table.  I believe that a good ECS should be usable for more than just toy apps.

The priorities above are ordered from most to least important.  This means that I'll sacrifice ergonomics if required to support multi-threading, and accept decreased performance in favor of a better API.

## Features

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
- [x] declarative system ordering based on data dependencies

Still to come:
- [ ] examples and docs
- [ ] multithreaded system execution
- [ ] coroutines for more natural multi-stage workflows
- [ ] built-in support for representing state machines (per [Sander Mertens](https://ajmmertens.medium.com/why-storing-state-machines-in-ecs-is-a-bad-idea-742de7a18e59))
- [ ] an optional but nicely integrated networked data replication system
