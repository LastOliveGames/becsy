import type {Buffers} from '../buffers';


export interface Uint32Pool {
  length: number;
  take(): number;
  return(id: number): void;
  mark(): void;
  peekSinceMark(index: number): number | void;
  refill(source: number[]): void;
  fillWithDescendingIntegers(first: number): void;
}

const HEADER_LENGTH = 2;

export class UnsharedPool implements Uint32Pool {
  // layout: length, mark, ...uints
  private readonly data: Uint32Array;

  constructor(private readonly maxItems: number, private readonly configParamName: string) {
    this.data = new Uint32Array(
      new ArrayBuffer((maxItems + HEADER_LENGTH) * Uint32Array.BYTES_PER_ELEMENT));
  }

  get length(): number {
    return this.data[0];
  }

  take(): number {
    const length = --this.data[0];
    CHECK: if (length < 0) {
      throw new RangeError(
        `Pool capacity exceeded, please raise ${this.configParamName} above ${this.maxItems}`);
    }
    return this.data[length + HEADER_LENGTH];
  }

  return(id: number): void {
    DEBUG: if (this.length >= this.maxItems) {
      throw new Error('Internal error, returned entity ID exceeded pool capacity');
    }
    this.data[this.length + HEADER_LENGTH] = id;
    this.data[0] += 1;
  }

  mark(): void {
    this.data[1] = this.data[0];
  }

  peekSinceMark(index: number): number | void {
    const i = this.data[1] + index;
    if (i < this.data[0]) return this.data[i + HEADER_LENGTH];
  }

  refill(source: number[]): void {
    if (!source.length) return;
    const length = this.length;
    const newLength = length + source.length;
    DEBUG: if (newLength > this.maxItems) {
      throw new Error('Internal error, returned entity ID exceeded pool capacity');
    }
    this.data.set(source, length + HEADER_LENGTH);
    this.data[0] = newLength;
  }

  fillWithDescendingIntegers(first: number): void {
    const lowerBound = this.length + HEADER_LENGTH;
    for (let i = this.data.length - 1; i >= lowerBound; i--) {
      this.data[i] = first++;
    }
    this.data[0] = this.data.length - HEADER_LENGTH;
  }
}


/**
 * A shared pool of u32's that uses atomic operations to deconflict concurrent callers of `take`.
 * The `return` method is not threadsafe.
 */
export class SharedAtomicPool {
  // layout: length, mark, ...uints
  private data: Uint32Array;

  constructor(
    private readonly maxItems: number, private readonly configParamName: string, buffers: Buffers
  ) {
    buffers.register(
      `pool.${configParamName}`, maxItems + HEADER_LENGTH, Uint32Array,
      (data: Uint32Array) => {this.data = data;}
    );
  }

  get length(): number {
    return this.data[0];
  }

  take(): number {
    const length = Atomics.sub(this.data, 0, 1);
    CHECK: if (length < 0) {
      throw new RangeError(
        `Pool capacity exceeded, please raise ${this.configParamName} above ${this.maxItems}`);
    }
    return this.data[length + HEADER_LENGTH];
  }

  return(id: number): void {
    DEBUG: if (this.length >= this.maxItems) {
      throw new Error('Internal error, returned entity ID exceeded pool capacity');
    }
    this.data[this.length + HEADER_LENGTH] = id;
    this.data[0] += 1;
  }

  mark(): void {
    this.data[1] = this.data[0];
  }

  peekSinceMark(index: number): number | void {
    const i = this.data[1] + index;
    if (i < this.data[0]) return this.data[i + HEADER_LENGTH];
  }

  refill(source: number[]): void {
    if (!source.length) return;
    const length = this.length;
    const newLength = length + source.length;
    DEBUG: if (newLength > this.maxItems) {
      throw new Error('Internal error, returned entity ID exceeded pool capacity');
    }
    this.data.set(source, length + HEADER_LENGTH);
    this.data[0] = newLength;
  }

  fillWithDescendingIntegers(first: number): void {
    const lowerBound = this.length + HEADER_LENGTH;
    for (let i = this.data.length - 1; i >= lowerBound; i--) {
      this.data[i] = first++;
    }
    this.data[0] = this.data.length - HEADER_LENGTH;
  }
}
