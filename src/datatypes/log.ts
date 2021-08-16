import type {ComponentType} from '../component';
import type {Buffers} from '../buffers';
import {ENTITY_ID_BITS} from '../consts';


export interface LogPointer {
  index: number;
  generation: number;
  corralIndex: number;
  corralGeneration: number;
}

interface LogOptions {
  localProcessingAllowed?: boolean;
  sortedByComponentType?: boolean;
  numComponentTypes?: number;
}


const LOG_HEADER_LENGTH = 2;
const CORRAL_HEADER_LENGTH = 2;
const EMPTY_TUPLE: [] = [];


/**
 * A circular log of u32 numbers with smart pointers into it.  When the log wraps around it
 * increments a generation counter so you can tell if your pointer got lapped and is now invalid.
 */
export class Log {
  /* layout: [index, generation, ...entries] */
  private data: Uint32Array;
  /* layout: [length, generation, ...entries] */
  private corral: Uint32Array;
  /* layout: [...entries] */
  private staging: Uint32Array;
  private typeCounters: Uint32Array;

  constructor(
    private readonly maxEntries: number, private readonly configParamName: string, buffers: Buffers,
    private readonly options: LogOptions = {
      localProcessingAllowed: false, sortedByComponentType: false, numComponentTypes: 0
    }
  ) {
    buffers.register(
      `log.${configParamName}.buffer`, maxEntries + LOG_HEADER_LENGTH, Uint32Array,
      (data: Uint32Array) => {this.data = data;}
    );
    buffers.register(
      `log.${configParamName}.corral`, maxEntries + CORRAL_HEADER_LENGTH, Uint32Array,
      (corral: Uint32Array) => {this.corral = corral;}
    );
    if (options.sortedByComponentType) {
      DEBUG: if (options.numComponentTypes === undefined) {
        throw new Error(
          `numComponentTypes required when ${this.configParamName} is sortedByComponentType`);
      }
      buffers.register(
        `log.${configParamName}.staging`, maxEntries, Uint32Array,
        (staging: Uint32Array) => {this.staging = staging;}
      );
      this.typeCounters = new Uint32Array(this.options.numComponentTypes!);
    }
  }

  push(value: number, type?: ComponentType<any>): void {
    const corralLength = this.corral[0];
    CHECK: if (corralLength >= this.maxEntries) this.throwCapacityExceeded();
    if (corralLength && this.corral[corralLength] === value) return;
    this.corral[corralLength + CORRAL_HEADER_LENGTH] = value;
    this.corral[0] += 1;
    DEBUG: if (!!type !== !!this.options.sortedByComponentType) {
      throw new Error(
        `Pushing value ${type ? 'with' : 'without'} type to log ${this.configParamName} ` +
        `${this.options.sortedByComponentType ? '' : 'not '}sorted by component type`);
    }
    if (type) this.typeCounters[type.id!] += 1;
  }

  commit(pointer?: LogPointer): boolean {
    DEBUG: if (!pointer && this.options.localProcessingAllowed) {
      throw new Error('Cannot use blind commit when log local processing is allowed');
    }
    const corralLength = this.corral[0];
    if (!corralLength) return true;
    let index = this.data[0];
    let generation = this.data[1];
    if (pointer && !(
      pointer.generation === generation && pointer.index === index &&
      pointer.corralGeneration === this.corral[1] && pointer.corralIndex === this.corral[0]
    )) return false;
    if (this.staging) {
      const stagingLength = this.sortCorralIntoStaging();
      this.copyToData(this.staging, stagingLength, index);
      index += stagingLength;
    } else {
      this.copyToData(this.corral, corralLength, index);
      index += corralLength;
    }
    while (index >= this.maxEntries) {
      index -= this.maxEntries;
      generation += 1;
    }
    this.data[0] = index;
    this.data[1] = generation;
    this.corral[0] = 0;
    this.corral[1] += 1;
    if (pointer) {
      pointer.index = index;
      pointer.generation = generation;
    }
    return true;
  }

  private sortCorralIntoStaging(): number {
    let offset = 0;
    for (let typeId = 0; typeId < this.typeCounters.length; typeId++) {
      const count = this.typeCounters[typeId];
      if (!count) continue;
      this.typeCounters[typeId] = offset + 1;
      this.staging[offset] = count | (typeId << ENTITY_ID_BITS) | 2 ** 31;
      offset += count + 1;
    }
    const corralLength = this.corral[0] + CORRAL_HEADER_LENGTH;
    for (let i = CORRAL_HEADER_LENGTH; i < corralLength; i++) {
      const value = this.corral[i];
      const typeId = value >>> ENTITY_ID_BITS;
      this.staging[this.typeCounters[typeId]++] = value;
    }
    this.typeCounters.fill(0);
    return offset;
  }

  private copyToData(sourceArray: Uint32Array, length: number, index: number): void {
    const sourceHeaderLength = sourceArray === this.corral ? CORRAL_HEADER_LENGTH : 0;
    const firstSegmentLength = Math.min(length, this.maxEntries - index);
    this.data.set(
      sourceArray.subarray(sourceHeaderLength, firstSegmentLength + sourceHeaderLength),
      index + LOG_HEADER_LENGTH
    );
    if (firstSegmentLength < length) {
      this.data.set(
        sourceArray.subarray(firstSegmentLength + sourceHeaderLength, length + sourceHeaderLength),
        LOG_HEADER_LENGTH
      );
    }
  }

  createPointer(pointer?: LogPointer): LogPointer {
    if (!pointer) {
      return {
        index: this.data[0], generation: this.data[1],
        corralIndex: this.corral[0], corralGeneration: this.corral[1]
      };
    }
    pointer.index = this.data[0];
    pointer.generation = this.data[1];
    pointer.corralIndex = this.corral[0];
    pointer.corralGeneration = this.corral[1];
    return pointer;
  }

  copyPointer(pointer: LogPointer): LogPointer {
    return {
      index: pointer.index, generation: pointer.generation,
      corralIndex: pointer.corralIndex, corralGeneration: pointer.corralGeneration
    };
  }

  hasUpdatesSince(pointer: LogPointer): boolean {
    CHECK: this.checkPointer(pointer);
    return !(
      pointer.index === this.data[0] && pointer.generation === this.data[1] &&
      (pointer.corralGeneration === this.corral[1] ?
        pointer.corralIndex === this.corral[0] : this.corral[0] === 0)
    );
  }

  processSince(
    startPointer: LogPointer, endPointer?: LogPointer
  ): [Uint32Array, number, number, boolean] | [] {
    CHECK: this.checkPointers(startPointer, endPointer);
    let result: [Uint32Array, number, number, boolean] | [] = EMPTY_TUPLE;
    const endIndex = endPointer?.index ?? this.data[0];
    const endGeneration = endPointer?.generation ?? this.data[1];
    if (startPointer.generation === endGeneration) {
      if (startPointer.index < endIndex) {
        result = [
          this.data, startPointer.index + LOG_HEADER_LENGTH, endIndex + LOG_HEADER_LENGTH, false
        ];
        startPointer.index = endIndex;
      } else {
        const corralLength = this.corral[0];
        const corralGeneration = this.corral[1];
        const corralHasNewEntries = startPointer.corralGeneration === corralGeneration ?
          startPointer.corralIndex < corralLength : corralLength;
        if (corralHasNewEntries) {
          result = [
            this.corral, startPointer.corralIndex + CORRAL_HEADER_LENGTH,
            corralLength + CORRAL_HEADER_LENGTH, true
          ];
          startPointer.corralIndex = corralLength;
          startPointer.corralGeneration = corralGeneration;
        }
      }
    } else {
      result = [this.data, startPointer.index + LOG_HEADER_LENGTH, this.data.length, false];
      startPointer.index = 0;
      startPointer.generation = endGeneration;
    }
    return result;
  }

  processAndCommitSince(startPointer: LogPointer): [Uint32Array, number, number, boolean] | [] {
    const result = this.processSince(startPointer);
    if (result[0]) return result;
    if (this.commit(startPointer)) return EMPTY_TUPLE;
    return this.processSince(startPointer);
  }

  countSince(startPointer: LogPointer, endPointer?: LogPointer): number {
    CHECK: this.checkPointers(startPointer, endPointer);
    DEBUG: if (this.corral[0]) throw new Error(`Internal error, should commit log before counting`);
    const startIndex = startPointer.index;
    const startGeneration = startPointer.generation;
    const endIndex = endPointer?.index ?? this.data[0];
    const endGeneration = endPointer?.generation ?? this.data[1];
    startPointer.index = endIndex;
    startPointer.generation = endGeneration;
    if (startIndex === endIndex && startGeneration === endGeneration) return 0;
    if (startIndex < endIndex) return endIndex - startIndex;
    return this.maxEntries - (startIndex - endIndex);
  }

  private checkPointers(startPointer: LogPointer, endPointer?: LogPointer): void {
    this.checkPointer(startPointer);
    if (endPointer) {
      this.checkPointer(endPointer);
      DEBUG: {
        if (startPointer.index > endPointer.index &&
            startPointer.generation >= endPointer.generation) {
          throw new RangeError(`Internal error, start pointer exceeds end pointer`);
        }
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
    DEBUG: {
      if (pointer.corralGeneration > this.corral[1]) {
        throw new Error('Internal error, pointer corral generation older than corral');
      }
      if (pointer.corralGeneration === this.corral[1] && pointer.corralIndex > this.corral[0]) {
        throw new Error('Internal error, pointer past end of log corral area');
      }
    }
  }

  private throwCapacityExceeded(): void {
    throw new Error(
      `Log capacity exceeded, please raise ${this.configParamName} above ${this.maxEntries}`);
  }
}
