import {InternalError} from '../errors';
import type {Entity, EntityId} from '../entity';
import type {EntityPool} from '../registry';

export type OrderTransform = (entity: Entity) => number;

export interface EntityList {
  entities: Entity[];
  add(id: EntityId): void;
  clear(): void;
  sort(): void;
}


export class ArrayEntityList implements EntityList {
  readonly entities: Entity[] = [];
  private maxOrderKey = -Infinity;
  private sorted = true;

  constructor(
    private readonly pool: EntityPool, private readonly orderBy: OrderTransform | undefined
  ) {}

  add(id: EntityId): void {
    const entity = this.pool.borrowTemporarily(id);
    if (this.orderBy) {
      const orderKey = this.orderBy(entity);
      if (orderKey >= this.maxOrderKey) {
        this.maxOrderKey = orderKey;
      } else {
        this.sorted = false;
      }
    }
    this.entities.push(entity);
  }

  clear(): void {
    if (this.entities.length) this.entities.length = 0;
    this.maxOrderKey = -Infinity;
    this.sorted = true;
  }

  sort(): void {
    if (this.sorted) return;
    const orderBy = this.orderBy!;
    this.entities.sort((a, b) => {
      const aKey = orderBy(a), bKey = orderBy(b);
      return aKey < bKey ? -1 : aKey > bKey ? +1 : 0;
    });
    this.sorted = true;
  }
}


export class PackedArrayEntityList implements EntityList {
  entities: Entity[] = [];
  private readonly lookupTable: Int32Array;
  private maxOrderKey = -Infinity;
  private sorted = true;

  constructor(
    private readonly pool: EntityPool, private readonly orderBy: OrderTransform | undefined,
    maxEntities: number
  ) {
    this.lookupTable = new Int32Array(maxEntities);
    this.lookupTable.fill(-1);
  }

  add(id: EntityId): void {
    const entity = this.pool.borrow(id);
    if (this.orderBy) {
      const orderKey = this.orderBy(entity);
      if (orderKey >= this.maxOrderKey) {
        this.maxOrderKey = orderKey;
      } else {
        this.sorted = false;
      }
    }
    const index = this.entities.push(entity) - 1;
    this.lookupTable[id] = index;
  }

  remove(id: EntityId): void {
    const index = this.lookupTable[id];
    DEBUG: if (index < 0) throw new InternalError('Entity not in list');
    this.pool.return(id);
    this.lookupTable[id] = -1;
    const entity = this.entities.pop()!;
    if (index < this.entities.length) {
      this.entities[index] = entity;
      this.lookupTable[entity.__id] = index;
    }
  }

  has(id: EntityId): boolean {
    return this.lookupTable[id] >= 0;
  }

  clear(): void {
    for (const entity of this.entities) this.pool.return(entity.__id);
    this.entities = [];
    this.lookupTable.fill(-1);
    this.maxOrderKey = -Infinity;
    this.sorted = true;
  }

  sort(): void {
    if (this.sorted) return;
    const orderBy = this.orderBy!;
    this.entities.sort((a, b) => {
      const aKey = orderBy(a), bKey = orderBy(b);
      return aKey < bKey ? -1 : aKey > bKey ? +1 : 0;
    });
    this.sorted = true;
  }
}
