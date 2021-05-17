import type {ComponentStorage, ComponentType} from './component';
import type {Entity} from './entity';
import {MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES} from './consts';
import {Log, LogPointer} from './datastructures';
import {System, SystemBox, SystemType} from './system';
import {Registry} from './registry';
import {Stats} from './stats';
import {RefIndexer} from './refindexer';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


// TODO: figure out a better type for interleaved arrays, here and elsewhere
// https://stackoverflow.com/questions/67467302/type-for-an-interleaved-array-of-classes-and-values
type DefsArray = (ComponentType<any> | SystemType | any | DefsArray)[];

export interface WorldOptions {
  defs: DefsArray;
  maxEntities?: number;
  maxLimboEntities?: number;
  maxLimboComponents?: number;
  maxRefChangesPerFrame?: number;
  maxShapeChangesPerFrame?: number;
  maxWritesPerFrame?: number;
  defaultComponentStorage?: ComponentStorage;
}

class CallbackSystem extends System {
  __callback: (system: System) => void;

  execute() {
    this.__callback(this);
  }
}


export class Dispatcher {
  readonly maxEntities;
  readonly defaultComponentStorage;
  readonly registry;
  readonly systems: SystemBox[];
  private lastTime = now() / 1000;
  executing: boolean;
  readonly shapeLog: Log;
  readonly writeLog: Log | undefined;
  private readonly shapeLogFramePointer: LogPointer;
  private readonly writeLogFramePointer: LogPointer | undefined;
  readonly stats;
  readonly indexer: RefIndexer;
  private readonly userCallbackSystem;
  private readonly callbackSystem;

  constructor({
    defs,
    maxEntities = 10000,
    maxLimboEntities = Math.ceil(maxEntities / 5),
    maxLimboComponents = Math.ceil(maxEntities / 5),
    maxShapeChangesPerFrame = maxEntities * 2,
    maxWritesPerFrame = maxEntities * 4,
    maxRefChangesPerFrame = maxEntities,
    defaultComponentStorage = 'sparse'
  }: WorldOptions) {
    if (maxEntities > MAX_NUM_ENTITIES) {
      throw new Error(`maxEntities too high, the limit is ${MAX_NUM_ENTITIES}`);
    }
    const {componentTypes, systemTypes} = this.splitDefs(defs);
    if (componentTypes.length > MAX_NUM_COMPONENTS) {
      throw new Error(`Too many component types, the limit is ${MAX_NUM_COMPONENTS}`);
    }
    STATS: this.stats = new Stats();
    this.maxEntities = maxEntities;
    this.defaultComponentStorage = defaultComponentStorage;
    this.shapeLog = new Log(maxShapeChangesPerFrame, 'maxShapeChangesPerFrame');
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.registry = new Registry(
      maxEntities, maxLimboEntities, maxLimboComponents, componentTypes.flat(Infinity), this);
    this.indexer = new RefIndexer(this, maxRefChangesPerFrame);
    this.registry.initializeComponentTypes();
    this.systems = this.normalizeAndInitSystems(systemTypes);
    if (this.systems.some(system => system.hasWriteQueries)) {
      this.writeLog = new Log(maxWritesPerFrame, 'maxWritesPerFrame');
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
    this.userCallbackSystem = new CallbackSystem();
    this.callbackSystem = new SystemBox(this.userCallbackSystem, this);
    this.callbackSystem.rwMasks.read = undefined;
    this.callbackSystem.rwMasks.write = undefined;
  }

  private normalizeAndInitSystems(systemTypes: (SystemType | any)[]): SystemBox[] {
    const systems = [];
    const flatUserSystems = systemTypes.flat(Infinity);
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

  private splitDefs(defs: DefsArray):
      {componentTypes: ComponentType<any>[], systemTypes: (SystemType | any)[]} {
    const componentTypes: ComponentType<any>[] = [];
    const systemTypes: (SystemType | any)[] = [];
    let lastDefWasSystem = false;
    for (const def of defs.flat(Infinity)) {
      if (typeof def === 'function') {
        lastDefWasSystem = def.__system;
        (lastDefWasSystem ? systemTypes : componentTypes).push(def);
      } else {
        CHECK: if (!lastDefWasSystem) throw new Error('Unexpected value in world defs: ' + def);
        systemTypes.push(def);
        lastDefWasSystem = false;
      }
    }
    return {componentTypes, systemTypes};
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
    this.indexer.processEndOfFrame();
    this.executing = false;
    STATS: this.gatherFrameStats();
  }

  executeFunction(fn: (system: System) => void): void {
    DEBUG: if (this.executing) {
      throw new Error('Ad hoc function execution not allowed while world is executing');
    }
    this.executing = true;
    this.registry.executingSystem = this.callbackSystem;
    this.userCallbackSystem.__callback = fn;
    this.callbackSystem.execute(0, 0);
    this.flush();
    this.registry.executingSystem = undefined;
    this.registry.processEndOfFrame();
    this.indexer.processEndOfFrame();
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
    this.indexer.flush();  // may update writeLog
    this.shapeLog.commit();
    this.writeLog?.commit();
  }

  createEntity(initialComponents: (ComponentType<any> | any)[]): Entity {
    const entity = this.registry.createEntity(initialComponents);
    if (!this.executing) this.flush();
    return entity;
  }
}
