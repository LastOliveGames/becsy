import type {Component, ComponentType} from './component';
import {Entities, Entity, EntityId} from './entity';
import {Indexer} from './indexer';
import {Pool} from './pool';
import type {System, SystemType} from './system';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


export class Tag {
  entityId: EntityId;
  offset: number;
  mutable: boolean;
  system?: System;
}


type ComponentTypesArray = ComponentType<any>[] | ComponentTypesArray[];
type SystemsArray = (System | SystemType)[] | SystemsArray[];

export interface WorldOptions {
  maxEntities?: number;
  maxRefs?: number;
  componentTypes: ComponentTypesArray;
  systems: SystemsArray;
}


export class Dispatcher {
  readonly indexer;
  readonly entities;
  readonly systems;
  private readonly pools: Pool<any>[] = [];
  private lastTime = now() / 1000;
  private executing: boolean;
  readonly tagPool = new Pool(Tag);
  readonly tagMap = new Map<Component, Tag>();


  constructor({maxEntities = 10000, maxRefs = 10000, componentTypes, systems}: WorldOptions) {
    this.indexer = new Indexer(maxRefs);
    this.entities = new Entities(maxEntities, componentTypes.flat(Infinity), this);
    this.systems = this.normalizeAndInitSystems(systems);
    this.addPool(this.tagPool);
  }

  private normalizeAndInitSystems(userSystems: SystemsArray): System[] {
    return userSystems.flat(Infinity).map((userSystem: System | SystemType) => {
      // eslint-disable-next-line new-cap
      const system = typeof userSystem === 'function' ? new userSystem() : userSystem;
      system.__init(this);
      return system;
    });
  }

  execute(time?: number, delta?: number): void {
    if (this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    if (!time) time = now() / 1000;
    if (!delta) delta = time - this.lastTime;
    this.lastTime = time;
    this.entities.step();
    for (const system of this.systems) {
      system.execute(time, delta);
      this.flush();
    }
    this.executing = false;
  }

  executeOne(system: System): void {
    if (this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    system.__init(this);
    system.execute(0, 0);
    this.flush();
    this.executing = false;
  }

  addPool(pool: Pool<any>): void {
    this.pools.push(pool);
  }

  flush(): void {
    for (const pool of this.pools) pool.reset();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[], system?: System): Entity {
    const entity = this.entities.createEntity(initialComponents, system);
    if (!this.executing) this.flush();
    return entity;
  }

  tag(component: Component, id: EntityId, offset: number, mutable: boolean, system?: System): void {
    const tag = this.tagPool.take();
    this.tagMap.set(component, tag);
    tag.entityId = id;
    tag.offset = offset;
    tag.mutable = mutable;
    tag.system = system;
  }
}
