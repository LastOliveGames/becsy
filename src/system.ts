import type {ComponentType} from './component';
import type {Entities, Entity, EntityId} from './entity';


class QueryBuilder {
  private lastType: ComponentType<any>;

  constructor(
    private readonly callback: (q: QueryBuilder) => void,
    private readonly query: Query,
    private readonly system: System
  ) {}

  __build() {
    try {
      this.callback(this);
    } catch (e) {
      e.message = `Failed to build query in system ${this.system.name}: ${e.message}`;
      throw e;
    }
  }

  with(type: ComponentType<any>): this {
    return this.set('withMask', type);
  }

  without(type: ComponentType<any>): this {
    return this.set('withoutMask', type);
  }

  also(type: ComponentType<any>): this {
    this.lastType = type;
    return this;
  }

  get track(): this {
    return this.set('watchMask');
  }

  get read(): this {
    return this.set(this.system.__readMask);
  }

  get write(): this {
    this.set(this.system.__readMask);
    return this.set(this.system.__writeMask);
  }

  private set(
    mask: 'withMask' | 'withoutMask' | 'watchMask' | number[], type?: ComponentType<any>
  ): this {
    if (!type) type = this.lastType;
    if (!type) throw new Error('No component type to apply query modifier to');
    this.lastType = type;
    if (typeof mask === 'string') {
      if (!this.query[mask]) this.query[mask] = [];
      mask = this.query[mask]!;
    }
    if (type.__flagOffset >= mask.length) {
      mask.length = type.__flagOffset + 1;
      mask.fill(0, mask.length, type.__flagOffset);
    }
    mask[type.__flagOffset] |= type.__flagMask;
    return this;
  }
}


class Query {
  private withMask: number[] | undefined;
  private withoutMask: number[] | undefined;
  private watchMask: number[] | undefined;

  constructor(private readonly system: System) { }

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

}


export interface SystemType {
  new(): System;
}


export abstract class System {
  __readMask: number[] = [];
  __writeMask: number[] = [];
  __systems: Systems;
  __borrowedEntities: Entity[] = [];
  private readonly queryBuilders: QueryBuilder[] = [];

  get name(): string {return this.constructor.name;}

  query(buildCallback: (q: QueryBuilder) => void): Query {
    const query = new Query(this);
    const builder = new QueryBuilder(buildCallback, query, this);
    this.queryBuilders.push(builder);
    return query;
  }

  createEntity(callback?: (entity: Entity) => void): Entity {
    const entities = this.__systems.entities;
    const entity = entities.createEntity(this);
    this.__borrowedEntities.push(entity);
    callback?.(entity);
    return entity;
  }

  abstract execute(delta: number, time: number): void;

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

  constructor(systems: (System | SystemType)[], readonly entities: Entities) {
    for (const item of systems) {
      // eslint-disable-next-line new-cap
      const system = item instanceof System ? item : new item();
      system.__init(this);
      this.systems.push(system);
    }
  }

  execute(delta: number, time: number): void {
    for (const system of this.systems) system.execute(delta, time);
  }
}
