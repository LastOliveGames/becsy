import type {ComponentStorage, ComponentType} from './component';
import type {Entity} from './entity';
import {MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES} from './consts';
import {Log, LogPointer} from './datatypes/log';
import {
  initSystemGroup, RunState, System, SystemBox, SystemGroup, SystemGroupImpl, SystemType
} from './system';
import {Registry} from './registry';
import {Stats} from './stats';
import {RefIndexer} from './refindexer';
import {Buffers} from './buffers';
import {
  componentTypes as decoratedComponentTypes, systemTypes as decoratedSystemTypes
} from './decorators';


const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


// TODO: figure out a better type for interleaved arrays, here and elsewhere
// https://stackoverflow.com/questions/67467302/type-for-an-interleaved-array-of-classes-and-values
type DefElement = ComponentType<any> | SystemType<System> | Record<string, unknown> | SystemGroup;
type DefsArray = (DefElement | DefsArray)[];

/**
 * All the options needed to create a new world.
 *
 * You can get hints on good values for all the `max` options by printing out the `world.stats`
 * after running your world for a bit.
 */
export interface WorldOptions {
  /**
   * A list of all the component types, system types (with optional initializers), and system groups
   * that the world can make use of.  It's an array in no particular order and can be nested
   * arbitrarily deep for your convenience -- it'll get flattened.  It should contain:
   * - component classes
   * - system classes, each optionally followed by an object to initialize the system's properties
   * - system groups created with `System.group`
   *
   * You must not include duplicates -- this includes systems defined inside groups!  Any classes
   * decorated with @component or @system will be included automatically.
   */
  defs?: DefsArray;
  threads?: number;
  maxEntities?: number;
  maxLimboComponents?: number;
  maxRefChangesPerFrame?: number;
  maxShapeChangesPerFrame?: number;
  maxWritesPerFrame?: number;
  defaultComponentStorage?: ComponentStorage;
}

/**
 * Instructions for the `control` method.
 */
export interface ControlOptions {
  /**
   * A list of systems to stop.  It can include anything accepted by the world's `defs` option (with
   * arbitrarily nested arrays) but only system types and system groups will be processed. No action
   * will be taken on systems that are already stopped.
   */
  stop: DefsArray;

  /**
   * A list of systems to restart.  It can include anything accepted by the world's `defs` option
   * (with arbitrarily nested arrays) but only system types and system groups will be processed. No
   * action will be taken on systems that are already running.
   */
  restart: DefsArray;
}

class CallbackSystem extends System {
  __callback: (system: System) => void;

  execute() {
    this.__callback(this);
  }
}


export class FrameImpl {
  private executing: boolean;
  private time = now() / 1000;
  private delta: number;

  constructor(private readonly dispatcher: Dispatcher, private readonly groups: SystemGroup[]) {
    CHECK: if (groups.length === 0) {
      throw new Error('At least one system group needed');
    }
    CHECK: for (const group of groups) {
      if (!dispatcher.systemGroups.includes(group)) {
        throw new Error('Some groups in the frame are not parts of the world defs');
      }
    }
  }

  /**
   * Indicates that execution of a frame has begun and locks in the default `time` and `delta`.
   * Must be called once at the beginning of each frame, prior to any calls to `execute`.  Must be
   * bookended by a call to `end`.
   *
   * You cannot call `begin` while any other executors are running.
   */
  begin(): void {
    CHECK: if (this.executing) throw new Error('Frame already executing');
    CHECK: if (this.dispatcher.executing) throw new Error('Another frame already executing');
    this.executing = this.dispatcher.executing = true;
    this.time = now() / 1000;
    this.delta = this.time - this.dispatcher.lastTime;
    this.dispatcher.lastTime = this.time;
  }

  /**
   * Indicates that execution of a frame has completed.  Must be called once at the end of each
   * frame, after any calls to `execute`.
   */
  end(): void {
    CHECK: if (!this.executing) throw new Error('Frame not executing');
    DEBUG: if (!this.dispatcher.executing) throw new Error('No frame executing');
    this.executing = this.dispatcher.executing = false;
    allExecuted: {
      for (const group of this.groups) if (!group.__executed) break allExecuted;
      for (const group of this.groups) group.__executed = false;
      this.dispatcher.completeCycle();
    }
    this.dispatcher.completeFrame();
  }

  /**
   * Executes a group of systems.  If your world is single-threaded then execution is synchronous
   * and you can ignore the returned promise.
   *
   * You cannot execute individual systems, unless you create a singleton group to hold them.
   *
   * @param group The group of systems to execute.  Must be a member of the group list passed in
   * when this executor was created.
   *
   * @param time The time of this frame's execution.  This will be set on every system's `time`
   * property and defaults to the time when `begin` was called.  It's not used internally so you can
   * pass in any numeric value that's expected by your systems.
   *
   * @param delta The duration since the last frame's execution.  This will be set on every system's
   * `delta` property and default to the duration since any previous frame's `begin` was called.
   * It's not used internally so you can pass in any numeric value that's expected by your systems.
   */
  async execute(group: SystemGroup, time?: number, delta?: number): Promise<void> {
    CHECK: if (!this.groups.includes(group)) throw new Error('Group not included in this frame');
    CHECK: if (!this.executing) throw new Error('Frame not executing');
    const dispatcher = this.dispatcher;
    const registry = dispatcher.registry;
    const systems = group.__systems;
    time = time ?? this.time;
    delta = delta ?? this.delta;
    group.__executed = true;
    for (const system of systems) {
      registry.executingSystem = system;
      await system.execute(time, delta);
      dispatcher.flush();
    }
    registry.executingSystem = undefined;
  }
}

/**
 * A frame executor that lets you manually run system groups.  You can create one by calling
 * `world.createCustomExecutor`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Frame extends FrameImpl {}


export class Dispatcher {
  readonly maxEntities;
  readonly defaultComponentStorage;
  readonly registry;
  private readonly systems: SystemBox[];
  readonly systemsByClass = new Map<SystemType<System>, SystemBox>();
  readonly systemGroups: SystemGroup[];
  lastTime = now() / 1000;
  executing: boolean;
  readonly shapeLog: Log;
  readonly writeLog?: Log;
  private readonly shapeLogFramePointer: LogPointer;
  private readonly writeLogFramePointer?: LogPointer;
  readonly stats;
  readonly indexer: RefIndexer;
  readonly threaded: boolean;
  readonly buffers: Buffers;
  private readonly userCallbackSystem;
  private readonly callbackSystem;
  private readonly deferredControls = new Map<SystemBox, RunState>();

  constructor({
    defs,
    threads = 1,
    maxEntities = 10000,
    maxLimboComponents = Math.ceil(maxEntities / 5),
    maxShapeChangesPerFrame = maxEntities * 2,
    maxWritesPerFrame = maxEntities * 4,
    maxRefChangesPerFrame = maxEntities,
    defaultComponentStorage = 'packed'
  }: WorldOptions) {
    if (threads < 1) throw new Error('Minimum of one thread');
    if (threads > 1) throw new Error('Multithreading not yet implemented');
    if (maxEntities > MAX_NUM_ENTITIES) {
      throw new Error(`maxEntities too high, the limit is ${MAX_NUM_ENTITIES}`);
    }
    const {componentTypes, systemTypes, systemGroups} =
      this.splitDefs([defs ?? [], decoratedComponentTypes, decoratedSystemTypes]);
    if (componentTypes.length > MAX_NUM_COMPONENTS) {
      throw new Error(`Too many component types, the limit is ${MAX_NUM_COMPONENTS}`);
    }
    STATS: this.stats = new Stats();
    this.threaded = threads > 1;
    this.buffers = new Buffers(threads > 1);
    this.maxEntities = maxEntities;
    this.defaultComponentStorage = defaultComponentStorage;
    this.shapeLog = new Log(maxShapeChangesPerFrame, 'maxShapeChangesPerFrame', this.buffers);
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.registry = new Registry(maxEntities, maxLimboComponents, componentTypes, this);
    this.indexer = new RefIndexer(this, maxRefChangesPerFrame);
    this.registry.initializeComponentTypes();
    this.systems = this.normalizeAndInitSystems(systemTypes);
    this.systemGroups = this.initSystemGroups(systemGroups);
    if (this.systems.some(system => system.hasWriteQueries)) {
      this.writeLog = new Log(maxWritesPerFrame, 'maxWritesPerFrame', this.buffers);
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
    for (const box of this.systems) box.finishConstructing();
    this.userCallbackSystem = new CallbackSystem();
    this.callbackSystem = new SystemBox(this.userCallbackSystem, this);
    this.callbackSystem.rwMasks.read = undefined;
    this.callbackSystem.rwMasks.write = undefined;
  }

  private normalizeAndInitSystems(
    systemTypes: (SystemType<System> | Record<string, unknown>)[]
  ): SystemBox[] {
    const systems = [];
    const systemClasses = [];
    for (let i = 0; i < systemTypes.length; i++) {
      const SystemClass = systemTypes[i] as SystemType<System>;
      CHECK: if (this.systemsByClass.has(SystemClass)) {
        throw new Error(`System ${SystemClass.name} included multiple times in world defs`);
      }
      systemClasses.push(SystemClass);
      const system = new SystemClass();
      const props = systemTypes[i + 1];
      if (props && typeof props !== 'function') {
        Object.assign(system, props);
        i++;
      }
      const box = new SystemBox(system, this);
      systems.push(box);
      this.systemsByClass.set(SystemClass, box);
    }
    return systems;
  }

  private initSystemGroups(systemGroups: SystemGroup[]): SystemGroup[] {
    for (const group of systemGroups) initSystemGroup(group, this);
    return systemGroups;
  }

  private splitDefs(defs: DefsArray): {
    componentTypes: ComponentType<any>[],
    systemTypes: (SystemType<System> | Record<string, unknown>)[],
    systemGroups: SystemGroupImpl[]
  } {
    const componentTypes: ComponentType<any>[] = [];
    const systemTypes: (SystemType<System> | Record<string, unknown>)[] = [];
    const systemGroups: SystemGroupImpl[] = [];
    let lastDefWasSystem = false;
    for (const def of defs.flat(Infinity) as DefElement[]) {
      if (def instanceof SystemGroupImpl) {
        systemGroups.push(def);
        const {
          componentTypes: nestedComponentTypes,
          systemTypes: nestedSystemTypes,
          systemGroups: nestedSystemGroups
        } = this.splitDefs(def.__contents);
        componentTypes.push(...nestedComponentTypes);
        systemTypes.push(...nestedSystemTypes);
        systemGroups.push(...nestedSystemGroups);
      } else if (typeof def === 'function') {
        lastDefWasSystem = !!(def as any).__system;
        if (lastDefWasSystem) {
          systemTypes.push(def as SystemType<any>);
        } else {
          componentTypes.push(def);
        }
      } else {
        CHECK: if (!lastDefWasSystem) throw new Error('Unexpected value in world defs: ' + def);
        systemTypes.push(def);
        lastDefWasSystem = false;
      }
    }
    return {componentTypes, systemTypes, systemGroups};
  }

  async initialize(): Promise<void> {
    await Promise.all(this.systems.map(system => system.initialize()));
  }

  async execute(time?: number, delta?: number): Promise<void> {
    // This largely duplicates the code in Frame, but we lose 5-10% performance by delegating to it
    // so duplicate the code here instead.
    // TODO: migrate to use the Frame system without loss of performance
    CHECK: if (this.executing) throw new Error('Recursive system execution not allowed');
    this.executing = true;
    if (time === undefined) time = now() / 1000;
    if (delta === undefined) delta = time - this.lastTime;
    this.lastTime = time;
    for (const system of this.systems) {
      this.registry.executingSystem = system;
      system.execute(time, delta);
      this.flush();
    }
    this.registry.executingSystem = undefined;
    this.executing = false;
    this.completeCycle();
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
    this.executing = false;
    this.completeCycle();
    this.completeFrame();
  }

  completeCycle(): void {
    this.registry.completeCycle();
    this.indexer.completeCycle();
  }

  completeFrame(): void {
    STATS: this.gatherFrameStats();
    this.processDeferredControls();
  }

  gatherFrameStats(): void {
    this.stats.frames += 1;
    this.stats.maxShapeChangesPerFrame = this.shapeLog.countSince(this.shapeLogFramePointer);
    this.stats.maxWritesPerFrame = this.writeLog?.countSince(this.writeLogFramePointer!) ?? 0;
  }

  flush(): void {
    this.registry.flush();
    this.indexer.flush();  // may update writeLog
    this.shapeLog.commit();
    this.writeLog?.commit();
  }

  createEntity(initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    const entity = this.registry.createEntity(initialComponents);
    if (!this.executing) this.flush();
    return entity;
  }

  control(options: ControlOptions): void {
    CHECK: this.checkControlOverlap(options);
    this.deferRequestedRunState(options.stop, RunState.STOPPED);
    this.deferRequestedRunState(options.restart, RunState.RUNNING);
    if (!this.executing) this.processDeferredControls();
  }

  private deferRequestedRunState(defs: DefsArray, state: RunState): void {
    for (const def of this.splitDefs(defs).systemTypes) {
      if (!def.__system) continue;
      const system = this.systemsByClass.get(def as SystemType<System>);
      CHECK: if (!system) throw new Error(`System ${def.name} not defined for this world`);
      this.deferredControls!.set(system, state);
    }
  }

  private checkControlOverlap(options: ControlOptions): void {
    const stopSet = new Set<SystemType<System>>();
    for (const def of this.splitDefs(options.stop).systemTypes) {
      if (def.__system) stopSet.add(def as SystemType<System>);
    }
    for (const def of this.splitDefs(options.restart).systemTypes) {
      if (!def.__system) continue;
      if (stopSet.has(def as SystemType<System>)) {
        throw new Error(`Request to both stop and restart system ${def.name}`);
      }
    }
  }

  processDeferredControls(): void {
    if (!this.deferredControls.size) return;
    for (const [system, state] of this.deferredControls.entries()) {
      switch (state) {
        case RunState.STOPPED: system.stop(); break;
        case RunState.RUNNING: system.restart(); break;
      }
    }
    this.deferredControls.clear();
  }
}
