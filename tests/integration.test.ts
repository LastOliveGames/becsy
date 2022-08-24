import {field, System, Type, World} from '../src';

class Vector3 {
  constructor(public x: number = 0, public y: number = 0, public z: number = 0) {}

  asArray(): number[] {
    return [this.x, this.y, this.z];
  }
}

const Vector3Type = Type.vector(Type.float64, ['x', 'y', 'z'], Vector3);

class Transform {
  @field(Vector3Type) declare position: Vector3;
}

let output: string;

class TransformReporter extends System {
  entities = this.query(q => q.current.with(Transform));

  execute() {
    for (const entity of this.entities.current) {
      const {position} = entity.read(Transform);
      output += `${position.x},${position.y},${position.z};`;
    }
  }
}

beforeEach(() => {
  output = '';
});

describe('integration', () => {

  test('initialized entity values are available on first execution', async () => {
    const world = await World.create({defs: [Transform, TransformReporter]});
    world.createEntity(Transform, {position: new Vector3(1, 2, 3).asArray()});
    await world.execute();
    expect(output).toBe('1,2,3;');
  });

});
