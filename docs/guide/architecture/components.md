<language-switcher/>

# Components

A *component* is an object that can store data but should have no behavior (as that's handled by systems).  You'll typically have many instances of a component type, each held in an entity.  (Though sometimes you'll have [singletons](./systems#singleton-components).)

In Becsy, a component type is just a class with a default, empty constructor, and a schema that specifies the type of each field so that Becsy can allocate the right kind of storage:

```js
import {Type} from '@lastolivegames/becsy';

class ComponentA {
  static schema = {
    booleanValue: Type.boolean,
    integerValue: {type: Type.uint32, default: 10},
    stringValue: {type: Type.dynamicString(32)}
  };
}
```
```ts
import {component, field, Type} from '@lastolivegames/becsy';

@component class ComponentA {
  @field.boolean declare booleanValue: boolean;
  @field({type: Type.uint32, default: 10}) declare integerValue: number;
  @field.dynamicString(32) declare stringValue: string;
}
```

Each field in the schema represents one property on the component's instances, and can also be used to set default values.  Some component types are used just as tags and don't store any data, in which case your should omit the schema to enable some optimizations.

::: danger
You must only set the fields declared in your schema on component instances.  Any other properties will be dropped.
:::

::: tip
For components with a single field it might be tempting to name it the same as the component, but this leads to awkward code when accessing it later, e.g., `entity.read(Acceleration).acceleration`.  Instead, we recommend naming the sole field `value` so the code becomes `entity.read(Acceleration).value` instead.
:::

::: only-ts
The schema declared in the component somewhat duplicates the TypeScript property types, but it's necessary as Becsy uses primitive-valued array buffers that don't map cleanly to JavaScript values.  It's also important to use the `declare` keyword so that Becsy can take full control of the property definitions.

The `@component` decorator is optional; if included, it automatically adds the class to every world's `defs` list (as long as the module has been imported before the world is created, of course).
:::

While you should generally keep behavior out of components &mdash; lest you fall into an object-oriented architecture instead &mdash; we think it's fine and useful to, for example, define generic getters and setters on your component classes to assist with data wrangling.  This is especially the case if you're packing multiple values into a field using bit-level operations to lower your memory footprint.

::: warning
To interact with components in any way (add, read, write, remove), your systems need to declare [access entitlements](./queries#declaring-entitlements) in their queries.
:::

## Field types

::: only-js
Becsy makes available the following field types as static members on the `Type` class.  They're tightly integrated with the engine so it's not possible to add new ones in your app.
:::

::: only-ts
Becsy makes available the following field types as static members on the `Type` class, as well as on the `@field` decorator.  They're tightly integrated with the engine so it's not possible to add new ones in your app.
:::

Unless otherwise stated, the types are strict and don't accept `null` or `undefined` as values.

| Type <span style="float:right; font-weight: normal;">(default, JS type)</span> |
| --- |
| **`boolean`** <span style="float:right">(`false`, `boolean`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>A simple boolean type that accepts only `true` and `false` values. Each value occupies a full byte, though. |
| **`int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`** <span style="float:right; font-weight: normal;">(`0`, `number`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>Integer types of various bit sizes, both signed and unsigned (the latter with a `u` prefix). |
| **`float32`, `float64`** <span style="float:right; font-weight: normal;">(`0`, `number`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>Single and double precision floating point number types.  `float64` is equivalent to JavaScript's `number` type. |
| **`vector(type, elements, class?)`** <span style="float:right; font-weight: normal;">(`[0, 0, ...]`, `Array`)</span><br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>Fixed-length array of one of the numeric types above; see [below](#numeric-vectors) for details. |
| **`dynamicString(maxUtf8Length: number)`** <span style="float:right; font-weight: normal;">(`''`, `string`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>A string type that accepts any string value as long as it doesn't exceed the given maximum length when encoded with UTF-8. Useful for unpredictable strings such as usernames. |
| **`staticString(choices: string[])`** <span style="float:right; font-weight: normal;">(first choice, `string`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>A string type that can only be set to values from a preselected array of strings.  The value is stored as an integer index into the string array so it's very efficient, but you cannot add new string values at runtime. Useful for message strings built into your application. |
| **`object`** <span style="float:right; font-weight: normal;">( `undefined`, any)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>A type that can accept any JavaScript object as value, including `undefined` and `null`.  This should only be used for interfacing with other libraries as it can't be shared between threads and doesn't perform as well as the primitive types even on a single thread. |
| **`weakObject`** <span style="float:right; font-weight: normal;">(`undefined`, any)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>A weak reference to a JavaScript object that won't prevent it from being garbage collected.  It suffers from the same disadvantages as `object` above.  Values default to `undefined`, and automatically become `undefined` when the object is garbage collected. |
| **`ref`** <span style="float:right; font-weight: normal;">(`null`, `Entity`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>A unidirectional reference to a single entity or `null`; see [below](#referencing-entities) for details. |
| **`backrefs(type?, fieldName?, trackDeletedBackrefs?)`** <span style="float:right; font-weight: normal;">(`[]`, `Entity[]`)</span> <br><span style="display: inline-block; margin-top: 0.5em;">&#8203;</span>An automatically populated list of references to the entity that contains a component with this field; see [below](#referencing-entities) for details.  Fields with this type cannot be set by your application. |

## Numeric vectors

When you need a component to hold some numeric values of the same type, you can of course declare them as separate fields.  However, it often makes sense to treat them as a single, composite value, whether for better organization, for increased performance due to cache locality, or to fit in with a third party API.  In that case you can declare a vector field instead:

```ts
@component class MovingEntity {
  @field.float64.vector(3)
  declare position: [number, number, number] & {asTypedArray(): Float64Array};
  @field.float64.vector(3)
  declare velocity: [number, number, number] & {asTypedArray(): Float64Array};
}

world.build(sys => {
  const player = sys.createEntity(
    MovingEntity, {position: [10, 0, 10], velocity: [1.5, 0.2, 0.1]}
  );
  const mover = player.write(MovingEntity);
  for (let i = 0; i < move.position.length; i++) {
    move.position[i] += mover.velocity[i];
  }
});
```
```js
class MovingEntity {
  static schema = {
    position: Type.vector(Type.float64, 3),
    velocity: Type.vector(Type.float64, 3)
  };
}

world.build(sys => {
  const player = sys.createEntity(
    MovingEntity, {position: [10, 0, 10], velocity: [1.5, 0.2, 0.1]}
  );
  const mover = player.write(MovingEntity);
  for (let i = 0; i < mover.position.length; i++) {
    move.position[i] += mover.velocity[i];
  }
});
```

This declares two fields, each a vector of exactly three `float64` numbers.  A vector's number elements will be stored together compactly by Becsy, and the vector will appear as an array-like object with a `length` property and indexed accessors for its properties.  You can access the elements individually, and you can also assign an array of the correct length to the field, which will get its elements copied into the component.  You can even iterate over it with a `for..of` loop, but be careful: for better performance, a vector has a single iterator that will be reset for everyone each time you start iterating, and the iterator will only work for as long as the vector's entity handle remains valid itself.

::: warning
While a vector appears array-like, it is not an actual JavaScript array:  it has a fixed length, and lacks any of the usual `Array` methods.
:::

Additionally, a vector has an `asTypedArray()` method that returns a typed array view onto the underlying data, which can be useful with low-level APIs.  While this requires an allocation it doesn't actually copy any data around, so it's still pretty light-weight.

::: warning
You must only access the typed array while the corresponding entity handle is valid.  Furthermore, you must not write to a typed array obtained from a read-only handle (unfortunately, there's no way to enforce this prohibition but if you do you're into undefined behavior territory).
:::

For better readability, you can also name the vector's elements and access them that way:
```ts
@component class MovingEntity {
  @field.float64.vector(['x', 'y', 'z'])
  declare position: [number, number, number] & {x: number, y: number, z: number};
  @field.float64.vector(['x', 'y', 'z'])
  declare velocity: [number, number, number] & {x: number, y: number, z: number};
}

world.build(sys => {
  const player = sys.createEntity(
    MovingEntity, {position: [10, 0, 10], velocity: {x: 1.5, y: 0.2, z: 0.1}}
  );
  const mover = player.write(MovingEntity);
  mover.position[0] += mover.velocity.x;
  mover.position.x += mover.velocity[1];
  mover.position.z += mover.velocity.z;
});
```
```js
class MovingEntity {
  static schema = {
    position: Type.vector(Type.float64, ['x', 'y', 'z']),
    velocity: Type.vector(Type.float64, ['x', 'y', 'z'])
  };
}

world.build(sys => {
  const player = sys.createEntity(
    MovingEntity, {position: [10, 0, 10], velocity: {x: 1.5, y: 0.2, z: 0.1}}
  );
  const mover = player.write(MovingEntity);
  mover.position[0] += mover.velocity.x;
  mover.position.x += mover.velocity[1];
  mover.position.z += mover.velocity.z;
});
```

You can then access the elements interchangeably either by index or by name, and assign either an array or an object to the field, whichever's more convenient.

Finally, you can specify a custom class to use for the array-like value.  This can be useful if you're using a library that provides a vector-like abstract data type with useful methods that you'd like to be able to use directly on your Becsy data.  It differs from using `Type.object` because the data is still stored by Becsy in a multithreading-compatible fashion, and fungible instances of the custom class are used as a thin veneer on top.  To achieve this, the vector's array-like and named element properties are used to override the class's ones, which works well for simple ADTs but can break the host class in more complex cases &mdash; you won't know until you try.

::: tip
For convenience, you might also want to declare the field type once for reuse throughout your components.
:::

Here's a made-up example that incorporates all of the above:

```ts
class Vector3 {
  x: number;
  y: number;
  z: number;

  add(that: Vector3): void {
    this.x += that.x;
    this.y += that.y;
    this.z += that.z;
  }
}

const v3Type = Type.vector(Type.float64, ['x', 'y', 'z'], Vector3);

@component class MovingEntity {
  @field(v3Type) declare position: Vector3;
  @field(v3Type) declare velocity: Vector3;
}

world.build(sys => {
  const player = sys.createEntity(
    MovingEntity, {position: [10, 0, 10], velocity: [1.5, 0.2, 0.1]}
  );
  const mover = player.write(MovingEntity);
  mover.position.add(mover.velocity);
});
```
```js
class Vector3 {
  x: number;
  y: number;
  z: number;

  add(that: Vector3): void {
    this.x += that.x;
    this.y += that.y;
    this.z += that.z;
  }
}

const v3Type = Type.vector(Type.float64, ['x', 'y', 'z'], Vector3);

class MovingEntity {
  static schema = {
    position: v3Type,
    velocity: v3Type
  };
}

world.build(sys => {
  const player = sys.createEntity(
    MovingEntity, {position: [10, 0, 10], velocity: [1.5, 0.2, 0.1]}
  );
  const mover = player.write(MovingEntity);
  mover.position.add(mover.velocity);
});
```

## Referencing entities

Applications often need to establish relationships between entities, and Becsy caters for this need directly with `Type.ref` and `Type.backrefs` properties.

::: warning
You should never reference entities via their IDs or as `Entity` objects held in `Type.object` properties.
:::

A `Type.ref` field holds a reference to any other single entity, or `null` to indicate that it's empty.  It will automatically be nulled out if the target entity is deleted, though its previous value remains accessible via `System.accessRecentlyDeletedData` until the reference is overwritten or the deleted entity purged.

A `Type.backrefs` field automatically builds a list of references to the entity on which its component resides.  Becsy automatically processes reference changes and entity deletions to keep the list current and it cannot be modified manually.  The order of the entities in the list is arbitrary.

::: info
A system that modifies `ref` properties also needs `write` entitlements to all the component types with `backrefs` that might change automatically in response, as these are treated as implicit writes.
:::

A `backrefs` field can be configured in a few different ways:
- By default, with no parameters, all references to the entity will be included.  This is the cheapest option as Becsy needs to maintain such backrefs for itself anyway.
- If you specify a component type then only references from components of that type will be included.  This is the most expensive option as Becsy needs to allow for the possibility of multiple `ref` properties in a component pointing to the same entity.
- If you specify both a component type and the name of a `ref` field name in that component then only references from that field will be included.  This is more expensive than the default of all references but safer, as the `backrefs` won't pick up any other references that you might add later to your application. It's also cheaper than specifying just a component type.
- Finally, by default you cannot read `backrefs` properties when operating under `System.accessRecentlyDeletedData` conditions.  If you need to do that then pass an extra flag to the type constructor to track deleted backrefs, but be aware that this will effectively double the cost of the field.

The `backrefs` field type lets you build 1-*N* relationships where the *N* is unbounded.  For example, you could model an inventory this way:

```ts
@component class Packed {
  @field.ref declare holder: Entity;
}

@component class Inventory {
  @field.backrefs(Packed, 'holder') declare contents: Entity[];
}

world.build(sys => {
  const player = sys.createEntity(Inventory, Health, /* etc */);
  const potion = sys.createEntity(Potion, {healing: 200});
  const sword = sys.createEntity(Sword, {damage: 50});

  // Put both items in the player's inventory
  potion.add(Packed, {holder: player});
  sword.add(Packed, {holder: player});
  player.read(Inventory).contents;  // [potion, sword] in any order

  // Remove the sword from the inventory
  sword.remove(Packed);
  player.read(Inventory).contents;  // [potion]

  // Destroy the potion
  potion.delete();
  player.read(Inventory).contents;  // []
});
```
```js
class Packed {
  static schema = {
    holder: Type.ref
  };
}

class Inventory {
  static schema = {
    contents: Type.backrefs(Packed, 'holder')
  };
}

world.build(sys => {
  const player = sys.createEntity(Inventory, Health, /* etc */);
  const potion = sys.createEntity(Potion, {healing: 200});
  const sword = sys.createEntity(Sword, {damage: 50});

  // Put both items in the player's inventory
  potion.add(Packed, {holder: player});
  sword.add(Packed, {holder: player});
  player.read(Inventory).contents;  // [potion, sword] in any order

  // Remove the sword from the inventory
  sword.remove(Packed);
  player.read(Inventory).contents;  // [potion]

  // Destroy the potion
  potion.delete();
  player.read(Inventory).contents;  // []
});
```

To build an *N*-*N* relationship you'll need to reify the relationship itself as an entity to provide a level of indirection to the links.  Here's an example of a symmetric relationship:

```ts
@component class Friendship {
  @field.ref declare a: Entity;
  @field.ref declare b: Entity;
}

@component class Person {
  @field.backrefs(Friendship) declare friendships: Entity[];
}

world.build(sys => {
  const p1 = sys.createEntity(Person);
  const p2 = sys.createEntity(Person);
  const p3 = sys.createEntity(Person);

  // Set up some friendships
  const f1 = sys.createEntity(Friendship, {a: p1, b: p2});
  const f2 = sys.createEntity(Friendship, {a: p1, b: p3});
  p1.read(Person).friendships;  // [f1, f2] in any order
  p1.read(Person).friendships.map(f => f.a === p1 ? f.b : f.a);  // [p2, p3] in any order
})
```
```js
class Friendship {
  static schema = {
    a: Type.ref,
    b: Type.ref
  };
}

class Person {
  static schema = {
    friendships: Type.backrefs(Friendship)
  };
}


world.build(sys => {
  const p1 = sys.createEntity(Person);
  const p2 = sys.createEntity(Person);
  const p3 = sys.createEntity(Person);

  // Set up some friendships
  const f1 = sys.createEntity(Friendship, {a: p1, b: p2});
  const f2 = sys.createEntity(Friendship, {a: p1, b: p3});
  p1.read(Person).friendships;  // [f1, f2] in any order
  p1.read(Person).friendships.map(f => f.a === p1 ? f.b : f.a);  // [p2, p3] in any order
})
```

## Validating component combos

In the ECS paradigm every entity can have one component of each type.  However, not all component combinations will make sense in your application, and some might have deleterious effects on the systems processing them.  While in principle you could "just be careful" to not put together incompatible components that can be hard to do in practice as your application grows.

You can enlist Becsy's help in checking for invalid component combinations by defining a static `validate` method on any component type.  *All* such validation methods will be called on *all* entities that had component added or removed by a system, after that system has finished executing.  (So even though a validation method is defined on a specific component type for convenience, it can actually validate any components on all entities.)

::: info
Component validation is disabled in the [performance build](../deploying).
:::

Here's an example where we want to forbid combining component types `B` and `C` together if an entity also has a component of type `A`:
```ts
@component class A {
  static validate(entity: Entity): void {
    if (entity.has(A) && entity.hasAllOf(B, C)) {
      throw new Error('cannot combine both B and C with A');
    }
  }
}

@component class B {}
@component class C {}

world.build(sys => {
  const entity = sys.createEntity(A, B, C);
  // not an error yet -- we could still fix things by removing A, B or C
});
// but once the system finishes an error is thrown
```
```js
class A {
  static validate(entity: Entity): void {
    if (entity.has(A) && entity.hasAllOf(B, C)) {
      throw new Error('cannot combine both B and C with A');
    }
  }
}

class B {}
class C {}

world.build(sys => {
  const entity = sys.createEntity(A, B, C);
  // not an error yet -- we could still fix things by removing A, B or C
});
// but once the system finishes an error is thrown
```

A validation method can only check for the presence of components using the "`has`" family of methods on `Entity`.  It cannot `read` the entity to access the field values, so your component constraints cannot depend on data values.  Validators are also exempt from the system's access entitlements &mdash; they can check for the presence or absence of every type of component.

## Component enums

A very common restriction on component combinations is to allow at most one from a list of types to be present on an entity.  This is similar to "enums" in many programming languages and is often used to implement state machines.  Becsy supports this pattern directly and throws in a few extra features to boot.

You can define an enum and populate it with component types like so:
```js{4-5}
class A {}
class B {}
class C {}
// Define an enum of component types A, B, and C.
const myEnum = World.defineEnum('myEnum', A, B, C);
```
```ts
const myEnum = World.defineEnum('myEnum');
@component(myEnum) class A {}
@component(myEnum) class B {}
@component(myEnum) class C {}
```
::: only-ts
(You can also list the component types directly as part of the enum's definition instead.)
:::

Any component types can be members of an enum, including ones with data fields.  The enum name parameter is optional but will make any error message more useful.  Passing the enum or any one of its members into the world's `defs` will automatically pull in all the rest.

::: warning
A component type can be a member of at most one enum.
:::

In general, enum components are used just like normal ones, and the enum itself can be used to represent the list of its members in any API that deals with components.  The following chapters will also call out enum-specific features in each area.

## Storage strategies

Behind the scenes, rather than putting field values in properties of individual objects, Becsy stores them in contiguous, homogeneous buffers.  All the values for field `foo` of all components of type `A` are stored in one buffer, all the values for field `bar` in another, and so on.  There are different strategies for allocating and indexing these buffers that offer trade-offs between memory usage and performance.  (Note, though, that except for the `compact` storage strategy, performance differences only show up in the [performance build](../deploying)).

You can select a storage strategy per component type by filling in a static `options` object in the class.  For example:
```ts
@component class A {
  static options = {
    storage: 'packed',
    capacity: 1000
  }
}
```
```js
class A {
  static options = {
    storage: 'packed',
    capacity: 1000
  }
}
```

You can also set a default storage strategy for components that don't specify one by passing `defaultComponentStorage` to the `World.create` options.  The default default is `packed` (elastic).

The available strategies are as follows, in order from fastest and most memory hungry to slowest and smallest.

- **`sparse`**:  This strategy allocates storage for every possible entity up front, indexed directly by entity ID.  This is very fast as there's no indirect indexing step but can be extremely wasteful unless all or nearly all entities have a component of the given type.  (You cannot specify a `capacity` or an `initialCapacity` for this strategy.)

- **`packed`**:  This strategy allocates storage for a full index lookup table (up to 4 bytes for every possible entity), but uses smaller buffers for the actual field values.  If you know the maximum number of components of a given type you can set the value buffers to a fixed size using the `capacity` option.  If you don't know, the strategy defaults to an elastic variant that will grow the buffers as needed (though never shrink them).  You can set the `initialCapacity` of these elastic buffers, but note that they're slower than the fixed size ones even if they never actually get resized.

- **`compact`**: This strategy uses both a small index lookup table and smaller value buffers, but accessing a value requires a *linear* scan of the index so it's only recommended if you have no more than a handful of components of a given type.  Like the `packed` strategy there are both fixed size and elastic variants.  This strategy is automatically applied to any component types used as [singletons](./systems#singletons).

::: tip
When setting the storage `capacity` of a component type, remember to factor in that deleted entities [hang around for up to 2 frames](./entities#deleting) before they are purged.
:::
