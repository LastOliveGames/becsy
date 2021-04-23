import type {ComponentType} from './component';

class ComponentStats {
  _numEntities = 0;
  maxEntities = 0;
  capacity = 0;

  get numEntities(): number {
    return this._numEntities;
  }

  set numEntities(value: number) {
    this._numEntities = value;
    if (value > this.maxEntities) this.maxEntities = value;
  }

  toString(): string {
    return `${this.numEntities} of ${this.maxEntities} max`;
  }
}

export class Stats {
  frames = 0;
  _numEntities = 0;
  maxEntities = 0;
  _maxLimboEntities = 0;
  _numRefs = 0;
  maxRefs = 0;
  _maxShapeChangesPerFrame = 0;
  _maxWritesPerFrame = 0;
  components: {[typeName: string]: ComponentStats} = Object.create(null);

  get numEntities(): number {
    return this._numEntities;
  }

  set numEntities(value: number) {
    this._numEntities = value;
    if (value > this.maxEntities) this.maxEntities = value;
  }

  get maxLimboEntities(): number {
    return this._maxLimboEntities;
  }

  set maxLimboEntities(value: number) {
    if (value > this._maxLimboEntities) this._maxLimboEntities = value;
  }

  get numRefs(): number {
    return this._numRefs;
  }

  set numRefs(value: number) {
    this._numRefs = value;
    if (value > this.maxRefs) this.maxRefs = value;
  }

  get maxShapeChangesPerFrame(): number {
    return this._maxShapeChangesPerFrame;
  }

  set maxShapeChangesPerFrame(value: number) {
    if (value > this._maxShapeChangesPerFrame) this._maxShapeChangesPerFrame = value;
  }

  get maxWritesPerFrame(): number {
    return this._maxWritesPerFrame;
  }

  set maxWritesPerFrame(value: number) {
    if (value > this._maxWritesPerFrame) this._maxWritesPerFrame = value;
  }

  for(type: ComponentType<any>): ComponentStats {
    return this.components[type.name] = this.components[type.name] ?? new ComponentStats();
  }

  toString(): string {
    /* eslint-disable max-len */
    return `World stats:
  frames: ${this.frames}
  entities: ${this.numEntities} of ${this.maxEntities} max (${this.maxLimboEntities} limbo max)
  refs: ${this.numRefs} of ${this.maxRefs} max
  logs: ${this.maxShapeChangesPerFrame} shape changes/frame max, ${this.maxWritesPerFrame} writes/frame max`;
    /* eslint-enable max-len */
  }
}
