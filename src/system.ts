import type {ComponentType} from './component';
import type {Entities, Entity, EntityId} from './entity';
import type {Indexer} from './indexer';
import {MainQuery, MainQueryBuilder} from './query';


export interface SystemType {
  new(): System;
}


export abstract class System {
  __readMask: number[] = [];
  __writeMask: number[] = [];
  __systems: Systems;
  __borrowedEntities: Entity[] = [];
  private readonly queryBuilders: MainQueryBuilder[] = [];

  get name(): string {return this.constructor.name;}

  query(buildCallback: (q: MainQueryBuilder) => void): MainQuery {
    const query = new MainQuery(this);
    const builder = new MainQueryBuilder(buildCallback, query, this);
    this.queryBuilders.push(builder);
    return query;
  }

  createEntity(...initialComponents: (ComponentType<any> | any)[]): Entity {
    const entities = this.__systems.entities;
    const entity = entities.createEntity(initialComponents, this);
    this.__borrowedEntities.push(entity);
    return entity;
  }

  execute(time: number, delta: number): void {
    // do nothing by default
  }

  __init(systems: Systems): void {
    if (this.__systems) {
      throw new Error(`You can't reuse an instance of system ${this.name} in different worlds`);
    }
    this.__systems = systems;
    for (const builder of this.queryBuilders) builder.__build();
    this.queryBuilders.length = 0;
  }

  __bindAndBorrowEntity(id: EntityId): Entity {
    const entities = this.__systems.entities;
    const entity = entities.bind(id, this);
    this.__borrowedEntities.push(entity);
    return entity;
  }

  __releaseEntities(): void {
    const entities = this.__systems.entities;
    for (const entity of this.__borrowedEntities) {
      if (!entities.isAllocated(entity.__id)) {
        throw new Error('You must add at least one component to a newly created entity');
      }
      entity.__release();
    }
    this.__borrowedEntities.length = 0;
  }
}


export class Systems {
  private readonly systems: System[] = [];

  constructor(
    systems: (System | SystemType)[], readonly entities: Entities, readonly indexer: Indexer
  ) {
    for (const item of systems) {
      // eslint-disable-next-line new-cap
      const system = item instanceof System ? item : new item();
      system.__init(this);
      this.systems.push(system);
    }
  }

  execute(time: number, delta: number): void {
    for (const system of this.systems) system.execute(time, delta);
  }
}
