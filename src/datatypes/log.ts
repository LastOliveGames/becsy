import type {ComponentType} from '../component';
import type {Buffers} from '../buffers';
import {ENTITY_ID_BITS} from '../consts';
import {CheckError, InternalError} from '../errors';


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


const HEADER_LENGTH = 2;
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
  /* layout: [length, unused, ...entries] */
  private staging: Uint32Array;
  private typeCounters: Uint32Array;

  constructor(
    private readonly maxEntries: number, private readonly configParamName: string, buffers: Buffers,
    private readonly options: LogOptions = {
      localProcessingAllowed: false, sortedByComponentType: false, numComponentTypes: 0
    }
  ) {
    buffers.register(
      `log.${configParamName}.buffer`, maxEntries + HEADER_LENGTH, Uint32Array,
      (data: Uint32Array) => {this.data = data;}
    );
    buffers.register(
      `log.${configParamName}.corral`, maxEntries + HEADER_LENGTH, Uint32Array,
      (corral: Uint32Array) => {this.corral = corral;}
    );
    if (options.sortedByComponentType) {
      DEBUG: if (options.numComponentTypes === undefined) {
        throw new InternalError(
          `numComponentTypes required when ${this.configParamName} is sortedByComponentType`);
      }
      buffers.register(
        `log.${configParamName}.staging`, maxEntries + HEADER_LENGTH, Uint32Array,
        (staging: Uint32Array) => {this.staging = staging;}
      );
      this.typeCounters = new Uint32Array(this.options.numComponentTypes!);
    }
  }

  push(value: number, type?: ComponentType<any>): void {
    const corralLength = this.corral[0];
    CHECK: if (corralLength >= this.maxEntries) this.throwCapacityExceeded();
    if (corralLength && this.corral[corralLength] === value) return;
    this.corral[corralLength + HEADER_LENGTH] = value;
    this.corral[0] += 1;
    DEBUG: if (!!type !== !!this.options.sortedByComponentType) {
      throw new InternalError(
        `Pushing value ${type ? 'with' : 'without'} type to log ${this.configParamName} ` +
        `${this.options.sortedByComponentType ? '' : 'not '}sorted by component type`);
    }
    if (type) this.typeCounters[type.id!] += 1;
  }

  commit(pointer?: LogPointer): boolean {
    DEBUG: if (!pointer && this.options.localProcessingAllowed) {
      throw new InternalError('Cannot use blind commit when log local processing is allowed');
    }
    if (!this.corral[0]) return true;
    if (pointer && !(
      pointer.generation === this.data[1] && pointer.index === this.data[0] &&
      pointer.corralGeneration === this.corral[1] && pointer.corralIndex === this.corral[0]
    )) return false;
    this.copyToData(this.staging ? this.sortCorral() : this.corral);
    this.corral[0] = 0;
    this.corral[1] += 1;
    if (pointer) {
      pointer.index = this.data[0];
      pointer.generation = this.data[1];
    }
    return true;
  }

  private sortCorral(): Uint32Array {
    let offset = HEADER_LENGTH, soleTypeId = -1, soleTypeCount = 0, numNonZeroTypes = 0;
    for (let typeId = 0; typeId < this.typeCounters.length; typeId++) {
      const count = this.typeCounters[typeId];
      if (!count) continue;
      CHECK: numNonZeroTypes += 1;
      if (soleTypeId === -1) {
        soleTypeId = typeId;
        soleTypeCount = count;
      } else if (soleTypeId >= 0) {
        soleTypeId = -2;
      }
      if (count === 1) {
        this.typeCounters[typeId] = offset;
        offset += 1;
      } else {
        this.typeCounters[typeId] = offset + 1;
        this.staging[offset] = count | (typeId << ENTITY_ID_BITS) | 2 ** 31;
        offset += count + 1;
      }
    }
    if (soleTypeId >= 0) {
      if (soleTypeCount > 1) {
        CHECK: if (this.corral[0] === this.maxEntries) this.throwCapacityExceeded();
        this.corral[this.corral[0] + HEADER_LENGTH] = this.corral[HEADER_LENGTH];
        this.corral[HEADER_LENGTH] = this.corral[0] | (soleTypeId << ENTITY_ID_BITS) | 2 ** 31;
        this.corral[0] += 1;
      }
      this.typeCounters.fill(0);
      return this.corral;
    }
    CHECK: if (this.corral[0] + numNonZeroTypes > this.maxEntries) this.throwCapacityExceeded();
    const corralAndHeaderLength = this.corral[0] + HEADER_LENGTH;
    for (let i = HEADER_LENGTH; i < corralAndHeaderLength; i++) {
      const value = this.corral[i];
      const typeId = value >>> ENTITY_ID_BITS;
      this.staging[this.typeCounters[typeId]++] = value;
    }
    this.staging[0] = offset - HEADER_LENGTH;
    this.typeCounters.fill(0);
    return this.staging;
  }

  private copyToData(source: Uint32Array): void {
    let index = this.data[0];
    const length = source[0];
    const firstSegmentLength = Math.min(length, this.maxEntries - index);
    this.data.set(
      source.subarray(HEADER_LENGTH, firstSegmentLength + HEADER_LENGTH),
      index + HEADER_LENGTH
    );
    if (firstSegmentLength < length) {
      this.data.set(
        source.subarray(firstSegmentLength + HEADER_LENGTH, length + HEADER_LENGTH),
        HEADER_LENGTH
      );
    }
    index += length;
    while (index >= this.maxEntries) {
      index -= this.maxEntries;
      this.data[1] += 1;
    }
    this.data[0] = index;
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
          this.data, startPointer.index + HEADER_LENGTH, endIndex + HEADER_LENGTH, false
        ];
        startPointer.index = endIndex;
      } else {
        const corralLength = this.corral[0];
        const corralGeneration = this.corral[1];
        const corralHasNewEntries = startPointer.corralGeneration === corralGeneration ?
          startPointer.corralIndex < corralLength : corralLength;
        if (corralHasNewEntries) {
          result = [
            this.corral, startPointer.corralIndex + HEADER_LENGTH,
            corralLength + HEADER_LENGTH, true
          ];
          startPointer.corralIndex = corralLength;
          startPointer.corralGeneration = corralGeneration;
        }
      }
    } else {
      result = [this.data, startPointer.index + HEADER_LENGTH, this.data.length, false];
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
    DEBUG: if (this.corral[0]) {
      throw new InternalError(`Should commit log before counting`);
    }
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
          throw new InternalError(`Start pointer exceeds end pointer`);
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
        throw new InternalError('Pointer corral generation older than corral');
      }
      if (pointer.corralGeneration === this.corral[1] && pointer.corralIndex > this.corral[0]) {
        throw new InternalError('Pointer past end of log corral area');
      }
    }
  }

  private throwCapacityExceeded(): void {
    throw new CheckError(
      `Log capacity exceeded, please raise ${this.configParamName} above ${this.maxEntries}`);
  }
}
