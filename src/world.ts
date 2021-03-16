import type {ComponentType} from './component';
import {Entities, Entity} from './entity';
import {Indexer} from './indexer';
import {System, Systems, SystemType} from './system';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


class BuildSystem extends System {
  execute(delta: number, time: number): void {
    // do nothing
  }
}


type ComponentTypesArray = ComponentType<any>[] | ComponentTypesArray[];
type SystemsArray = (System | SystemType)[] | SystemsArray[];

interface WorldOptions {
  maxEntities?: number;
  maxRefs?: number;
  componentTypes: ComponentTypesArray;
  systems: SystemsArray;
}


export class World {
  private readonly indexer;
  private readonly entities;
  private readonly systems;
  private lastTime = now() / 1000;
  private buildSystem: System;

  constructor({maxEntities = 10000, maxRefs = 10000, componentTypes, systems}: WorldOptions) {
    this.indexer = new Indexer(maxRefs);
    this.entities = new Entities(maxEntities + 1, componentTypes.flat(Infinity));
    this.buildSystem = this.configureBuildSystem();
    this.systems =
      new Systems([this.buildSystem, systems].flat(Infinity), this.entities, this.indexer);
  }

  private configureBuildSystem(): BuildSystem {
    const mask = new Array(Math.ceil(this.entities.numComponents / 32));
    mask.fill(0xffffffff);
    const system = new BuildSystem();
    system.__readMask = system.__writeMask = mask;
    return system;
  }

  build(callback: (createEntity: () => Entity) => void | Promise<void>): void | Promise<void> {
    const result = callback(() => this.buildSystem.createEntity());
    if (result && result.then) return result.then(() => {this.buildSystem.__releaseEntities();});
    this.buildSystem.__releaseEntities();
  }

  createEntity(...initialComponents: (ComponentType<any> | any)[]): void {
    this.entities.createEntity(initialComponents).__release();
  }

  execute(time?: number, delta?: number): void {
    if (!time) time = now() / 1000;
    if (!delta) delta = time - this.lastTime;
    this.lastTime = time;
    this.entities.cycle();
    this.systems.execute(time, delta);
  }
}
