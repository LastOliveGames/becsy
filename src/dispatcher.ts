import type {ComponentType} from './component';
import {
  Entities, Entity, EntityId, MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES, ReadWriteMasks
} from './entity';
import {Indexer} from './indexer';
import {Log, LogPointer} from './datastructures';
import type {Pool} from './pool';
import type {System, SystemType} from './system';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


type ComponentTypesArray = ComponentType<any>[] | ComponentTypesArray[];
type SystemsArray = (System | SystemType)[] | SystemsArray[];

export interface WorldOptions {
  maxEntities?: number;
  maxLimboEntities?: number;
  maxRefs?: number;
  maxShapeChangesPerFrame?: number;
  maxWritesPerFrame?: number;
  componentTypes: ComponentTypesArray;
  systems: SystemsArray;
}


export class Stats {
  frames = 0;

  _numEntities = 0;
  maxEntities = 0;

  get numEntities(): number {
    return this._numEntities;
  }

  set numEntities(value: number) {
    this._numEntities = value;
    if (value > this.maxEntities) this.maxEntities = value;
  }

  _maxLimboEntities = 0;

  get maxLimboEntities(): number {
    return this._maxLimboEntities;
  }

  set maxLimboEntities(value: number) {
    if (value > this._maxLimboEntities) this._maxLimboEntities = value;
  }

  _numRefs = 0;
  maxRefs = 0;

  get numRefs(): number {
    return this._numRefs;
  }

  set numRefs(value: number) {
    this._numRefs = value;
    if (value > this.maxRefs) this.maxRefs = value;
  }

  _maxShapeChangesPerFrame = 0;

  get maxShapeChangesPerFrame(): number {
    return this._maxShapeChangesPerFrame;
  }

  set maxShapeChangesPerFrame(value: number) {
    if (value > this._maxShapeChangesPerFrame) this._maxShapeChangesPerFrame = value;
  }

  _maxWritesPerFrame = 0;

  get maxWritesPerFrame(): number {
    return this._maxWritesPerFrame;
  }

  set maxWritesPerFrame(value: number) {
    if (value > this._maxWritesPerFrame) this._maxWritesPerFrame = value;
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


export class Dispatcher {
  readonly maxEntities;
  readonly indexer;
  readonly entities;
  readonly systems;
  private readonly pools: Pool<any>[] = [];
  private lastTime = now() / 1000;
  private executing: boolean;
  rwMasks: ReadWriteMasks | undefined;
  readonly shapeLog: Log;
  readonly writeLog: Log;
  private readonly shapeLogFramePointer: LogPointer;
  private readonly writeLogFramePointer: LogPointer;
  readonly stats = new Stats();

  constructor({
    maxEntities = 10000, maxLimboEntities = 2000, maxRefs = 10000,
    maxShapeChangesPerFrame = 25000, maxWritesPerFrame = 50000,
    componentTypes, systems
  }: WorldOptions) {
    if (maxEntities > MAX_NUM_ENTITIES) {
      throw new Error(`maxEntities too high, the limit is ${MAX_NUM_ENTITIES}`);
    }
    if (componentTypes.length > MAX_NUM_COMPONENTS) {
      throw new Error(`Too many component types, the limit is ${MAX_NUM_COMPONENTS}`);
    }
    this.maxEntities = maxEntities;
    this.shapeLog = new Log(maxShapeChangesPerFrame, false, 'maxShapeChangesPerFrame');
    this.writeLog = new Log(maxWritesPerFrame, false, 'maxWritesPerFrame');
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.writeLogFramePointer = this.writeLog.createPointer();
    this.indexer = new Indexer(maxRefs);
    this.entities =
      new Entities(maxEntities, maxLimboEntities, componentTypes.flat(Infinity), this);
    this.systems = this.normalizeAndInitSystems(systems);
  }

  private normalizeAndInitSystems(userSystems: SystemsArray): System[] {
    return userSystems.flat(Infinity).map((userSystem: System | SystemType) => {
      // eslint-disable-next-line new-cap
      const system = typeof userSystem === 'function' ? new userSystem() : userSystem;
      system.__init(this);
      return system;
    });
  }

  execute(time?: number, delta?: number): void {
    if (this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    if (!time) time = now() / 1000;
    if (!delta) delta = time - this.lastTime;
    this.lastTime = time;
    for (const system of this.systems) {
      this.rwMasks = system.__rwMasks;
      system.time = time;
      system.delta = delta;
      system.execute();
      this.flush();
    }
    this.rwMasks = undefined;
    this.entities.processEndOfFrame();
    this.executing = false;
    this.gatherFrameStats();
  }

  executeOne(system: System): void {
    if (this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    system.__init(this);
    // Don't set rwMasks -- give full power when executing a single system out of band.
    system.time = 0;
    system.delta = 0;
    system.execute();
    this.flush();
    this.entities.processEndOfFrame();
    this.executing = false;
  }

  private gatherFrameStats(): void {
    this.stats.frames += 1;
    this.stats.maxShapeChangesPerFrame = this.shapeLog.countSince(this.shapeLogFramePointer);
    this.stats.maxWritesPerFrame = this.writeLog.countSince(this.writeLogFramePointer);
    this.shapeLog.createPointer(this.shapeLogFramePointer);
    this.writeLog.createPointer(this.writeLogFramePointer);
  }

  addPool(pool: Pool<any>): void {
    this.pools.push(pool);
  }

  flush(): void {
    for (const pool of this.pools) pool.reset();
    this.shapeLog.commit();
    this.writeLog.commit();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const entity = this.entities.createEntity(initialComponents);
    if (!this.executing) this.flush();
    return entity;
  }

  bindEntity(id: EntityId): Entity {
    return this.entities.bind(id);
  }
}
