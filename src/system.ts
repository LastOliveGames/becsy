import type {ComponentType} from './component';
import type {Entities, Entity, EntityId} from './entity';


class Query {
  private lastType: ComponentType<any>;
  private withMask: number[] | undefined;
  private withoutMask: number[] | undefined;
  private watchMask: number[] | undefined;

  constructor(private readonly system: System) { }

  with(type: ComponentType<any>): Query {
    return this.derive(type, 'withMask');
  }

  without(type: ComponentType<any>): Query {
    return this.derive(type, 'withoutMask');
  }

  and(type: ComponentType<any>): Query {
    return this.derive(type);
  }

  get watch(): Query {
    return this.derive(this.lastType, 'watchMask');
  }

  get read(): Query {
    setFlag(this.system.__readMask, this.lastType);
    return this;
  }

  get write(): Query {
    setFlag(this.system.__readMask, this.lastType);
    setFlag(this.system.__writeMask, this.lastType);
    return this;
  }

  private derive(type: ComponentType<any>, maskName?: 'withMask' | 'withoutMask' | 'watchMask') {
    if (!type) throw new Error('No component type to apply query modifier to');
    const query = this.clone(type);
    if (maskName) {
      let mask = query[maskName];
      if (!mask) query[maskName] = mask = [];
      setFlag(mask, type);
    }
    return query;
  }

  private clone(type: ComponentType<any>): Query {
    const query = new Query(this.system);
    query.lastType = type;
    query.withMask = this.withMask ? Array.from(this.withMask) : undefined;
    query.withoutMask = this.withoutMask ? Array.from(this.withoutMask) : undefined;
    query.watchMask = this.watchMask ? Array.from(this.watchMask) : undefined;
    return query;
  }

  get all() {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id => entities.matchCurrent(id, this.withMask, this.withoutMask));
  }

  get added() {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id =>
        entities.matchCurrent(id, this.withMask, this.withoutMask) &&
        !entities.matchPrevious(id, this.withMask, this.withoutMask)
    );
  }

  get removed() {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id =>
        !entities.matchCurrent(id, this.withMask, this.withoutMask) &&
        entities.matchPrevious(id, this.withMask, this.withoutMask)
    );
  }

  get changed() {
    const entities = this.system.__systems.entities;
    return this.iterate(
      id =>
        entities.matchCurrent(id, this.withMask, this.withoutMask) &&
        entities.matchMutated(id, this.watchMask)
    );
  }

  private iterate(predicate: (id: EntityId) => boolean): Iterable<Entity> {
    return this.system.__systems.entities.iterate(
      this.system, predicate, () => {this.system.__releaseEntities();}
    );
  }

  createEntity(callback?: (entity: Entity) => void): Entity {
    const entities = this.system.__systems.entities;
    const entity = entities.createEntity(this.system);
    this.system.__borrowedEntities.push(entity);
    callback?.(entity);
    return entity;
  }

}


export interface SystemType {
  new(): System;
}

export abstract class System {
  __readMask: number[] = [];
  __writeMask: number[] = [];
  __systems: Systems;
  __borrowedEntities: Entity[] = [];

  query(): Query {
    return new Query(this);
  }

  abstract execute(delta: number, time: number): void;

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

  constructor(systems: (System | SystemType)[], readonly entities: Entities) {
    for (const item of systems) {
      // eslint-disable-next-line new-cap
      const system = item instanceof System ? item : new item();
      if (system.__systems) {
        throw new Error(
          `You can't reuse an instance of system ${system.constructor.name} in different worlds`);
      }
      system.__systems = this;
      this.systems.push(system);
    }
  }

  execute(delta: number, time: number): void {
    for (const system of this.systems) system.execute(delta, time);
  }
}


function setFlag(mask: number[], type: ComponentType<any>): void {
  if (type.__flagOffset >= mask.length) {
    mask.length = type.__flagOffset + 1;
    mask.fill(0, mask.length, type.__flagOffset);
  }
  mask[type.__flagOffset] |= type.__flagMask;
}
