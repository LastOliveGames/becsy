# Deploying

When you import from `@lastolivegames/becsy` you get the development version of Becsy.  It enforces all limitations and invariants and throws useful exceptions, but due to that it can be a bit slow.

For your production build you should consider importing from `@lastolivegames/becsy/perf` instead.  This package is fully API-compatible but excludes *all* safety checks, allowing framework code to run up to 20x faster in some cases!  You probably won't see the full speedup in your application since it won't do anything for your logic / computation code so you should definitely run your own benchmarks.

Most build systems let you substitute a different imported package at build time (e.g., [`@rollup/plugin-replace`](https://www.npmjs.com/package/@rollup/plugin-replace)) so you won't even need to edit your code.
