import type {ComponentType} from '../component';
import type {Buffers} from '../buffers';
import {CheckError, InternalError} from '../errors';
import {ENTITY_ID_BITS, LANE_ID_BITS} from '../consts';


export interface LogPointer {
  genindex: number;
  prevGenindex: number;
  corralIndex: number;
  corralGeneration: number;
}

interface LogOptions {
  writesAllowed?: boolean;
  sortedByComponentType?: boolean;
  numComponentTypes?: number;
  prefixedWithLaneId?: boolean;
  laneId?: number;
}


const HEADER_LENGTH = 2;
const EMPTY_TUPLE: [] = [];
const INDEX_BITS = 18;
const MAX_ENTRIES = 2 ** INDEX_BITS;
const INDEX_MASK = MAX_ENTRIES - 1;
const MAX_GENERATIONS = 2 ** (32 - INDEX_BITS);


/**
 * A circular log of u32 numbers with smart pointers into it.  When the log wraps around it
 * increments a generation counter so you can tell if your pointer got lapped and is now invalid.
 */
export class Log {
  /* layout: [current genindex, prospective genindex, ...entries] */
  private data: Uint32Array;
  /* layout: [length, generation, ...entries] */
  private corral: Uint32Array;
  /* layout: [length, sorted, ...entries] */
  private staging: Uint32Array;
  private typeCounters: Uint32Array;
  private readonly baseCorralLength: number = 0;

  constructor(
    private readonly maxEntries: number, private readonly configParamName: string,
    private readonly buffers: Buffers,
    private readonly options: LogOptions = {
      writesAllowed: true, sortedByComponentType: false, numComponentTypes: 0,
      prefixedWithLaneId: false
    }
  ) {
    CHECK: if (maxEntries > MAX_ENTRIES) {
      throw new Error(`${configParamName} higher than limit: ${maxEntries} > ${MAX_ENTRIES}`);
    }
    buffers.register(
      `log.${configParamName}.buffer`, maxEntries + HEADER_LENGTH, Uint32Array,
      (data: Uint32Array) => {this.data = data;}
    );
    buffers.register(
      `log.${configParamName}.corral`, maxEntries + HEADER_LENGTH, Uint32Array,
      (corral: Uint32Array) => {this.corral = corral;}, {laborerOnly: true}
    );
    if (options.prefixedWithLaneId) {
      this.baseCorralLength = this.corral[0] = 1;
    }
    if (options.sortedByComponentType) {
      DEBUG: if (options.numComponentTypes === undefined) {
        throw new InternalError(
          `numComponentTypes required when ${this.configParamName} is sortedByComponentType`);
      }
      buffers.register(
        `log.${configParamName}.staging`, maxEntries + HEADER_LENGTH, Uint32Array,
        (staging: Uint32Array) => {this.staging = staging;}, {laborerOnly: true}
      );
      this.typeCounters = new Uint32Array(this.options.numComponentTypes!);
    }
  }

  push(value: number, type?: ComponentType<any>): void {
    DEBUG: if (!this.corral) throw new InternalError('Write to read-only log');
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

  commit(laneId?: number): boolean {
    DEBUG: if (!this.corral && laneId === undefined) {
      throw new InternalError(`Bad configuration for log ${this.configParamName}`);
    }
    const corral = laneId === undefined ?
      this.corral : this.buffers.get(`log.${this.configParamName}.corral`, laneId!) as Uint32Array;
    const staging = this.options.sortedByComponentType ?
      laneId === undefined ?
        this.staging :
        this.buffers.get(`log.${this.configParamName}.staging`, laneId!) as Uint32Array :
      undefined;
    if (corral[0] === this.baseCorralLength) return true;
    if (this.options.prefixedWithLaneId) {
      corral[HEADER_LENGTH] = this.options.laneId! | (corral[0] - 1) << LANE_ID_BITS;
    }
    this.copyToData(this.sortCorral(corral, staging));
    corral[0] = this.baseCorralLength;
    corral[1] += 1;
    if (staging) {
      staging[0] = 0;
      staging[1] = 0;
    }
    return true;
  }

  sortCorral(corral = this.corral, staging = this.staging): Uint32Array {
    if (!staging) return corral;
    if (staging[1]) return staging;
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
        staging[offset] = count | (typeId << ENTITY_ID_BITS) | 2 ** 31;
        offset += count + 1;
      }
    }
    if (soleTypeId >= 0) {
      if (soleTypeCount > 1) {
        CHECK: if (corral[0] === this.maxEntries) this.throwCapacityExceeded();
        corral[corral[0] + HEADER_LENGTH] = corral[HEADER_LENGTH];
        corral[HEADER_LENGTH] = corral[0] | (soleTypeId << ENTITY_ID_BITS) | 2 ** 31;
        corral[0] += 1;
      }
      this.typeCounters.fill(0);
      return corral;
    }
    CHECK: if (corral[0] + numNonZeroTypes > this.maxEntries) this.throwCapacityExceeded();
    const corralAndHeaderLength = corral[0] + HEADER_LENGTH;
    for (let i = HEADER_LENGTH; i < corralAndHeaderLength; i++) {
      const value = corral[i];
      const typeId = value >>> ENTITY_ID_BITS;
      staging[this.typeCounters[typeId]++] = value;
    }
    staging[0] = offset - HEADER_LENGTH;
    staging[1] = 1;
    this.typeCounters.fill(0);
    return staging;
  }

  private copyToData(source: Uint32Array): void {
    const genindex = this.data[0];
    const index = genindex & INDEX_MASK;
    const length = source[0];
    let newIndex = index + length;
    let newGen = genindex >>> INDEX_BITS;
    while (newIndex >= this.maxEntries) {
      newIndex -= this.maxEntries;
      newGen += 1;
      if (newGen === MAX_GENERATIONS) newGen = 0;
    }
    const newGenindex = newIndex | (newGen << INDEX_BITS);
    Atomics.store(this.data, 1, newGenindex);

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

    Atomics.store(this.data, 0, newGenindex);
  }

  createPointer(pointer?: LogPointer): LogPointer {
    const genindex = Atomics.load(this.data, 0);
    if (!pointer) {
      return {
        genindex, prevGenindex: genindex,
        corralIndex: this.corral[0], corralGeneration: this.corral[1]
      };
    }
    pointer.genindex = pointer.prevGenindex = genindex;
    pointer.corralIndex = this.corral[0];
    pointer.corralGeneration = this.corral[1];
    return pointer;
  }

  copyPointer(pointer: LogPointer): LogPointer {
    return {
      genindex: pointer.genindex, prevGenindex: pointer.genindex,
      corralIndex: pointer.corralIndex, corralGeneration: pointer.corralGeneration
    };
  }

  hasUpdatesSince(pointer: LogPointer): boolean {
    CHECK: this.checkPointer(pointer);
    return !(
      pointer.genindex === Atomics.load(this.data, 0) &&
      (pointer.corralGeneration === this.corral[1] ?
        pointer.corralIndex === this.corral[0] : this.corral[0] === this.baseCorralLength)
    );
  }

  processSince(
    startPointer: LogPointer, endPointer?: LogPointer
  ): [Uint32Array, number, number] | [] {
    CHECK: this.checkPointers(startPointer, endPointer);
    let result: [Uint32Array, number, number] | [] = EMPTY_TUPLE;
    const genindex = Atomics.load(this.data, 0);
    const startIndex = startPointer.genindex & INDEX_MASK;
    const startGeneration = startPointer.genindex >>> INDEX_BITS;
    const endGenindex = endPointer?.genindex ?? genindex;
    const endIndex = endGenindex & INDEX_MASK;
    const endGeneration = endGenindex >>> INDEX_BITS;
    startPointer.prevGenindex = startPointer.genindex;
    if (startGeneration === endGeneration) {
      if (startIndex < endIndex) {
        result = [
          this.data, startIndex + HEADER_LENGTH, endIndex + HEADER_LENGTH
        ];
        startPointer.genindex = endGenindex;
      } else {
        const corralLength = this.corral[0];
        const corralGeneration = this.corral[1];
        const corralHasNewEntries = startPointer.corralGeneration === corralGeneration ?
          startPointer.corralIndex < corralLength : corralLength;
        if (corralHasNewEntries) {
          result = [
            this.corral, startPointer.corralIndex + HEADER_LENGTH,
            corralLength + HEADER_LENGTH
          ];
          startPointer.corralIndex = corralLength;
          startPointer.corralGeneration = corralGeneration;
        }
      }
    } else {
      result = [this.data, startIndex + HEADER_LENGTH, this.data.length];
      startPointer.genindex = endGenindex & ~INDEX_MASK;
    }
    return result;
  }

  countSince(startPointer: LogPointer, endPointer?: LogPointer): number {
    CHECK: this.checkPointers(startPointer, endPointer);
    DEBUG: if (this.corral[0] > this.baseCorralLength) {
      throw new InternalError(`Should commit log ${this.configParamName} before counting`);
    }
    const genindex = Atomics.load(this.data, 0);
    const startGenindex = startPointer.genindex;
    const endGenindex = endPointer?.genindex ?? genindex;
    startPointer.prevGenindex = startPointer.genindex = endGenindex;
    if (startGenindex === endGenindex) return 0;
    const startIndex = startGenindex & INDEX_MASK;
    const endIndex = endGenindex & INDEX_MASK;
    if (startIndex < endIndex) return endIndex - startIndex;
    return this.maxEntries - (startIndex - endIndex);
  }

  private checkPointers(startPointer: LogPointer, endPointer?: LogPointer): void {
    this.checkPointer(startPointer);
    if (endPointer) {
      this.checkPointer(endPointer);
      DEBUG: {
        if (startPointer.genindex > endPointer.genindex) {
          throw new InternalError(
            `Start pointer exceeds end pointer in log ${this.configParamName}`);
        }
      }
    }
  }

  private checkPointer(pointer: LogPointer): void {
    const genindex = Atomics.load(this.data, 1);
    const dataIndex = genindex & INDEX_MASK;
    const dataGeneration = genindex >>> INDEX_BITS;
    const pointerIndex = pointer.prevGenindex & INDEX_MASK;
    let pointerGeneration = pointer.prevGenindex >>> INDEX_BITS;
    if (pointerIndex === dataIndex) {
      if (pointerGeneration !== dataGeneration && pointerGeneration + 1 !== dataGeneration) {
        this.throwCapacityExceeded();
      }
    } else {
      if (pointerIndex > dataIndex) pointerGeneration += 1;
      if (pointerGeneration !== dataGeneration) this.throwCapacityExceeded();
    }
    DEBUG: {
      if (pointer.corralGeneration > this.corral[1]) {
        throw new InternalError(
          `Pointer corral generation older than corral in log ${this.configParamName}`);
      }
      if (pointer.corralGeneration === this.corral[1] && pointer.corralIndex > this.corral[0]) {
        throw new InternalError(`Pointer past end of corral area in log ${this.configParamName}`);
      }
    }
  }

  private throwCapacityExceeded(): void {
    throw new CheckError(
      `Log capacity exceeded, please raise ${this.configParamName} above ${this.maxEntries}`);
  }
}
