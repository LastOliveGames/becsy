import type {EntityId} from './entity';

export class Indexer {
  private readonly buffer: SharedArrayBuffer;
  private readonly index: Uint32Array;
  private numRefs = 0;

  constructor(private readonly maxRefs: number) {
    this.index = new Uint32Array(this.buffer = new SharedArrayBuffer(maxRefs * 8));
  }

  /**
   * Inserts a new reference entry into the index, but fails if this exact pair is already indexed.
   */
  insert(referenceId: EntityId, referrerId: EntityId): void {
    if (this.numRefs >= this.maxRefs) {
      throw new Error(`Max number of refs reached: ${this.maxRefs}`);
    }
    const i = this.findIndex(referenceId, referrerId);
    if (this.index[i * 2] === referenceId && this.index[i * 2 + 1] === referrerId) {
      throw new Error(`Internal error; ref already indexed: ${referrerId} -> ${referenceId}`);
    }
    this.index.copyWithin((i + 1) * 2, i * 2, (this.numRefs + 1) * 2);
    this.index[i * 2] = referenceId;
    this.index[i * 2 + 1] = referrerId;
    this.numRefs += 1;
  }

  /**
   * Removes a reference entry from the index, failing if it's missing.
   */
  remove(referenceId: EntityId, referrerId: EntityId): void {
    const i = this.findIndex(referenceId, referrerId);
    if (this.index[i * 2] === referenceId && this.index[i * 2 + 1] === referrerId) {
      throw new Error(`Internal error; ref not found: ${referrerId} -> ${referenceId}`);
    }
    this.numRefs -= 1;
    this.index.copyWithin(i, i + 1, this.numRefs - i);
  }

  /**
   * Returns an iterable over the IDs of all entities that refer to the given one.
   */
  *iterateReferrers(referenceId: EntityId): Iterable<EntityId> {
    // TODO: implement
  }

  /**
   * Finds the entry that matches referencedId:referrerId exactly.  If not found, finds the first
   * entry that would follow referenceId:referrerId.  If referrerId is not specified, finds the
   * first referenceId:* entry, if any.
   */
  private findIndex(referenceId: EntityId, referrerId?: EntityId): number {
    let lower = 0, upper = this.numRefs - 1;
    let i = 1;
    while (lower < upper) {
      i = Math.floor((upper - lower + 1) / 2) + lower;
      const id = this.index[i * 2];
      if (id === referenceId) {
        if (referrerId !== undefined && this.index[i * 2 + 1] < referrerId) {
          lower = i + 1;
        } else {
          upper = i - 1;
        }
      } else if (id < referenceId) {
        lower = i + 1;
      } else {
        upper = i - 1;
      }
    }
    if (lower >= upper) i = Math.max(0, Math.min(this.numRefs + 1, lower));
    return i;
  }
}
