import type {Buffers} from '../buffers';


export interface Uint32Pool {
  length: number;
  take(): number;
  refill(source: Uint32Array): void;
  fillWithDescendingIntegers(first: number): void;
}

export class UnsharedPool {
  private readonly data: Uint32Array;

  constructor(private readonly maxItems: number, private readonly configParamName: string) {
    this.data =
      new Uint32Array(new ArrayBuffer((maxItems + 1) * Uint32Array.BYTES_PER_ELEMENT));
  }

  get length(): number {
    return this.data[0];
  }

  take(): number {
    const length = this.data[0]--;
    CHECK: if (length <= 0) {
      throw new RangeError(
        `Pool capacity exceeded, please raise ${this.configParamName} above ${this.maxItems}`);
    }
    return this.data[length];
  }

  refill(source: Uint32Array): void {
    if (!source.length) return;
    const length = this.length;
    const newLength = length + source.length;
    DEBUG: {
      if (newLength > this.maxItems) {
        throw new Error('Internal error, refill exceeded pool capacity');
      }
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


/**
 * A shared pool of u32's that uses atomic operations to deconflict concurrent callers of `take`.
 * The `refill` method is not threadsafe.
 */
export class SharedAtomicPool {
  private data: Uint32Array;

  constructor(
    private readonly maxItems: number, private readonly configParamName: string, buffers: Buffers
  ) {
    buffers.register(
      `pool.${configParamName}`, maxItems + 1, Uint32Array,
      (data: Uint32Array) => {this.data = data;}
    );
  }

  get length(): number {
    return this.data[0];
  }

  take(): number {
    const length = Atomics.sub(this.data, 0, 1);
    CHECK: if (length <= 0) {
      throw new RangeError(
        `Pool capacity exceeded, please raise ${this.configParamName} above ${this.maxItems}`);
    }
    return this.data[length];
  }

  refill(source: Uint32Array): void {
    if (!source.length) return;
    const length = this.length;
    const newLength = length + source.length;
    DEBUG: {
      if (newLength > this.maxItems) {
        throw new Error('Internal error, refill exceeded pool capacity');
      }
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
