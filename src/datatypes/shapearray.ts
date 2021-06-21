import type {EntityId} from '../entity';
import type {Buffers} from '../buffers';
import type {ComponentType} from '../component';

export interface ShapeArray {
  syncThreads(): void;
  set(entityId: EntityId, type: ComponentType<any>): void;
  unset(entityId: EntityId, type: ComponentType<any>): void;
  isSet(entityId: EntityId, type: ComponentType<any>): boolean;
  clear(): void;
  match(entityId: EntityId, positiveMask: number[]): boolean;
  matchNot(entityId: EntityId, negativeMask: number[]): boolean;
}


export class UnsharedShapeArray implements ShapeArray {
  private readonly stride: number;
  private array: Uint32Array;

  constructor(bufferKey: string, numComponentTypes: number, maxEntities: number, buffers: Buffers) {
    this.stride = Math.ceil(numComponentTypes / 32);
    buffers.register(
      bufferKey, maxEntities * this.stride, Uint32Array, shapes => {this.array = shapes;});
  }

  syncThreads(): void {
    // no-op
  }

  set(entityId: number, type: ComponentType<any>): void {
    const binding = type.__binding!;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    this.array[index] |= mask;
  }

  unset(entityId: number, type: ComponentType<any>): void {
    const binding = type.__binding!;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    this.array[index] &= ~mask;
  }

  isSet(entityId: number, type: ComponentType<any>): boolean {
    const binding = type.__binding!;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    return (this.array[index] & mask) !== 0;
  }

  clear(): void {
    this.array.fill(0);
  }

  match(entityId: EntityId, positiveMask: number[]): boolean {
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < positiveMask.length; i++) {
      const maskByte = positiveMask[i];
      if ((array[index + i] & maskByte) !== maskByte) return false;
    }
    return true;
  }

  matchNot(entityId: EntityId, negativeMask: number[]): boolean {
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < negativeMask.length; i++) {
      const maskByte = negativeMask[i];
      if ((array[index + i] & maskByte) !== 0) return false;
    }
    return true;
  }
}


export class AtomicSharedShapeArray implements ShapeArray {
  private readonly stride: number;
  private array: Uint32Array;

  constructor(bufferKey: string, numComponentTypes: number, maxEntities: number, buffers: Buffers) {
    this.stride = Math.ceil(numComponentTypes / 32);
    buffers.register(
      bufferKey, maxEntities * this.stride, Uint32Array, shapes => {this.array = shapes;});
  }

  syncThreads(): void {
    // We assume that any atomic operation will force a write barrier on the whole array.
    Atomics.load(this.array, 0);
  }

  set(entityId: number, type: ComponentType<any>): void {
    const binding = type.__binding!;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    Atomics.or(this.array, index, mask);
  }

  unset(entityId: number, type: ComponentType<any>): void {
    const binding = type.__binding!;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    Atomics.and(this.array, index, ~mask);
  }

  isSet(entityId: number, type: ComponentType<any>): boolean {
    const binding = type.__binding!;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    // Entity liveness flag can be written at any time from any thread, so do atomic check.
    if (type.id === 0) return (Atomics.load(this.array, index) & mask) !== 0;
    return (this.array[index] & mask) !== 0;
  }

  clear(): void {
    this.array.fill(0);
  }

  match(entityId: EntityId, positiveMask: number[]): boolean {
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < positiveMask.length; i++) {
      const maskByte = positiveMask[i];
      if ((array[index + i] & maskByte) !== maskByte) return false;
    }
    return true;
  }

  matchNot(entityId: EntityId, negativeMask: number[]): boolean {
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < negativeMask.length; i++) {
      const maskByte = negativeMask[i];
      if ((array[index + i] & maskByte) !== 0) return false;
    }
    return true;
  }
}
