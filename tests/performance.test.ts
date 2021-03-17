import {tagPool} from '../src/tag';
import {Component, config, prop, System, Type, World} from '../src';
import {profile} from '../src/profile';

config.DEBUG = false;

class A extends Component {
  @prop(Type.int32) declare value: number;
}

class B extends Component {
  static schema = {
    value: Type.int32
  };
}

class C extends Component {
  static schema = {
    value: Type.int32
  };
}

class D extends Component {
  static schema = {
    value: Type.int32
  };
}

class E extends Component {
  static schema = {
    value: Type.int32
  };
}

class ASystem extends System {
  entities = this.query(q => q.with(A).write);

  execute() {
    for (const entity of this.entities.all) {
      entity.write(A).value *= 2;
    }
  }
}

let world: World;

function setup(count: number) {
  world = new World({
    maxEntities: count,
    componentTypes: [A, B, C, D, E],
    systems: [ASystem]
  });

  for (let i = 0; i < count; i++) {
    world.createEntity(A, {value: 0}, B, {value: 0}, C, {value: 0}, D, {value: 0}, E, {value: 0});
  }
}

function run(count: number) {
  for (let i = 0; i < count; i++) world.execute();
  (world as any).entities.pool.logStats();
  tagPool.logStats();
  for (const controller of (world as any).entities.controllers.values()) {
    controller.pool.logStats();
  }
}

// await profile(async() => setup(5000));
setup(5000);
// await profile(async() => run(1000));
run(1000);
