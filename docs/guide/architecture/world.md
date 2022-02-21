<language-switcher/>

# World

A world is basically a container for entities, components and systems, and you'll usually want to have exactly one in your application.  You create a world like so:

```js
const world = await World.create();
```
```ts
const world = await World.create();
```

You can then execute all the world's systems at any time by calling:
```js
await world.execute();  // use Becsy's built-in clock
await world.execute(time, delta);  // or control the clock yourself
```
```ts
await world.execute();  // use Becsy's built-in clock
await world.execute(time, delta);  // or control the clock yourself
```

You'll typically do this in some kind of loop, perhaps using `requestAnimationFrame` or one of the many game loop libraries out there.

## Options

The `create` method accepts an object with many options, the most important of which is `defs`: an arbitrarily nested array of [component](./components) and [system](./systems) types for the world to be aware of.  The order of items and nesting of arrays doesn't matter &mdash; specifically, it doesn't affect the order that systems are executed in whatsoever.  You can also follow each system type with an object to be assigned onto the system instance's properties.  If you defined any [system groups](./systems#groups) they should also be listed here, and will automatically add all their systems.

<div class="only-ts">

::: tip
You can usually omit `defs` altogether as any classes decorated with `@component` or `@system` will automatically be added to the `defs` of every world you create.
:::

</div>

Another important option is `maxEntities`, which specifies the maximum number of entities your world will be able to hold at one time.  It must be set up front and cannot be raised once a world has been created.  It's set to a reasonable default and you'll get an error advising you to raise it if you should exceed it.  (Note that deleted entities continue counting against the total for up to 2 frames until they're purged.)  There are also a number of other buffer sizing options that are defaulted based on the maximum number of entities, and where again an error will tell you if you need to raise their values.

## Creating entities

You may want to set up some initial entities to populate your world.  Normally you'd leave this up to your systems, but you can also do it directly here.  Note, however, that all your systems will have already been initialized by the time world-level entities are created.

The easiest way to create an entity is like so:
```js
world.createEntity(ComponentFoo, {foo: 'bar', baz: 42}, ComponentBar);
```
```ts
world.createEntity(ComponentFoo, {foo: 'bar', baz: 42}, ComponentBar);
```

This creates an entity that contains components of the given types.  Each type can also be followed by initial values to assign to the component's fields.

The method above *doesn't* return a handle to the entity created.  If you need that &mdash; for example to initialize some `ref` fields &mdash; then you should use the second form that gives you access to a fake system:
```js
world.build(sys => {
  const entity1 = sys.createEntity(ComponentFoo);
  sys.createEntity(ComponentBar, {fooRef: entity1});
});
```
```ts
world.build(sys => {
  const entity1 = sys.createEntity(ComponentFoo);
  sys.createEntity(ComponentBar, {fooRef: entity1});
});
```

::: warning
Be careful not to exfiltrate entity handles from the build block without first [calling `hold()`](./entities#holding-handles) on the entity.
:::

## Multiple worlds

While usually one world is enough sometimes you'll want more, in which case there's an important limitation to be aware of:  a single component type can only be used in one world at a time due to performance concerns.  (This doesn't apply to systems.)

The limitation doesn't apply in unit tests (`NODE_ENV=test`) as you'll often want one world per test there, and the worlds will never execute concurrently.

Outside of tests, if you need multiple consecutive worlds then calling `world.terminate()` will make all its component types available for the next world.  If, on the other hand, you want multiple worlds to gain control over which systems to execute when, keep reading!

## Partial execution

There are some more advanced use cases where you don't want every system to execute once in every frame.  For example, you may have different systems running in different scenes in your game, or you want to run your physics systems at a fixed time interval but sync the render systems to the screen's refresh.  Becsy caters for these scenarios in two ways.

### Start / stop

First, you can explicitly stop and restart systems like so:
```js
world.control({
  stop: [SystemA, systemGroupB],    // these systems will be stopped
  restart: [SystemC, systemGroupD]  // these systems will be started
});
```
```ts
world.control({
  stop: [SystemA, systemGroupB],    // these systems will be stopped
  restart: [SystemC, systemGroupD]  // these systems will be started
});
```

This will stop the given systems and restart others.  The effect is immediate unless you're in the middle of a frame, in which case it will take effect at the end of the frame.  You'll typically use custom [system groups](./systems#groups) as arguments here but you can actually pass in anything that the world `defs` accepts and irrelevant items will just be ignored.

Stopped systems will have nearly zero impact on frame latency.  However, restarting a system that has queries is a fairly slow operation so you don't want to be doing that too often.

### Custom executor

If you do need to control what systems execute on a frame-by-frame basis then you'll want the second option: create a custom executor.

```js
// First, create a new frame with all the groups you may want to execute
const frame = world.createCustomExecutor(physicsGroup, renderGroup);

async run() {
  // then later, in your game loop, you begin a new frame:
  await frame.begin();
  // execute any groups from the list above, any number of times:
  await frame.execute(physicsGroup);
  await frame.execute(physicsGroup, time, delta);  // optionally assume control of the clock
  await frame.execute(renderGroup);
  // and close out the frame:
  await frame.end();
}
```
```ts
// First, create a new frame with all the groups you may want to execute
const frame = world.createCustomExecutor(physicsGroup, renderGroup);

async run() {
  // then later, in your game loop, you begin a new frame:
  await frame.begin();
  // execute any groups from the list above, any number of times:
  await frame.execute(physicsGroup);
  await frame.execute(physicsGroup, time, delta);  // optionally assume control of the clock
  await frame.execute(renderGroup);
  // and close out the frame:
  await frame.end();
}
```

This approach is efficient, but beware: *every group in your custom executor must be executed regularly*, though not necessarily every frame.  The longer the interval between all groups being executed, the larger the world's buffer requirements and the higher the latency when you do finally execute a group.
