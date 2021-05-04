import {
  component, ComponentType, componentTypes, Entity, prop, Query, System, SystemType, Type, World,
} from '../src';


@component class A {
  @prop(Type.uint8) declare value: number;
  @prop(Type.ref) declare target: Entity;
}

@component class B {
  @prop(Type.uint8) declare value: number;
  @prop(Type.backrefs(A, 'target')) declare targeters: Entity[];
}


class DoubleBRefsFromA extends System {
  entities = this.query(q => q.all.with(A).and.using(B).write);
  execute() {
    for (const entity of this.entities.all) {
      const ref = entity.read(A).target;
      if (ref) ref.write(B).value *= 2;
    }
  }
}

class IncrementAReferringToB extends System {
  entities = this.query(q => q.all.with(B).and.using(A).write);
  execute() {
    for (const entity of this.entities.all) {
      for (const targeter of entity.read(B).targeters) {
        targeter.write(A).value += 1;
      }
    }
  }
}


let total: {[key: string]: number} = {a: 0, b: 0, c: 0};

class Count extends System {
  private readonly items: {[key: string]: {type: ComponentType<any>, query: Query}} = {
    a: {type: A, query: this.query(q => q.all.with(A))},
    b: {type: B, query: this.query(q => q.all.with(B))}
  };

  execute() {
    total = {a: 0, b: 0, c: 0};
    for (const key in this.items) {
      for (const entity of this.items[key].query.all) {
        total[key] += entity.read(this.items[key].type).value;
      }
    }
  }
}

function createWorld(...systems: SystemType[]): World {
  return new World({maxEntities: 100, defs: [componentTypes, systems, Count]});
}


describe('querying references', () => {

  test('follow refs', () => {
    const world = createWorld(DoubleBRefsFromA);
    world.build(sys => {
      sys.createEntity(B, {value: 5});
      const b = sys.createEntity(B, {value: 1});
      sys.createEntity(A, {target: b});
      sys.createEntity(A);
    });
    world.execute();
    expect(total.b).toBe(7);
  });

  test('single backref', () => {
    const world = createWorld(IncrementAReferringToB);
    world.build(sys => {
      sys.createEntity(B, {value: 5});
      const b = sys.createEntity(B, {value: 1});
      sys.createEntity(A, {target: b});
      sys.createEntity(A);
    });
    world.execute();
    expect(total.a).toBe(1);
  });

});
