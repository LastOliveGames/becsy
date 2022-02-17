import {InternalError} from '../errors';
import type {Entity, EntityId} from '../entity';
import type {EntityPool} from '../registry';


export interface EntityList {
  entities: Entity[];
  add(id: EntityId): void;
  clear(): void;
}


export class ArrayEntityList implements EntityList {
  readonly entities: Entity[] = [];

  constructor(private readonly pool: EntityPool) {}

  add(id: EntityId): void {
    this.entities.push(this.pool.borrowTemporarily(id));
  }

  clear(): void {
    if (this.entities.length) this.entities.length = 0;
  }
}


export class PackedArrayEntityList implements EntityList {
  entities: Entity[] = [];
  private readonly lookupTable: Int32Array;

  constructor(private readonly pool: EntityPool, maxEntities: number) {
    this.lookupTable = new Int32Array(maxEntities);
    this.lookupTable.fill(-1);
  }

  add(id: EntityId): void {
    const index = this.entities.push(this.pool.borrow(id)) - 1;
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
  }
}
