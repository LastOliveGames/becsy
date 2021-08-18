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
    /* eslint-disable max-len */
    return `${this.numEntities.toLocaleString()} of ${this.maxEntities.toLocaleString()} peak (capacity ${this.capacity.toLocaleString()})`;
    /* eslint-enable max-len */
  }
}

const internalComponentStats = new ComponentStats();

export class Stats {
  frames = 0;
  private _numEntities = 0;
  private _maxEntities = 0;
  private _maxLimboComponents = 0;
  private _maxRefChangesPerFrame = 0;
  private _maxShapeChangesPerFrame = 0;
  private _maxWritesPerFrame = 0;
  components: {[typeName: string]: ComponentStats} = Object.create(null);

  get maxEntities(): number {
    return this._maxEntities;
  }

  get numEntities(): number {
    return this._numEntities;
  }

  set numEntities(value: number) {
    this._numEntities = value;
    if (value > this._maxEntities) this._maxEntities = value;
  }

  get maxLimboComponents(): number {
    return this._maxLimboComponents;
  }

  set maxLimboComponents(value: number) {
    if (value > this._maxLimboComponents) this._maxLimboComponents = value;
  }

  get maxRefChangesPerFrame(): number {
    return this._maxRefChangesPerFrame;
  }

  set maxRefChangesPerFrame(value: number) {
    if (value > this._maxRefChangesPerFrame) this._maxRefChangesPerFrame = value;
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
    if (type.id === 0) return internalComponentStats;
    return this.components[type.name] = this.components[type.name] ?? new ComponentStats();
  }

  toString(): string {
    /* eslint-disable max-len */
    return `World stats:
  frames: ${this.frames.toLocaleString()}
  entities: ${this.numEntities.toLocaleString()} of ${this.maxEntities.toLocaleString()} max
  refs: ${this.maxRefChangesPerFrame.toLocaleString()} ref changes/frame max
  logs: ${this.maxShapeChangesPerFrame.toLocaleString()} shape changes/frame max, ${this.maxWritesPerFrame.toLocaleString()} writes/frame max
  components: (${this.maxLimboComponents.toLocaleString()} limbo max)\n` +
    Object.keys(this.components).map(name => {
      const compStats = this.components[name];
      return `    ${name}: ${compStats.numEntities} (max ${compStats.maxEntities})`;
    }).join('\n');
    /* eslint-enable max-len */
  }
}
