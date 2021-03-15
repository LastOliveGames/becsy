import type {ComponentType} from './component';
import {Entities, Entity} from './entity';
import {System, Systems, SystemType} from './system';

type ComponentTypesArray = ComponentType<any>[] | ComponentTypesArray[];
type SystemsArray = (System | SystemType)[] | SystemsArray[];

interface WorldOptions {
  maxNumEntities: number;
  componentTypes: ComponentTypesArray;
  systems: SystemsArray;
}


export class World {
  private readonly entities;
  private readonly systems;
  private lastTime = now() / 1000;

  constructor({maxNumEntities: maxEntities = 10000, componentTypes, systems}: WorldOptions) {
    this.entities = new Entities(maxEntities + 1, componentTypes.flat(Infinity));
    this.systems = new Systems(systems.flat(Infinity), this.entities);
  }

  createEntity(callback: (entity: Entity) => void): void {
    return this.entities.createEntity(callback);
  }

  execute(time?: number, delta?: number): void {
    if (!time) time = now() / 1000;
    if (!delta) delta = time - this.lastTime;
    this.lastTime = time;
    this.entities.tick();
    this.systems.execute(delta, time);
  }
}


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);
