import {config} from './config';


class Mutex {
  private readonly cell: Int32Array;

  constructor(buffer: SharedArrayBuffer, offset: number) {
    this.cell = new Int32Array(buffer, offset, 1);
  }

  lock(): void {
    while (true) {
      if (Atomics.compareExchange(this.cell, 0, 0, 1) === 0) return;
      Atomics.wait(this.cell, 0, 1);
    }
  }

  unlock(): void {
    if (Atomics.compareExchange(this.cell, 0, 1, 0) !== 1) {
      throw new Error('Unmatched mutex unlock');
    }
    Atomics.notify(this.cell, 0, 1);
  }
}


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
}


const LOG_HEADER_LENGTH = 3;


/**
 * A circular log of u32 numbers with smart pointers into it.  When the log wraps around it
 * increments a generation counter so you can tell if your pointer got lapped and is now invalid.
 */
export class Log {
  /* layout: [index, generation, mutex, ...entries] */
  private readonly data: Uint32Array;
  private readonly mutex?: Mutex;
  private corral?: Uint32Array;
  private corralLength = 0;

  constructor(
    private readonly numItems: number, threadsafe: boolean,
    private readonly configParamName: string
  ) {
    const buffer = new SharedArrayBuffer((numItems + LOG_HEADER_LENGTH) * 4);
    this.data = new Uint32Array(buffer);
    if (threadsafe) {
      this.mutex = new Mutex(buffer, 8);
      this.corral = new Uint32Array(numItems);
    }
  }

  push(value: number): void {
    if (this.corral) {
      if (config.DEBUG && this.corralLength >= this.numItems) this.throwCapacityExceeded();
      if (this.corralLength && this.corral[this.corralLength - 1] === value) return;
      this.corral[this.corralLength++] = value;
    } else {
      let index = this.data[0];
      this.data[index + LOG_HEADER_LENGTH] = value;
      index += 1;
      if (index >= this.numItems) {
        index = 0;
        this.data[1] += 1;
      }
      this.data[0] = index;
    }
  }

  commit(): void {
    if (!this.corral || !this.corralLength) return;
    this.mutex?.lock();
    let index = this.data[0];
    const firstSegmentLength = Math.min(this.corralLength, this.numItems - index);
    this.data.set(this.corral.subarray(0, firstSegmentLength), index + LOG_HEADER_LENGTH);
    if (firstSegmentLength < this.corralLength) {
      this.data.set(
        this.corral.subarray(firstSegmentLength, this.corralLength), LOG_HEADER_LENGTH);
    }
    index += this.corralLength;
    if (index >= this.numItems) {
      index = 0;
      this.data[1] += 1;
    }
    this.data[0] = index;
    this.mutex?.unlock();
    this.corralLength = 0;
  }

  createPointer(pointer?: LogPointer): LogPointer {
    if (!pointer) return {index: this.data[0], generation: this.data[1]};
    pointer.index = this.data[0];
    pointer.generation = this.data[1];
    return pointer;
  }

  processSince(startPointer: LogPointer, endPointer?: LogPointer): Iterable<number> {
    return {
      [Symbol.iterator]: () => {
        this.mutex?.lock();
        if (config.DEBUG) this.checkPointers(startPointer, endPointer);
        let index = startPointer.index;
        const startGeneration = startPointer.generation;
        const endIndex = endPointer?.index ?? this.data[0];
        const endGeneration = endPointer?.generation ?? this.data[1];
        this.mutex?.unlock();
        return {
          next: () => {
            if (index === endIndex && startGeneration === endGeneration) {
              if (config.DEBUG) this.checkPointer(startPointer);
              startPointer.index = endIndex;
              startPointer.generation = endGeneration;
              return {done: true, value: undefined};
            }
            const value = this.data[index + LOG_HEADER_LENGTH];
            index += 1;
            if (index === this.numItems) index = 0;
            return {value};
          }
        };
      }
    };
  }

  copySince(
    startPointer: LogPointer, endPointer: LogPointer | undefined,
    copy: (data: Uint32Array) => void
  ): void {
    this.mutex?.lock();
    if (config.DEBUG) this.checkPointers(startPointer, endPointer);
    const startIndex = startPointer.index;
    const endIndex = endPointer?.index ?? this.data[0];
    const endGeneration = endPointer?.generation ?? this.data[1];
    if (startIndex < endIndex) {
      copy(this.data.subarray(startIndex + LOG_HEADER_LENGTH, endIndex + LOG_HEADER_LENGTH));
    } else if (startIndex > endIndex) {
      copy(this.data.subarray(startIndex + LOG_HEADER_LENGTH, this.data.length));
      if (endIndex > 0) copy(this.data.subarray(LOG_HEADER_LENGTH, endIndex + LOG_HEADER_LENGTH));
    }
    startPointer.index = endIndex;
    startPointer.generation = endGeneration;
    this.mutex?.unlock();
  }

  countSince(startPointer: LogPointer, endPointer?: LogPointer): number {
    if (config.DEBUG) this.checkPointers(startPointer, endPointer);
    const startIndex = startPointer.index;
    if (!endPointer) this.mutex?.lock();
    const endIndex = endPointer?.index ?? this.data[0];
    const endGeneration = endPointer?.generation ?? this.data[1];
    if (!endPointer) this.mutex?.unlock();
    if (startIndex === endIndex && startPointer.generation === endGeneration) return 0;
    if (startIndex < endIndex) return endIndex - startIndex;
    return this.numItems - (startIndex - endIndex);
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
    if (pointer.index > index) generation += 1;
    if (generation !== this.data[1]) this.throwCapacityExceeded();
  }

  private throwCapacityExceeded(): void {
    throw new Error(
      `Log capacity exceeded, please raise ${this.configParamName} above ${this.numItems}`);
  }
}


/**
 * A shared pool of u32's that uses atomic operations to deconflict concurrent callers of `take`.
 * The `replenish` method is not threadsafe.
 */
export class SharedAtomicPool {
  private readonly data: Uint32Array;

  constructor(private readonly maxItems: number, private readonly configParamName: string) {
    this.data = new Uint32Array(new SharedArrayBuffer(maxItems * 4 + 4));
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
