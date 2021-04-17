import type {ComponentType} from './component';
import {Entity, MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES} from './entity';
import {Indexer} from './indexer';
import {Log, LogPointer} from './datastructures';
import {System, SystemBox, SystemType} from './system';
import {Registry} from './registry';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


type ComponentTypesArray = (ComponentType<any> | ComponentTypesArray)[];
type SystemTypesArray = (SystemType | any | SystemTypesArray)[];

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


class CallbackSystem extends System {
  __callback: (system: System) => void;

  execute() {
    this.__callback(this);
  }
}


export class Dispatcher {
  readonly maxEntities;
  readonly indexer;
  readonly registry;
  readonly systems: SystemBox[];
  private lastTime = now() / 1000;
  executing: boolean;
  readonly shapeLog: Log;
  readonly writeLog: Log | undefined;
  private readonly shapeLogFramePointer: LogPointer;
  private readonly writeLogFramePointer: LogPointer | undefined;
  readonly stats;
  private readonly userCallbackSystem;
  private readonly callbackSystem;

  constructor({
    componentTypes, systems,
    maxEntities = 10000,
    maxLimboEntities = Math.ceil(maxEntities / 5),
    maxRefs = maxEntities,
    maxShapeChangesPerFrame = maxEntities * 2,
    maxWritesPerFrame = maxEntities * 4,
  }: WorldOptions) {
    if (maxEntities > MAX_NUM_ENTITIES) {
      throw new Error(`maxEntities too high, the limit is ${MAX_NUM_ENTITIES}`);
    }
    if (componentTypes.length > MAX_NUM_COMPONENTS) {
      throw new Error(`Too many component types, the limit is ${MAX_NUM_COMPONENTS}`);
    }
    STATS: this.stats = new Stats();
    this.maxEntities = maxEntities;
    this.shapeLog = new Log(maxShapeChangesPerFrame, 'maxShapeChangesPerFrame');
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.indexer = new Indexer(maxRefs);
    this.registry =
      new Registry(maxEntities, maxLimboEntities, componentTypes.flat(Infinity), this);
    this.systems = this.normalizeAndInitSystems(systems);
    if (this.systems.some(system => system.hasWriteQueries)) {
      this.writeLog = new Log(maxWritesPerFrame, 'maxWritesPerFrame');
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
    this.userCallbackSystem = new CallbackSystem();
    this.callbackSystem = new SystemBox(this.userCallbackSystem, this);
  }

  private normalizeAndInitSystems(userSystems: SystemTypesArray): SystemBox[] {
    const systems = [];
    const flatUserSystems = userSystems.flat(Infinity);
    for (let i = 0; i < flatUserSystems.length; i++) {
      const system = new flatUserSystems[i]() as System;
      const props = flatUserSystems[i + 1];
      if (props && typeof props !== 'function') {
        Object.assign(system, props);
        i++;
      }
      systems.push(new SystemBox(system, this));
    }
    return systems;
  }

  execute(time?: number, delta?: number, systems?: SystemBox[]): void {
    CHECK: if (this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    if (time === undefined) time = now() / 1000;
    if (delta === undefined) delta = time - this.lastTime;
    this.lastTime = time;
    for (const system of systems ?? this.systems) {
      this.registry.executingSystem = system;
      system.execute(time, delta);
      this.flush();
    }
    this.registry.executingSystem = undefined;
    this.registry.processEndOfFrame();
    this.executing = false;
    STATS: this.gatherFrameStats();
  }

  executeFunction(fn: (system: System) => void): void {
    DEBUG: if (this.executing) {
      throw new Error('Ad hoc function execution not allowed while world is executing');
    }
    // Don't set registry.executingSystem to avoid rwMask checks.
    this.executing = true;
    this.userCallbackSystem.__callback = fn;
    this.callbackSystem.execute(0, 0);
    this.flush();
    this.registry.processEndOfFrame();
    this.executing = false;
    STATS: this.gatherFrameStats();
  }

  private gatherFrameStats(): void {
    this.stats.frames += 1;
    this.stats.maxShapeChangesPerFrame = this.shapeLog.countSince(this.shapeLogFramePointer);
    this.stats.maxWritesPerFrame = this.writeLog?.countSince(this.writeLogFramePointer!) ?? 0;
  }

  private flush(): void {
    this.registry.flush();
    this.shapeLog.commit();
    this.writeLog?.commit();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const entity = this.registry.createEntity(initialComponents);
    if (!this.executing) this.flush();
    return entity;
  }
}
