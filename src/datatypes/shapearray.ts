import type {EntityId} from '../entity';
import type {Buffers} from '../buffers';
import type {ComponentType} from '../component';
import type {ComponentEnum} from '../enums';
import {InternalError} from '../errors';

export interface ShapeArray {
  syncThreads(): void;
  set(entityId: EntityId, type: ComponentType<any>): void;
  unset(entityId: EntityId, type: ComponentType<any>): void;
  isSet(entityId: EntityId, type: ComponentType<any>): boolean;
  get(entityId: number, enumeration: ComponentEnum): number;
  clear(): void;
  match(entityId: EntityId, positiveMask: number[], positiveValues: number[]): boolean;
  matchNot(entityId: EntityId, negativeMask: number[]): boolean;
}


export class UnsharedShapeArray implements ShapeArray {
  private readonly stride: number;
  private array: Uint32Array;

  constructor(bufferKey: string, numBits: number, maxEntities: number, buffers: Buffers) {
    this.stride = Math.ceil(numBits / 32);
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
    const value = binding.shapeValue;
    this.array[index] &= ~mask;
    this.array[index] |= value;
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
    const value = binding.shapeValue;
    return (this.array[index] & mask) === value;
  }

  get(entityId: number, enumeration: ComponentEnum): number {
    const binding = enumeration.__binding;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    return (this.array[index] & mask) >>> binding.shapeShift;
  }

  clear(): void {
    this.array.fill(0);
  }

  match(entityId: EntityId, positiveMask: number[], positiveValues: number[]): boolean {
    DEBUG: if (positiveMask.length !== positiveValues.length) {
      throw new InternalError(
        `Mismatched mask and value lengths: ${positiveMask.length} vs ${positiveValues.length}`);
    }
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < positiveMask.length; i++) {
      if ((array[index + i] & positiveMask[i]) !== positiveValues[i]) return false;
    }
    return true;
  }

  matchNot(entityId: EntityId, negativeMask: number[]): boolean {
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < negativeMask.length; i++) {
      if ((array[index + i] & negativeMask[i]) !== 0) return false;
    }
    return true;
  }
}


export class AtomicSharedShapeArray implements ShapeArray {
  private readonly stride: number;
  private array: Uint32Array;

  constructor(bufferKey: string, numBits: number, maxEntities: number, buffers: Buffers) {
    this.stride = Math.ceil(numBits / 32);
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
    const value = binding.shapeValue;
    if (mask !== value) Atomics.and(this.array, index, ~mask);
    Atomics.or(this.array, index, value);
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
    const value = binding.shapeValue;
    // Entity liveness flag can be written at any time from any thread, so do atomic check.
    if (type.id === 0) return (Atomics.load(this.array, index) & mask) === value;
    return (this.array[index] & mask) === value;
  }

  get(entityId: number, enumeration: ComponentEnum): number {
    const binding = enumeration.__binding;
    const index = entityId * this.stride + binding.shapeOffset;
    const mask = binding.shapeMask;
    return (this.array[index] & mask) >>> binding.shapeShift;
  }

  clear(): void {
    this.array.fill(0);
  }

  match(entityId: EntityId, positiveMask: number[], positiveValues: number[]): boolean {
    DEBUG: if (positiveMask.length !== positiveValues.length) {
      throw new InternalError(
        `Mismatched mask and value lengths: ${positiveMask.length} vs ${positiveValues.length}`);
    }
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < positiveMask.length; i++) {
      if ((array[index + i] & positiveMask[i]) !== positiveValues[i]) return false;
    }
    return true;
  }

  matchNot(entityId: EntityId, negativeMask: number[]): boolean {
    const array = this.array;
    const index = entityId * this.stride;
    for (let i = 0; i < negativeMask.length; i++) {
      if ((array[index + i] & negativeMask[i]) !== 0) return false;
    }
    return true;
  }
}
