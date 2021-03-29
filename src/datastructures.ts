import {config} from './config';


/**
 * A fixed but arbitrary size bitset.
 */
export class Bitset {
  private readonly bytes: Uint32Array;

  constructor(private readonly size: number) {
    this.bytes = new Uint32Array(Math.ceil(size / 32));
  }

  get(index: number): boolean {
    if (config.DEBUG) {
      if (index < 0 || index >= this.size) {
        throw new Error(`Bit index out of bounds: ${index}`);
      }
    }
    return (this.bytes[index >>> 5] & (1 << (index & 31))) !== 0;
  }

  set(index: number): void {
    if (config.DEBUG) {
      if (index < 0 || index >= this.size) {
        throw new Error(`Bit index out of bounds: ${index}`);
      }
    }
    this.bytes[index >>> 5] |= (1 << (index & 31));
  }

  unset(index: number): void {
    if (config.DEBUG) {
      if (index < 0 || index >= this.size) {
        throw new Error(`Bit index out of bounds: ${index}`);
      }
    }
    this.bytes[index >>> 5] &= ~(1 << (index & 31));
  }

  clear(): void {
    this.bytes.fill(0);
  }
}


export interface LogPointer {
  index: number;
  generation: number;
  corralIndex: number;
}


const LOG_HEADER_LENGTH = 2;
const EMPTY_TUPLE: [] = [];


/**
 * A circular log of u32 numbers with smart pointers into it.  When the log wraps around it
 * increments a generation counter so you can tell if your pointer got lapped and is now invalid.
 */
export class Log {
  /* layout: [index, generation, ...entries] */
  private readonly data: Uint32Array;
  /* layout: [length, ...entries] */
  private readonly corral: Uint32Array;

  constructor(
    private readonly maxEntries: number, private readonly configParamName: string
  ) {
    const buffer =
      new SharedArrayBuffer((maxEntries + LOG_HEADER_LENGTH) * Uint32Array.BYTES_PER_ELEMENT);
    this.data = new Uint32Array(buffer);
    this.corral =
      new Uint32Array(new SharedArrayBuffer((maxEntries + 1) * Uint32Array.BYTES_PER_ELEMENT));
  }

  push(value: number): void {
    const corralLength = this.corral[0];
    if (config.DEBUG && corralLength >= this.maxEntries) this.throwCapacityExceeded();
    if (corralLength && this.corral[corralLength] === value) return;
    this.corral[corralLength + 1] = value;
    this.corral[0] += 1;
  }

  commit(): void {
    const corralLength = this.corral[0];
    if (!corralLength) return;
    let index = this.data[0];
    const firstSegmentLength = Math.min(corralLength, this.maxEntries - index);
    this.data.set(this.corral.subarray(1, firstSegmentLength + 1), index + LOG_HEADER_LENGTH);
    if (firstSegmentLength < corralLength) {
      this.data.set(
        this.corral.subarray(firstSegmentLength + 1, corralLength + 1), LOG_HEADER_LENGTH);
    }
    index += corralLength;
    while (index >= this.maxEntries) {
      index -= this.maxEntries;
      this.data[1] += 1;
    }
    this.data[0] = index;
    this.corral[0] = 0;
  }

  createPointer(pointer?: LogPointer): LogPointer {
    if (!pointer) {
      return {index: this.data[0], generation: this.data[1], corralIndex: this.corral[0]};
    }
    pointer.index = this.data[0];
    pointer.generation = this.data[1];
    pointer.corralIndex = this.corral[0];
    return pointer;
  }

  processSince(
    startPointer: LogPointer, endPointer?: LogPointer
  ): [Uint32Array, number, number] | [] {
    if (config.DEBUG) this.checkPointers(startPointer, endPointer);
    let result: [Uint32Array, number, number] | [] = EMPTY_TUPLE;
    const endIndex = endPointer?.index ?? this.data[0];
    const endGeneration = endPointer?.generation ?? this.data[1];
    if (startPointer.generation === endGeneration) {
      if (startPointer.index < endIndex) {
        result = [this.data, startPointer.index + LOG_HEADER_LENGTH, endIndex + LOG_HEADER_LENGTH];
        startPointer.index = endIndex;
      } else {
        const corralLength = this.corral[0];
        if (startPointer.corralIndex < corralLength) {
          result = [this.corral, startPointer.corralIndex + 1, corralLength + 1];
          startPointer.corralIndex = corralLength;
        }
      }
    } else {
      result = [this.data, startPointer.index + LOG_HEADER_LENGTH, this.data.length];
      startPointer.index = 0;
      startPointer.generation = endGeneration;
    }
    return result;
  }

  countSince(startPointer: LogPointer, endPointer?: LogPointer): number {
    if (config.DEBUG) {
      this.checkPointers(startPointer, endPointer);
      if (this.corral[0]) throw new Error(`Internal error, should commit log before counting`);
    }
    const startIndex = startPointer.index;
    const endIndex = endPointer?.index ?? this.data[0];
    const endGeneration = endPointer?.generation ?? this.data[1];
    startPointer.index = endIndex;
    startPointer.generation = endGeneration;
    if (startIndex === endIndex && startPointer.generation === endGeneration) return 0;
    if (startIndex < endIndex) return endIndex - startIndex;
    return this.maxEntries - (startIndex - endIndex);
  }

  private checkPointers(startPointer: LogPointer, endPointer?: LogPointer): void {
    this.checkPointer(startPointer);
    if (endPointer) {
      this.checkPointer(endPointer);
      if (startPointer.index > endPointer.index &&
        startPointer.generation >= endPointer.generation) {
        throw new RangeError(`Internal error, start pointer exceeds end pointer`);
      }
    }
  }

  private checkPointer(pointer: LogPointer): void {
    const index = this.data[0];
    let generation = pointer.generation;
    if (pointer.index === index) {
      if (generation + 1 < this.data[1]) this.throwCapacityExceeded();
    } else {
      if (pointer.index > index) generation += 1;
      if (generation !== this.data[1]) this.throwCapacityExceeded();
    }
    if (pointer.corralIndex > this.corral[0]) {
      throw new Error('Internal error, pointer past end of log corral area');
    }
  }

  private throwCapacityExceeded(): void {
    throw new Error(
      `Log capacity exceeded, please raise ${this.configParamName} above ${this.maxEntries}`);
  }
}


/**
 * A shared pool of u32's that uses atomic operations to deconflict concurrent callers of `take`.
 * The `refill` method is not threadsafe.
 */
export class SharedAtomicPool {
  private readonly data: Uint32Array;

  constructor(private readonly maxItems: number, private readonly configParamName: string) {
    this.data =
      new Uint32Array(new SharedArrayBuffer((maxItems + 1) * Uint32Array.BYTES_PER_ELEMENT));
  }

  get length(): number {
    return this.data[0];
  }

  take(): number {
    const length = Atomics.sub(this.data, 0, 1);
    if (length <= 0) {
      throw new RangeError(
        `Pool capacity exceeded, please raise ${this.configParamName} above ${this.maxItems}`);
    }
    return this.data[length];
  }

  refill(source: Uint32Array): void {
    if (!source.length) return;
    const length = this.length;
    const newLength = length + source.length;
    if (config.DEBUG && newLength > this.maxItems) {
      throw new Error('Internal error, refill exceeded pool capacity');
    }
    this.data.set(source, length + 1);
    this.data[0] = newLength;
  }

  fillWithDescendingIntegers(first: number): void {
    const lowerBound = this.length;
    for (let i = this.data.length - 1; i > lowerBound; i--) {
      this.data[i] = first++;
    }
    this.data[0] = this.data.length - 1;
  }
}
