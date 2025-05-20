---
sidebarDepth: 3
---

# What is Becsy?

Becsy is an Entity Component System (ECS) framework for TypeScript and JavaScript that makes it nearly effortless to write performant, multi-threaded code.  It's inspired by [ECSY](https://github.com/ecsyjs/ecsy) and [bitecs](https://github.com/NateTheGreatt/bitECS), and guided by [ideas from Flecs](https://ajmmertens.medium.com/why-vanilla-ecs-is-not-enough-d7ed4e3bebe5).


::: danger
Becsy is currently in 0.x status.  What's there is reasonably well tested but many features are still missing and you can expect frequent API changes.  Most importantly, **multi-threading is not yet implemented**.
:::

## Priorities

Becsy positions itself within the wider ecosystem of ECS frameworks with the following set of priorities:
1. Multi-threaded: all apps developed with Becsy can be effectively run on multiple threads with minimal or no modifications from their single-threaded version.  I believe that multi-threading is the only way to scale performance and that ECS is the ideal architecture for making multi-threading effortless and practical in JavaScript.
2. Ergonomic: the API is powerful, expressive, and safe, rather than minimal or low-level.  I believe that developers choose TypeScript / JavaScript because it's a high level language, where they can express ideas quickly and succinctly.  If they need to prioritize performance they'll pick a language and ECS implementation better suited to that objective.
3. Performant: the point above notwithstanding, Becsy does its best not to unnecessarily leave potential performance on the table.  I believe that a good ECS should be usable for more than just toy apps.

The priorities above are ordered from most to least important.  This means that I'll sacrifice ergonomics if required to support multi-threading, and accept decreased performance in favor of a better API.

## Features

From ECSY we take:<br>
:white_check_mark: a friendly object-oriented API for both JS and TS clients<br>
:white_check_mark: multiple queries per system<br>
:white_check_mark: reactive queries (rather than event callbacks)<br>
:white_check_mark: explicit mutation tracking<br>
:white_check_mark: references to native JS objects in components<br>
:white_check_mark: comprehensive docs<br>

From bitecs we take:<br>
:white_check_mark: extensive use of `ArrayBuffer` for performance<br>
:white_check_mark: a sparse array architecture<br>
:white_check_mark: Node and browser compatibility with no dependencies<br>

Then we add:<br>
:white_check_mark: a native TypeScript implementation<br>
:white_check_mark: selectable component storage strategies<br>
:white_check_mark: bidirectional entity references with strong referential integrity<br>
:white_check_mark: declarative system ordering based on data dependencies<br>
:white_check_mark: coroutines for more natural multi-stage workflows<br>
:white_check_mark: built-in support for representing state machines (per [Sander Mertens](https://ajmmertens.medium.com/why-storing-state-machines-in-ecs-is-a-bad-idea-742de7a18e59))<br>
:white_check_mark: weak references to native JS objects, for better integration with other frameworks<br>

Still to come:<br>
:white_large_square: multithreaded system execution<br>
:white_large_square: an optional but nicely integrated networked data replication system<br>

## Support

I'm actively supporting this package but it's not my primary job, so responses may take 24-48 hours and fixes up to 1-2 weeks (but usually much faster). Please open [issues](https://github.com/lastolivegames/becsy/issues) against the repo, and [join us on Discord](https://discord.gg/X72ct6hZSr) for help and fun discussions!

## Showcase

Here are some public creations that use Becsy:
- [Special Releases 2022](https://www.special-releases.com/)
- [Moyosa Spaces](https://moyosaspaces.com/)
- [Confluence whiteboards](https://www.atlassian.com/software/confluence/whiteboards)
- [Crayon Town](https://crayon.town/)
- [Scrolly Page](https://scrolly.page/)
- [Zines Forever](https://zinesforever.com/)

## Acknowledgements

Many thanks to Becsy's early users, who helped shape the feature set and API, and found tons of bugs!  Thanks to [ECSY](https://github.com/ecsyjs/ecsy) for the inspiration and their fine documentation, which served as the starting point for this site.  And thanks to [Kate Liu](https://www.instagram.com/lemonikate/) for the logo design!
