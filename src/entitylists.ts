import type {Dispatcher} from './dispatcher';
import type {Entity, EntityId} from './entity';

class EntityIterator {
  private index = 0;
  private array: Uint32Array;
  private length: number;
  private extraMask: number[] | undefined;

  constructor(private readonly dispatcher: Dispatcher) {}

  reset(array: Uint32Array, length: number, extraMask: number[] | undefined): void {
    this.index = 0;
    this.array = array;
    this.length = length;
    this.extraMask = extraMask;
  }

  next(): any {
    this.dispatcher.flush();
    if (this.index < this.length) {
      return {value: this.dispatcher.entities.bind(this.array[this.index++], this.extraMask)};
    }
    return {done: true, value: undefined};
  }
}


export interface EntityList {
  add(id: EntityId): void;
  remove(id: EntityId): void;
  clear(): void;
  iterate(extraMask?: number[]): Iterable<Entity>;
}


export class ArrayEntityList implements EntityList, Iterable<Entity> {
  private length = 0;
  private readonly list: Uint32Array;
  private readonly iterator: EntityIterator;

  constructor(dispatcher: Dispatcher) {
    this.list = new Uint32Array(dispatcher.maxEntities);
    this.iterator = new EntityIterator(dispatcher);
  }

  add(id: EntityId): void {
    if (this.length >= this.list.length) {
      throw new Error(`Internal error, entity list capacity exceeded`);
    }
    this.list[this.length++] = id;
  }

  remove(id: EntityId): void {
    for (let i = 0; i < this.length; i++) {
      if (this.list[i] === id) {
        this.list.copyWithin(i, i + 1, this.length);
        this.length -= 1;
        return;
      }
    }
    throw new Error('Internal error, entity not in list');
  }

  clear(): void {
    this.length = 0;
  }

  iterate(extraMask?: number[]): Iterable<Entity> {
    this.iterator.reset(this.list, this.length, extraMask);
    return this;
  }

  [Symbol.iterator](): Iterator<Entity> {
    return this.iterator;
  }
}


export class SparseArrayEntityList implements EntityList, Iterable<Entity> {
  private length = 0;
  private readonly list: Uint32Array;
  private readonly lookupTable: Int32Array;
  private readonly iterator: EntityIterator;

  constructor(dispatcher: Dispatcher) {
    this.list = new Uint32Array(dispatcher.maxEntities);
    this.lookupTable = new Int32Array(dispatcher.maxEntityId);
    this.lookupTable.fill(-1);
    this.iterator = new EntityIterator(dispatcher);
  }

  add(id: EntityId): void {
    if (this.length >= this.list.length) {
      throw new Error(`Internal error, entity list capacity exceeded`);
    }
    this.list[this.length] = id;
    this.lookupTable[id] = this.length++;
  }

  remove(id: EntityId): void {
    const i = this.lookupTable[id];
    if (i < 0) throw new Error('Internal error, entity not in list');
    this.lookupTable[id] = -1;
    this.length -= 1;
    if (this.length > 1 && i < this.length) {
      const swappedId = this.list[i] = this.list[this.length];
      this.lookupTable[swappedId] = i;
    }
  }

  clear(): void {
    this.length = 0;
    this.lookupTable.fill(-1);
  }

  iterate(extraMask?: number[]): Iterable<Entity> {
    this.iterator.reset(this.list, this.length, extraMask);
    return this;
  }

  [Symbol.iterator](): Iterator<Entity> {
    return this.iterator;
  }
}
