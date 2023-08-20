<language-switcher/>
# Getting started

## ECS principles
Becsy is an Entity Component System (ECS) framework for web applications. The basic idea of this pattern is to move from defining application entities using a class hierarchy to using composition in a Data Oriented Programming paradigm. ([More info on wikipedia](https://en.wikipedia.org/wiki/Entity_component_system)). Structuring your application as an ECS can result in code that is more efficient and easier to extend over time.

Here's a short glossary of common ECS terms:
- [entities](architecture/entities): an object with a unique ID that can have multiple components attached to it.
- [components](architecture/components): different facets of an entity, e.g. geometry, physics, hit points. Data is only stored in components.
- [systems](architecture/systems): pieces of code that do the actual work within an application by processing entities and modifying their components.
- [queries](architecture/queries): used by systems to determine which entities they are interested in, based on the components attached to the entities.
- [world](architecture/world): a container for entities, components, systems and queries.

The usual workflow when building an ECS based program:
1. Create the *component* types that shape the data you need to use in your application.
2. Create *entities* and attach *components* to them.
3. Create the *systems* that will use these *components* to read and transform the data of *entities* selected by a *query*.
4. Execute all the *systems* each frame.

## Adding Becsy to your project
Becsy is published on `npm` under `@lastolivegames/becsy`.
```bash
npm install @lastolivegames/becsy
```

## Creating a world
A world is a container for entities, components and systems. Becsy supports just one world per process.

Let's start by creating our first world:
```ts
const world = await World.create();
```
```js
const world = await World.create();
```

## Defining components
Components are just objects that hold data.  We define them as behaviorless classes with some extra metadata about their properties.

```js
class Acceleration {
  static schema = {
    value: {type: Type.float64, default: 0.1}
  };
}

class Position {
  static schema = {
    x: {type: Type.float64},
    y: {type: Type.float64},
    z: {type: Type.float64}
  };
}
```
```ts
@component class Acceleration {
  @field({type: Type.float64, default: 0.1}) declare value: number;
}

@component class Position {
  @field.float64 declare x: number;
  @field.float64 declare y: number;
  @field.float64 declare z: number;
}
```

::: only-ts
The `@component` decorator will automatically register these component types with our world.  (Don't forget to add `"experimentalDecorators": true` to your `tsconfig.json`.)
:::

::: only-js
We also need to let the world know about our component types when creating it:

```js
const world = await World.create({defs: [Acceleration, Position]});
```
:::

[More information on how to define components types](architecture/components).

## Creating entities
Having our world created and some component types already defined, let's create [entities](architecture/entities) and attach new instances of these component types to them:
```js
world.createEntity(Position);
for (let i = 0; i < 10; i++) {
  world.createEntity(
    Acceleration,
    Position, {x: Math.random() * 10, y: Math.random() * 10, z: 0}
  );
}
```
```ts
world.createEntity(Position);
for (let i = 0; i < 10; i++) {
  world.createEntity(
    Acceleration,
    Position, {x: Math.random() * 10, y: Math.random() * 10, z: 0}
  );
}
```

With that, we have just created 11 entities: ten with the `Acceleration` and `Position` components, and one with just the `Position` component. Notice that the `Position` component is added using custom parameters. If we didn't use the parameters then the component would use the default values declared in the `Position` class or the fallback defaults (0, `null`, `false`, etc.).

[More information on creating and handling entities](architecture/entities).

## Creating a system
Now we are going to define [systems](architecture/systems) to process the components we just created. A system should extend the `System` class and can override a number of hook methods, though we'll only need `execute` to get started, which gets called on every frame.  We'll also need to declare [queries](architecture/queries) for entities we are interested in based on the components they own.

We will start by creating a system that will loop through all the entities that have a `Position` component (11 in our example) and log their positions.

```js
class PositionLogSystem extends System {
  // Define a query of entities that have the "Position" component.
  entities = this.query(q => q.current.with(Position));

  // This method will get called on every frame.
  execute() {
    // Iterate through all the entities on the query.
    for (const entity of this.entities.current) {
      // Access the component `Position` on the current entity.
      const pos = entity.read(Position);
      console.log(
        `Entity with ordinal ${entity.ordinal} has component ` +
        `Position={x: ${pos.x}, y: ${pos.y}, z: ${pos.z}}`
      );
    }
  }
}
```
```ts
@system class PositionLogSystem extends System {
  // Define a query of entities that have the "Position" component.
  entities = this.query(q => q.current.with(Position));

  // This method will get called on every frame.
  execute() {
    // Iterate through all the entities on the query.
    for (const entity of this.entities.current) {
      // Access the component `Position` on the current entity.
      const pos = entity.read(Position);
      console.log(
        `Entity with ordinal ${entity.ordinal} has component ` +
        `Position={x: ${pos.x}, y: ${pos.y}, z: ${pos.z}}`
      );
    }
  }
}
```

The next system moves each entity that has both a Position and an Acceleration.

```js
class MovableSystem extends System {
  // Define a query of entities that have "Acceleration" and "Position" components,
  // specifying that while we only need to read "Acceleration", we'll need to both
  // read and write "Position".
  entities = this.query(
    q => q.current.with(Acceleration).read.and.with(Position).write);

  // This method will get called on every frame by default.
  execute() {
    // Iterate through all the entities on the query.
    for (const entity of this.entities.current) {
      // Get the `Acceleration` component as read-only and extract its value.
      const acceleration = entity.read(Acceleration).value;

      // Get the `Position` component as read-write.
      const position = entity.write(Position);
      position.x += acceleration * this.delta;
      position.y += acceleration * this.delta;
      position.z += acceleration * this.delta;
    }
  }
}
```
```ts
@system class MovableSystem extends System {
  // Define a query of entities that have "Acceleration" and "Position" components,
  // specifying that while we only need to read "Acceleration", we'll need to both
  // read and write "Position".
  entities = this.query(
    q => q.current.with(Acceleration).read.and.with(Position).write);

  // This method will get called on every frame by default.
  execute() {
    // Iterate through all the entities on the query.
    for (const entity of this.entities.current) {
      // Get the `Acceleration` component as read-only and extract its value.
      const acceleration = entity.read(Acceleration).value;

      // Get the `Position` component as read-write.
      const position = entity.write(Position);
      position.x += acceleration * this.delta;
      position.y += acceleration * this.delta;
      position.z += acceleration * this.delta;
    }
  }
}
```

This system's query holds a list of entities that have both `Acceleration` and `Position`; 10 in total in our example.

Note that we are accessing components on an entity by calling:
- `read(Component)`: if the component will be used as read-only.
- `write(Component)`: if we plan to modify the values on the component.
And a query in the system must make the corresponding declarations for the components or the accesses will fail at runtime.

We could create an arbitrary number of queries if needed and process them in `execute`, for example:
```js
class SystemDemo extends System {
  boxes = this.query(q => q.current.with(Box));
  balls = this.query(q => q.current.with(Ball));

  execute() {
    for (const entity of this.boxes.current) { /* do things with box-like entity */ }
    for (const entity of this.balls.current) { /* do things with ball-like entity */ }
  }
}
```
```ts
@system class SystemDemo extends System {
  boxes = this.query(q => q.current.with(Box));
  balls = this.query(q => q.current.with(Ball));

  execute() {
    for (const entity of this.boxes.current) { /* do things with box-like entity */ }
    for (const entity of this.balls.current) { /* do things with ball-like entity */ }
  }
}
```

::: only-js
Just like for component definitions, we'll need to let our world know about these systems:

```js
const world = await World.create({
  defs: [Acceleration, Position, PositionLogSystem, MovableSystem]
});
```
:::

More information on [systems](architecture/systems) and [queries](architecture/queries).

## Running the systems
Now you just need to invoke `world.execute()` per frame. Currently Becsy doesn't provide a default scheduler, so you must do it yourself:
```js
async function run() {
  // Run all the systems
  await world.execute();
  requestAnimationFrame(run);
}

run();
```
```ts
async function run() {
  // Run all the systems
  await world.execute();
  requestAnimationFrame(run);
}

run();
```

## Putting everything together
```js
import {System, Type, World} from '@lastolivegames/becsy';

class Acceleration {
  static schema = {
    value: {type: Type.float64, default: 0.1}
  };
}

class Position {
  static schema = {
    x: {type: Type.float64},
    y: {type: Type.float64},
    z: {type: Type.float64}
  };
}

class PositionLogSystem extends System {
  entities = this.query(q => q.current.with(Position));

  execute() {
    for (const entity of this.entities.current) {
      const pos = entity.read(Position);
      console.log(
        `Entity with ordinal ${entity.ordinal} has component ` +
        `Position={x: ${pos.x}, y: ${pos.y}, z: ${pos.z}}`
      );
    }
  }
}

class MovableSystem extends System {
  entities = this.query(
    q => q.current.with(Acceleration).read.and.with(Position).write);

  execute() {
    for (const entity of this.entities.current) {
      const acceleration = entity.read(Acceleration).value;
      const position = entity.write(Position);
      position.x += acceleration * this.delta;
      position.y += acceleration * this.delta;
      position.z += acceleration * this.delta;
    }
  }
}

const world = await World.create({
  defs: [Acceleration, Position, PositionLogSystem, MovableSystem]
});


world.createEntity(Position);
for (let i = 0; i < 10; i++) {
  world.createEntity(
    Acceleration,
    Position, {x: Math.random() * 10, y: Math.random() * 10, z: 0}
  );
}

async function run() {
  await world.execute();
  requestAnimationFrame(run);
}

run();
```
```ts
import {component, field, system, System, Type, World} from '@lastolivegames/becsy';

@component class Acceleration {
  @field({type: Type.float64, default: 0.1}) declare value: number;
}

@component class Position {
  @field.float64 declare x: number;
  @field.float64 declare y: number;
  @field.float64 declare z: number;
}

@system class PositionLogSystem extends System {
  entities = this.query(q => q.current.with(Position));

  execute() {
    for (const entity of this.entities.current) {
      const pos = entity.read(Position);
      console.log(
        `Entity with ordinal ${entity.ordinal} has component ` +
        `Position={x: ${pos.x}, y: ${pos.y}, z: ${pos.z}}`
      );
    }
  }
}

@system class MovableSystem extends System {
  entities = this.query(
    q => q.current.with(Acceleration).read.and.with(Position).write);

  execute() {
    for (const entity of this.entities.current) {
      const acceleration = entity.read(Acceleration).value;
      const position = entity.write(Position);
      position.x += acceleration * this.delta;
      position.y += acceleration * this.delta;
      position.z += acceleration * this.delta;
    }
  }
}

const world = await World.create();

world.createEntity(Position);
for (let i = 0; i < 10; i++) {
  world.createEntity(
    Acceleration,
    Position, {x: Math.random() * 10, y: Math.random() * 10, z: 0}
  );
}

async function run() {
  await world.execute();
  requestAnimationFrame(run);
}

run();
```


## What's next?
This was a quick overview on how things are structured using Becsy, but we encourage you to read the [architecture documentation](architecture/overview) for more detailed information.  You may also want to dig into some [more examples](./examples/overview) or drop by our [Discord channel](https://discord.gg/X72ct6hZSr) and say hi!
