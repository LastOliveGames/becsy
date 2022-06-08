<language-switcher/>

# Systems

Systems are used to transform data stored on the components. Usually each system defines one or more [queries](./queries) of entities and iterates through these lists once per frame to create, remove or modify entities and components.

![Wolves and dragons](https://ecsy.io/docs/manual/images/systems.svg)

## Defining systems

Each system is defined as a class with a public default constructor that extends `System`:

```ts
@system class MySystem extends System {
  execute(): void {
    // do some work here
  }
}
```
```js
class MySystem extends System {
  execute(): void {
    // do some work here
  }
}
```

::: only-ts
The optional `@system` decorator will automatically register the system with the world when you create it.  If you omit the decorator then you'll need to include the system class in the [world's `defs`](./world#options) one way or another.
:::

::: only-js
To make the world aware of your system so it'll be excuted, you'll need to include the system class in the [world's `defs`](./world#options) one way or another.
:::

While your constructors can't take any arguments, if you pass a system into `defs` you can optionally include values for any custom properties you'd like to initialize:
```ts
const world = World.create({defs: [
  AnotherSystem,
  MySystem, {defaultSpeed: 100, message: 'too fast!'},
]});
```
```js
const world = World.create({defs: [
  AnotherSystem,
  MySystem, {defaultSpeed: 100, message: 'too fast!'}
]});
```

You can't remove a system from the world but there are ways to [control which systems are executed](./world#partial-execution).

## System lifecycle

When the world is created it will instantiate a copy of every system.  The only work you should do in your constructor is to define the system's [schedule](#execution-order), create the [queries](./queries) it needs, and declare any [attachments](#attached-systems) and [singletons](#singletons).

::: warning
In multi-threading scenarios a system may be instantiated more than once so don't do anything that has side-effects in the constructor.
:::

A system will then go through a lifecycle over the lifetime of the world, that you can hook into by overriding any of the following methods:
```ts
@system class MySystem extends System {
  async prepare(): Promise<void> {}
  initialize(): void {}
  execute(): void {}
  finalize(): void {}
}
```
```js
class MySystem extends System {
  prepare() {}  // returns a promise
  initialize() {}
  execute() {}
  finalize() {}
}
```

First, the world will apply any [attachment](#attached-systems) and [singleton](#singletons) directives, so those will be available in all the hooks.

The world will then invoke `prepare`, which is the only `async` hook and can be used for loading external data or setting up some external context.  You should save any results you'll need later in your own properties on the system instance.  In this phase the system cannot yet create or access entities.

After that comes `initialize`.  This is a synchronous hook and can be used to initialize the system and its own little corner of the world.  This is usually where you'll seed the world with initial entities, add event listeners, etc.  Queries are not yet accessible in this phase.

For the bulk of the system's life, every time the world is executed ([usually](./world#partial-execution) once per frame) it will invoke `execute` on the system.  This is where you iterate over the results of [queries](./queries), create entities, mutate components, drive external systems (such as a renderer), etc.  If your computation is time-dependent you can use the current time and delta since the last frame:

```ts{5-6}
@system class MySystem extends System {
  execute(): void {
    const speed = this.player.read(Speed);
    const position = this.player.write(Position);
    position.value += speed.value * this.delta;
    position.lastUpdated = this.time;
  }
}
```
```js{5-6}
class MySystem extends System {
  execute(): void {
    const speed = this.player.read(Speed);
    const position = this.player.write(Position);
    position.value += speed.value * this.delta;
    position.lastUpdated = this.time;
  }
}
```

The time and delta are computed automatically by default but you can override them with your preferred values when calling `world.execute`.

Finally, if you explicitly terminate the world, `finalize` will be called.  This is useful for disentangling yourself from any external systems, e.g. by removing listeners.  There's no point in deleting entities here since the world is about to be destroyed anyway.

## Execution order

What order will your systems be executed in?  In principle, it doesn't matter, since if one system makes a change that a preceding system needs it'll just have to wait until the next frame to act on it.  The computation continually converges towards a point where every system has seen every relevant change.

In practice, though, this would lead to unacceptable latency in propagating changes through your systems, so we want to order their execution such that all changes are fully processed in a single frame whenever possible.  In other ECS libraries this is typically done by registering the systems in the desired order of execution or by setting system priorities.  We take a different approach.

Becsy lets you declare a partial order on your systems through powerful precedence directives, leading to an acyclic graph of systems that can be automatically linearized for single-threaded execution.  This is more complex than explicitly specifying the exact order but it allows for efficient mapping onto multi-threaded execution, and also lets you integrate third party system packages without needing to understand their internal ordering constraints.

Each system can specify its ordering constraints via a schedule builder:

```ts
@system(
  s => s.before(SystemB).afterWritesTo(ComponentFoo).inAnyOrderWith(physicsSystems)
) class SystemA extends System {}
```
```js
class SystemA extends System {
  constructor() {
    this.schedule(
      s => s.before(SystemB).afterWritesTo(ComponentFoo).inAnyOrderWith(physicsSystems)
    );
  }
}
```

::: only-ts
(If needed, you can call `this.schedule` from your constructor instead.)
:::

The scheduling constraints apply pairwise to the subject system and all other systems listed in the constraint.  More specific constraints override less specific ones on a per-system-pair basis.  Here's a list of the supported constraint clauses from most to least specific:

| Constraints | Effect |
| ----------- | ------ |
| `before`, `after` | Forces the system to execute any time (not necessarily immediately) before or after the given systems.  This is the strongest constraint. |
| `inAnyOrderWith` | Negates all less specific constraints, allowing the system to execute in any order with the given ones.  Doesn't affect ordering between the given systems, though. |
| `beforeReadersOf`, `afterReadersOf`, `beforeWritersOf`, `afterWritersOf` | Specifies that the system should execute before or after all other systems that read or write components of the given types. |
| `inAnyOrderWithReadersOf`, `inAnyOrderWithWritersOf` | Negates all automatically formed constraints, allowing the system to execute in any order with systems that read or write components of the given types. This is useful for resolving spurious ordering conflicts caused by overlapping entitlements. |
| system entitlements | [System entitlements](./queries#declaring-entitlements) to read or write certain component types are used to automatically form a basic layer of constraints, such that all systems that read a component execute after all systems that write it. |

To give a concrete example, consider the following schedule and entitlement declarations:
```ts
@system(s => s.after(C))
class A extends System {
  entities = this.query(q => q.using(Foo).read);
}

@system
class B extends System {
  entities = this.query(q => q.using(Foo).write);
}

@system
class C extends System {
  entities = this.query(q => q.using(Bar).write.using(Foo).read);
}

@system(s => s.afterReadersOf(Foo))
class D extends System {
}

@system(s => s.inAnyOrderWith(B))
class E extends System {
  entities = this.query(q => q.using(Foo).write);
}
```
```js
class A extends System {
  constructor() {
    this.schedule(s => s.after(C));
    this.entities = this.query(q => q.using(Foo).read);
}

class B extends System {
  constructor() {
    this.entities = this.query(q => q.using(Foo).write);
  }
}

class C extends System {
  constructor() {
    this.entities = this.query(q => q.using(Bar).write.using(Foo).read);
  }
}

class D extends System {
  constructor() {
    this.schedule(s => s.beforeReadersOf(Foo));
  }
}

class E extends System {
  constructor() {
    this.schedule(s => s.inAnyOrderWith(B));
    this.entities = this.query(q => q.using(Foo).write);
  }
}
```

These will form a precedence graph like this one:
```
B -\   /--> D
    |-|
E -/   \--> C ----> A
```

If the constraints lead to a cycle in the system precedence graph &mdash; for example, because `SystemA` wants to run before `SystemB` which itself wants to run before `SystemA` &mdash; then creating the world will fail with an informative error and you'll need to fix the constraints so as to remove the cycle.

::: info
Note that every write entitlement implies a read entitlement for that system, so if you have multiple systems with a write entitlement for a component this will form a precedence cycle that you'll need to resolve with a more specific constraint.
:::

The execution order applies to all lifecycle methods.

## Grouping systems

Sometimes you want to deal with systems in bulk, such as when deciding which [systems get executed](./world#partial-execution) or setting execution order constraints.  To make this easier you can create system groups:

```ts
const myGroup = System.group(SystemA, SystemB);
// --- or ---
const myGroup = System.group();
@system(myGroup) class SystemA extends System {}
@system(myGroup) class SystemB extends System {}
```
```js
const myGroup = System.group(SystemA, SystemB);
```

You can substitute groups in most places where a system type is expected and the operation will apply to all systems in the group.  The system group object also has its own `schedule` method that you can use to set constraints on all systems in the group.

```ts
@system(s => s.before(physicsGroup)) class InputManager extends System {}
physicsGroup.schedule(s => s.before(renderGroup));
```
```js
class InputManager extends System {
  constructor() {
    this.schedule(s => s.before(physicsGroup));
  }
}
physicsGroup.schedule(s => s.before(renderGroup));
```

::: only-ts
(You can specify both a group and a schedule in the `@system` decorator; the group comes first.)
:::

## Attaching systems

In the ECS paradigm system typically communicate with each other indirectly, by creating and destroying entities and components, which will update other systems' queries.  Sometimes, though, systems need to collaborate more closely, perhaps to share non-ECS data or to ensure that they're processing exactly the same query results.  For cases like these you can "attach" one system to another.

```ts{6}
@system class SystemA extends System {
  internalMap: Map<string, Entity>;
}

@system class SystemB extends System {
  private systemA = this.attach(SystemA);
  execute(): void {
    this.systemA.internalMap.get('foo');
  }
}
```
```js{9}
class SystemA extends System {
  constructor() {
    this.internalMap = new Map();
  }
}

class SystemB extends System {
  constructor() {
    this.systemA = this.attach(SystemA);
  }

  execute(): void {
    this.systemA.internalMap.get('foo');
  }
}
```

You must set the result of the `attach` method on a property of the system object, and it will become an instance of the designated system by the time your system starts its lifecycle.  (It will have a different value in the constructor, though, so don't use it there!)

::: danger
Properties holding attached systems must not be ES2022 private fields (the ones prefixed with `#`), but if you're using TypeScript it's fine if they're declared as `private`.
:::

It's fine for two systems to attach to each other and otherwise create attachment cycles.

::: warning
Attached systems will be forced into the same thread, limiting the potential for concurrency in your application.  Use this feature wisely!
:::

## Singleton components

While most component types are intended to be instantiated as components on multiple entities, some should have only one instance &mdash; for example, global settings or global state for a game.  To support this you could create an entity to hold the sole component instance and query for it in all the systems that need to reference it, but Becsy provides a shortcut.  In every system that needs to access the singleton just declare access to it like this:

```ts{6}
@component class Global {
  @field.uint8 declare state: number;
}

@system class SystemA extends System {
  private global = this.singleton.write(Global);
  execute(): void {
    this.global.state = 1;
  }
}
```
```js{9}
class Global {
  static schema = {
    state: Type.uint8
  };
}

class SystemA extends System {
  constructor() {
    this.global = this.singleton.write(Global);
  }

  execute() {
    this.global.state = 1;
  }
}
```

::: danger
Properties holding singletons must not be ES2022 private fields (the ones prefixed with `#`), but if you're using TypeScript it's fine if they're declared as `private`.
:::

You can declare a singleton with either `read` or `write` access and Becsy will automatically create an entity to hold it, add the component, set its storage strategy to `compact` with a capacity of 1, and return a handle that you can use throughout the system's lifecycle.  Naturally, once you declare a component type as a singleton you can no longer add it to your own entities.

One thing to watch out for is that any singletons declared with `write` access will track a change event every time the system executes, whether the system made any changes to the component's value or not.  If you have a `changed` query tracking a singleton component and the system doesn't actually update it every frame, you should instead move the `this.singleton.write` call into your `execute` method.  This will give you a writable handle and track changes only when you need it, though you'll need to explicitly claim a write entitlement to the component type and you'll still need to declare the singleton in the usual way in another system (with `this.singleton.read` in the constructor) to get it set up correctly.

::: warning
Keep in mind that any systems with write access to a singleton will not be able to run concurrently, just like with any other component type.
:::

## Coroutines

Sometimes the work a system needs to do in response to an event takes more than one frame &mdash; for example, an animation followed by adding one to a counter, or a delay before some effect is deactivated.  You can always keep track of the work's state in a component and perhaps use a separate dedicated system to handle progress, but this can split notionally sequential behaviors among many pieces of code and make them harder to understand.  In those cases you can consider using coroutines instead.

A coroutine is a flow of execution that's attached to a system but has its own call stack and context.  It can suspend its own execution to wait for some event to occur (e.g., wait for the next frame) then resume execution with the context intact.  Coroutines are also easy to cancel &mdash; including entire stacks of them! &mdash; so they work well for complex behaviors that may not run to conclusion.

Here's a simple example:

```ts
@system class IntroSlideshow extends System {
  private slide = this.singleton.write(Slide);

  initialize(): void {
    this.runSlideshow(1.5);  // start a coroutine
  }

  @co *runSlideshow(delay: number) {
    this.slide.value = 1;
    yield co.waitForSeconds(delay);  // suspend execution for delay seconds
    this.slide.value = 2;
    yield co.waitForFrames(2);       // subliminal slide! suspend for 2 frames
    this.slide.value = 3;
    yield co.waitForSeconds(delay);  // suspend execution for delay seconds
    this.slide.value = 0;  // all done
  }
}
```
```js
class IntroSlideshow extends System {
  private slide = this.singleton.write(Slide);

  initialize(): void {
    this.start(this.runSlideshow, 1.5);  // start a coroutine
  }

  *runSlideshow(delay: number) {
    this.slide.value = 1;
    yield co.waitForSeconds(delay);  // suspend execution for delay seconds
    this.slide.value = 2;
    yield co.waitForFrames(2);       // subliminal slide! suspend for 2 frames
    this.slide.value = 3;
    yield co.waitForSeconds(delay);  // suspend execution for delay seconds
    this.slide.value = 0;  // all done
  }
}
```

::: only-ts
Coroutines are declared as generator methods with the `@co` decorator.  You can invoke them directly from the system's lifecycle methods, or from other coroutines (in which case prefix the call with `yield` to wait for the coroutine to complete).
:::

::: only-js
Coroutines are declare as generator methods.  You use the `start` method to start one from a lifecycle method, or call them directly from other coroutines prefixed with `yield`.
:::

A system's running coroutines are executed each frame immediately after the call to `execute`, in the reverse order in which they were started.

The return value when starting a coroutine is a handle that has the cancellation API; you can also access it from inside a coroutine via `co`.  The handle is stable so you can hang on to it until the coroutine exits or is cancelled.

```ts{6-7,12}
@system class IdleStart extends System {
  // Query for activity components that will signal us to end the initial idle behavior.
  private activity = this.query(q => q.current.with(Activity));

  initialize(): void {
    // Start the idle behavior coroutine, and cancel once Activity entities appear.
    this.doIdle().cancelIf(() => this.activity.current.length);
  }

  @co *doIdle() {
    // ... do stuff ...
    if (someSpecialCondition) co.cancel();
  }
}
```
```js{8-9,14}
class IdleStart extends System {
  constructor() {
    // Query for activity components that will signal us to end the initial idle behavior.
    this.activity = this.query(q => q.current.with(Activity));
  }

  initialize(): void {
    // Start the idle behavior coroutine, and cancel once Activity entities appear.
    this.start(this.doIdle).cancelIf(() => this.activity.current.length);
  }

  *doIdle() {
    // ... do stuff ...
    if (someSpecialCondition) co.cancel();  // cancel immediately
  }
}
```

Pending cancellation conditions are evaluated every frame, before coroutines are resumed.

Finally, it's often the case that a system will need to kick off a coroutine for each entity in a query, so there's some special support for this use case.  You can set a coroutine's `scope`, so the coroutine will automatically be canceled if the entity is deleted, and gain access to more advanced cancellation conditions.

```ts{18-20}
@component class Zombie {
  @field.boolean declare dancing: boolean;
}

@system class DanceOrWalk extends System {
  private zombies = this.query(q => q.current.with(Zombie).write);

  execute(): void {
    for (const zombie of this.zombies.current) {
      const beDancing = Math.random() < 0.5;
      if (beDancing === zombie.dancing) continue;
      zombie.dancing = beDancing;
      if (beDancing) this.dance(zombie.hold()); else this.walk(zombie.hold());
    }
  }

  @co *dance(zombie: Entity) {
    co.scope(zombie);  // scope ourselves to our very own zombie
    co.cancelIfComponentMissing(Zombie);  // cancel if our zombie gets better
    co.cancelIfCoroutineStarted();  // cancel if our zombie starts another coroutine in this system
    while (true) {
      // ... dance zombie, dance!
      yield;
    }
  }

  @co *walk(zombie: Entity) {
    // ... as above
  }
}
```

```js{24-26}
class Zombie {
  static schema = {
    dancing: Type.boolean
  };
}

class DanceOrWalk extends System {
  private zombies = this.query(q => q.current.with(Zombie).write);

  execute() {
    for (const zombie of this.zombies.current) {
      const beDancing = Math.random() < 0.5;
      if (beDancing === zombie.dancing) continue;
      zombie.dancing = beDancing;
      if (beDancing) {
        this.start(this.dance, zombie.hold());
      } else {
        this.start(this.walk, zombie.hold());
      }
    }
  }

  *dance(zombie) {
    co.scope(zombie);  // scope ourselves to our very own zombie
    co.cancelIfComponentMissing(Zombie);  // cancel if our zombie gets better
    co.cancelIfCoroutineStarted();  // cancel if our zombie starts another coroutine in this system
    while (true) {
      // ... dance zombie, dance!
      yield;
    }
  }

  *walk(zombie) {
    // ... as above
  }
}
```
