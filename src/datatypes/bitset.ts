import {InternalError} from '../errors';

/**
 * A fixed but arbitrary size bitset.
 */
export class Bitset {
  private readonly bytes: Uint32Array;

  constructor(private readonly size: number) {
    this.bytes = new Uint32Array(Math.ceil(size / 32));
  }

  get(index: number): boolean {
    DEBUG: {
      if (index < 0 || index >= this.size) {
        throw new InternalError(`Bit index out of bounds: ${index}`);
      }
    }
    return (this.bytes[index >>> 5] & (1 << (index & 31))) !== 0;
  }

  set(index: number): void {
    DEBUG: {
      if (index < 0 || index >= this.size) {
        throw new InternalError(`Bit index out of bounds: ${index}`);
      }
    }
    this.bytes[index >>> 5] |= (1 << (index & 31));
  }

  unset(index: number): void {
    DEBUG: {
      if (index < 0 || index >= this.size) {
        throw new InternalError(`Bit index out of bounds: ${index}`);
      }
    }
    this.bytes[index >>> 5] &= ~(1 << (index & 31));
  }

  clear(): void {
    this.bytes.fill(0);
  }
}
