<language-switcher/>

# Queries

A query is a set of constraints to select entities based on the components they have.  Queries are always defined in systems at construction time.  It's not possible to run new ad-hoc queries once the world has been created.

A query is always updated with the entities that match the components' condition immediately before a system is executed.  The work needed to keep a query updated is proportional to the number of shape changes (component additions and removals) in the world rather than the total number of entities.

## Basic query syntax

Queries use a small domain-specific language to express their constraints and are assigned to system properties at construction time:

```ts
@system class SystemA extends System {
  // Query for all entities with an Enemy component but no Dead component.
  private activeEnemies = this.query(
    q => q.current.with(Enemy).and.withAny(stateEnum).but.without(Dead));

  execute(): void {
    for (const entity of this.activeEnemies.current) {
      const enemy = entity.read(Enemy);  // guaranteed to have an Enemy component
    }
  }
}
```
```js
class SystemA extends System {
  constructor() {
    // Query for all entities with an Enemy component but no Dead component.
    this.activeEnemies = this.query(
      q => q.current.with(Enemy).and.withAny(stateEnum).but.without(Dead));
  }

  execute() {
    for (const entity of this.activeEnemies.current) {
      const enemy = entity.read(Enemy);  // guaranteed to have an Enemy component
    }
  }
}
```

First you specify that you want all `current` entities that satisfy the constraints; we'll introduce other options [later](#reactive-queries).  Then you constrain what component types an entity must and must not have to satisfy the query:
- an entity must have all the components listed in `with` clauses;
- an entity must have at least one of the component listed in *each* `withAny` clause;
- an entity must not have any of the components listed in `without` clauses.

Each clause can list any number of component types.  Enum types and [enums](components#component-enums) can be used in most of the clauses, but check the API docs as some combinations cannot be evaluated efficiently.

The query object will have a `current` property that's an array of entities you can iterate over in your `execute` hook.

::: tip
Queries are only updated between system executions so you don't need to worry about accidentally mutating the entity array while you're iterating over it by adding or removing components.
:::

## Declaring entitlements

Query definitions also have a secondary function:  they declare what component types the system will be reading, writing, creating and updating.  These declarations are not query-specific &mdash; the entitlements from all of a system's queries are combined together and applied to the system &mdash; but it's a convenient place to express them as you'll often need to read and write the component types that your queries are constrained on.

You can only read, write, create and update component types for which you declared entitlements, otherwise you'll get an error.  Becsy also uses the entitlements to help [order system execution](./systems#execution-order) and determine which systems can safely run concurrently.

You declare entitlements by following any clause that mentions component types with a `read`, `write`, `create` or `update`:

```ts{4}
@system class Namer extends System {
  // Select all Players that don't have a Name component yet.
  private uninitializedPlayers =
    this.query(q => q.current.with(Player).but.without(Name).write);

  execute(): void {
    for (const player of this.uninitializedPlayers.current) {
      // Add a name to each player, which will also remove it from the query.
      player.add(Name, {value: getRandomName()});
    }
  }
}
```
```js{5}
class Namer extends System {
  constructor() {
    // Select all Players that don't have a Name component yet.
    this.uninitializedPlayers =
      this.query(q => q.current.with(Player).but.without(Name).write);
  }

  execute() {
    for (const player of this.uninitializedPlayers.current) {
      // Add a name to each player, which will also remove it from the query.
      // This is a typical "factory" pattern in ECS.
      player.add(Name, {value: getRandomName()});
    }
  }
}
```

Above, we declared that we'll be writing the `Name` component; adding and removing count as writing, as does calling `Entity.write`.  Any `with` or `without` component types are automatically marked as `read` so you don't need to say it explicitly (but it's allowed).  If you want to declare an entitlement for a component type not used as a query constraint you can employ the `using` clause, which doesn't affect the query in any way, only supplies component types for entitlement suffixes:  `this.query(q => q.using(RandomComponent).write)`.

::: tip
`write` implicitly includes `read`, `create` and `update`, so you don't need to declare those separately.  `read` and `write` also grant you access to the `has` family of methods, but `create` and `update` do not, as a trade-off for being able to run concurrently.
:::

## Reactive queries

Using reactive queries make it possible to react to changes on entities and its components.

::: tip
A single query can include any or all of the various lists described below (each of which will be iterable separately), and this is more efficient than creating separate queries for them.
:::

### Added and removed entities

One common use case is to detect whenever an entity has been added or removed from a query:

```ts
@system class SystemA extends System {
  // Query for entities that either became a Box with a Transform, or stopped being one.
  private boxes = this.query(q => q.added.and.removed.with(Box, Transform));

  execute(): void {
    for (const addedBox of this.boxes.added) { /* ... */ }
    for (const removedbox of this.boxes.removed) { /* ... */ }
  }
}
```
```js
class SystemA extends System {
  constructor() {
    // Query for entities that either became a Box with a Transform, or stopped being one.
    this.boxes = this.query(q => q.added.and.removed.with(Box, Transform));
  }

  execute() {
    for (const addedBox of this.boxes.added) { /* ... */ }
    for (const removedbox of this.boxes.removed) { /* ... */ }
  }
}
```

The `added` and `removed` lists are computed just before the system executes, and will include all entities that would have been added to or removed from the `current` list since the system last executed (usually the previous frame).

::: tip
If an entity was both added and then removed between system executions, it will *not* be included in the `added` list.  (And similarly for the `removed` list.)  There's currently no way to query for such ephemeral entities in Becsy.
:::

### Changed entities

Another common use case is to detect when a component's field values have been changed, whether due to a call to `Entity.write` or because the field's value was [automatically updated](./components#referencing-entities):

```ts
// Get entities with Box and Transform, where Transform fields changed since last time.
this.query(q => q.changed.with(Box).and.with(Transform).trackWrites);
```
```js
// Get entities with Box and Transform, where Transform fields changed since last time.
this.query(q => q.changed.with(Box).and.with(Transform).trackWrites);
```

We express the query as usual, but append `trackWrites` to any component types whose changes we want to track.  (You must track at least one component type.)  Note that when tracking specific enum component types, a write to another component in the same enum can sometimes trigger the query too.

Not all state changes are expressed by writes to a component's fields: sometimes, the combination of components matching a query encodes an implicit state instead.  This is especially common when using [component enums](./components#component-enums) but works with normal components too.  You mark `withAny` clauses with `trackMatches`, and they'll add entities to the `changed` list whenever set the set of components matching the `withAny` clause changes:

```ts
// Get entities with Menu, where their open/closed state changed since last time.
this.query(q => q.changed.with(Menu).and.withAny(Open, Closed).trackMatches);
```
```js
// Get entities with Menu, where their open/closed state changed since last time.
this.query(q => q.changed.with(Menu).and.withAny(Open, Closed).trackMatches);
```

You can mix `trackWrites` and `trackMatches` within a query but there's no way to tell which one caused an entity to become `changed`.

Newly added entities will *not* be included in the `changed` list, even if their fields were written to after the component was added.  Basically, an entity will be in at most one of the `added`, `removed`, and `changed` lists &mdash; they never overlap.  For convenience, you can request a list that combines any of these attributes instead:

```ts
// Get entities that became a Box with Transform, or whose Transform was changed.
this.query(q => q.addedOrChanged.with(Box).and.with(Transform).trackWrites);
```
```js
// Get entities that became a Box with Transform, or whose Transform was changed.
this.query(q => q.addedOrChanged.with(Box).and.with(Transform).trackWrites);
```

## Ordering query results

Query results are not guaranteed to be in any specific order by default, but you can request that they be sorted using any kind expression over their entities:

```ts
@system class Renderer extends System {
  // Query for all Sprites and order by ascending zIndex.
  private sprites = this.query(
    q => q.current.with(Sprite).orderBy(entity => entity.read(Sprite).zIndex)
  );

  execute(): void {
    // Iterate over all sprites in order of zIndex.
    for (const entity of this.sprites.current) {
      render(entity.read(Sprite));
    }
  }
}
```
```js
class Renderer extends System {
  constructor() {
    // Query for all Sprites and order by ascending zIndex.
    this.sprites = this.query(
      q => q.current.with(Sprite).orderBy(entity => entity.read(Sprite).zIndex)
    );
  }

  execute() {
    // Iterate over all sprites in order of zIndex.
    for (const entity of this.sprites.current) {
      render(entity.read(Sprite));
    }
  }
}
```

A common case is ordering entities by order of creation, for example to execute queued commands in the right order:

```ts
this.query(q => q.current.with(Command).write.orderBy(entity => entity.ordinal))
```
```js
this.query(q => q.current.with(Command).write.orderBy(entity => entity.ordinal))
```

Note that ordering entities can get expensive (though we apply some optimizations for common cases) so use this feature judiciously!
