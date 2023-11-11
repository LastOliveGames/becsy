/* eslint-env browser */
import {System, Type, World} from '@lastolivegames/becsy';

// Component types are declared as classes and don't need to inherit from anything in particular.
class Position {
  // Each property needs a low level backing field type, as Becsy uses raw array buffers to share
  // data between workers (threads) rather than using objects to represent components.  You declare
  // these in a static schema property.
  static schema = {
    x: Type.float64,
    y: Type.float64
  };
}

class Velocity {
  // Velocity is also a two floats vector just like Position, but we nonetheless define it as a
  // separate component type.  Since an entity can have at most one instance of any given component
  // type this will allow an entity to have both a Velocity and a Position.  We could reuse property
  // names but prefer not to, as it will make code clearer later on.
  static schema = {
    vx: Type.float64,
    vy: Type.float64
  };
}

class DOMRenderable {
  // We'll need a reference to the DOM node we set up in the HTML file in order to manipulate it
  // later on.
  static schema = {
    node: Type.object
  };
}

// Systems are declared as classes that extend `System`.
class VelocityInputController extends System {
  // Every system can define any number of queries whose results will be available in the `execute`
  // method.  In this case, we're asking for all entities that currently have a Velocity component,
  // and declare that we'll be writing to those components.
  movables = this.query(q => q.current.with(Velocity).write);

  // Here we'll store all keys that are currently pressed.  This is not specific to ECS but it's a
  // common pattern to glue together event-driven (DOM) and timing-driven (ECS) processes.
  keysPressed = new Set();

  // Every system can provide an `initialize` method that will be called once as the world is being
  // set up.  We'll use it to register our DOM event handlers.
  initialize() {
    document.addEventListener('keydown', event => {
      this.keysPressed.add(event.key);  // add the pressed key to our set
    });

    document.addEventListener('keyup', event => {
      this.keysPressed.delete(event.key);  // remove the released key from our set
    });
  }

  // Every system can (and probably should) provide an `execute` method that implements its logic.
  // It will be invoked once per frame in our demo, so at 60fps it's called 60 times per second.
  execute() {
    // We loop through the query results of the movables query we defined above.
    for (const movable of this.movables.current) {
      // This is how we access the data stored in the Velocity component of our movable entity.
      // We must specify whether we intend to only `read` the data or also to `write` it.  We'll
      // only be allowed to `write` to component types that we reserved as such in our queries.
      const velocity = movable.write(Velocity);

      if (this.keysPressed.has('ArrowUp')) velocity.vy = -100;  // in pixels per second
      else if (this.keysPressed.has('ArrowDown')) velocity.vy = 100;
      else velocity.vy = 0;

      if (this.keysPressed.has('ArrowLeft')) velocity.vx = -100;
      else if (this.keysPressed.has('ArrowRight')) velocity.vx = 100;
      else velocity.vx = 0;
    }
  }
}

class Movement extends System {
  // In this query we're looking for every entity with both a `Position` and a `Velocity` component,
  // but while we declare that we'll be writing to `Position` we'll only be reading from `Velocity`.
  // Reading from `Velocity` will automatically make this system run after `VelocityInputController`
  // which writes it, and writing to `Position` will put it before the `Renderer` which reads it.
  // The order that systems are declared in doesn't matter.
  movables = this.query(q => q.current.with(Velocity).and.with(Position).write);

  execute() {
    for (const movable of this.movables.current) {
      // We retrive both velocity (to read) and position (to write) from our entities.
      const velocity = movable.read(Velocity);
      const position = movable.write(Position);
      // In the execute method, a system has access to `this.delta`, which is the delta time between
      // the current frame and the previous one.  This allows us to calculate a stable movement
      // regardless of the intervals between our frames.  For more on that see
      // https://drewcampbell92.medium.com/understanding-delta-time-b53bf4781a03.
      position.x += this.delta * velocity.vx;
      position.y += this.delta * velocity.vy;
    }
  }
}

class Renderer extends System {
  // This system will render any entity that has both a Position and a DOMRenderable component, and
  // that is new or whose position changed since the last frame. Note that we don't need to declare
  // DOMRenderable as writable since we'll be modifying the DOM element's properties rather than
  // updating the component's fields, and Becsy doesn't track that.
  renderables =
    this.query(q => q.addedOrChanged.with(DOMRenderable).and.with(Position).trackWrites);

  execute() {
    for (const renderable of this.renderables.addedOrChanged) {
      const {x, y} = renderable.read(Position);
      const {node} = renderable.read(DOMRenderable);
      // Sync the node's position from the entity by setting its style.
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    }
  }
}

// We can now create the world that all our entities and their components will live in.  We list
// every component and system class in the `defs` option, in any order.
const world = await World.create({
  defs: [Position, Velocity, DOMRenderable, VelocityInputController, Movement, Renderer]
});

// Now we create the entity that will represent our object and add the components it will need.
// Each component type can be optionally followed by an object with initial field values.
world.createEntity(Position, Velocity, DOMRenderable, {node: document.getElementById('object')});

// Finally, we set up our game loop.  The `run` function will be executed once per frame.
async function run() {
  // Execute the world, which will call the `execute` method of all systems in sequence.  The call
  // is asynchronous and we _must_ await its result, otherwise errors won't be reported properly.
  await world.execute();
  // Continue the loop on the next animation frame.
  requestAnimationFrame(run);
}
// Kick things off with our first frame!
requestAnimationFrame(run);
