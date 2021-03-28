import type {ComponentType} from './component';
import {Entity, MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES} from './entity';
import {Indexer} from './indexer';
import {Log, LogPointer} from './datastructures';
import type {System, SystemType} from './system';
import {config} from './config';
import {Registry} from './registry';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


type ComponentTypesArray = (ComponentType<any> | ComponentTypesArray)[];
type SystemTypesArray = (SystemType | SystemTypesArray)[];

export interface WorldOptions {
  maxEntities?: number;
  maxLimboEntities?: number;
  maxRefs?: number;
  maxShapeChangesPerFrame?: number;
  maxWritesPerFrame?: number;
  componentTypes: ComponentTypesArray;
  systems: SystemTypesArray;
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
  readonly registry;
  readonly systems: System[];
  private lastTime = now() / 1000;
  private executing: boolean;
  readonly shapeLog: Log;
  readonly writeLog: Log | undefined;
  private readonly shapeLogFramePointer: LogPointer;
  private readonly writeLogFramePointer: LogPointer | undefined;
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
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.indexer = new Indexer(maxRefs);
    this.registry =
      new Registry(maxEntities, maxLimboEntities, componentTypes.flat(Infinity), this);
    this.systems = this.normalizeAndInitSystems(systems);
    if (this.systems.some(system => system.__needsWriteLog)) {
      this.writeLog = new Log(maxWritesPerFrame, false, 'maxWritesPerFrame');
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
  }

  private normalizeAndInitSystems(userSystems: SystemTypesArray): System[] {
    return userSystems.flat(Infinity).map((userSystem: System | SystemType) => {
      // eslint-disable-next-line new-cap
      const system = typeof userSystem === 'function' ? new userSystem() : userSystem;
      system.__init(this);
      return system;
    });
  }

  execute(time?: number, delta?: number, systems?: System[]): void {
    if (config.DEBUG && this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    if (time === undefined) time = now() / 1000;
    if (delta === undefined) delta = time - this.lastTime;
    this.lastTime = time;
    for (const system of systems ?? this.systems) {
      this.registry.executingSystem = system;
      // Manually inlined the following from System for performance
      system.time = time;
      system.delta = delta;
      for (const query of system.__queries) query.__execute();
      system.execute();
      for (const query of system.__queries) query.__cleanup();
      this.flush();
    }
    this.registry.executingSystem = undefined;
    this.registry.processEndOfFrame();
    this.executing = false;
    this.gatherFrameStats();
  }

  executeAdHoc(system: System): void {
    system.__init(this);
    if (config.DEBUG && system.__needsWriteLog && !this.writeLog) {
      throw new Error('Internal error, ad hoc system needs write log');
    }
    this.execute(0, 0, [system]);
  }

  private gatherFrameStats(): void {
    this.stats.frames += 1;
    this.stats.maxShapeChangesPerFrame = this.shapeLog.countSince(this.shapeLogFramePointer);
    this.stats.maxWritesPerFrame = this.writeLog?.countSince(this.writeLogFramePointer!) ?? 0;
    this.shapeLog.createPointer(this.shapeLogFramePointer);
    this.writeLog?.createPointer(this.writeLogFramePointer);
  }

  private flush(): void {
    this.registry.pool.returnTemporaryBorrows();
    this.shapeLog.commit();
    this.writeLog?.commit();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const entity = this.registry.createEntity(initialComponents);
    if (!this.executing) this.flush();
    return entity;
  }
}
