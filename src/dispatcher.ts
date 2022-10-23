import type {ComponentStorage, ComponentType} from './component';
import {Entity, EntityId, extendMaskAndSetFlag} from './entity';
import {MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES, MAX_NUM_LANES} from './consts';
import {Log, LogPointer} from './datatypes/log';
import {RunState, System, SystemBox, SystemId, SystemType} from './system';
import {Registry} from './registry';
import {Stats} from './stats';
import {RefIndexer} from './refindexer';
import {Buffers, Patch} from './buffers';
import {
  componentTypes as decoratedComponentTypes, systemTypes as decoratedSystemTypes
} from './decorators';
import {Frame, FrameImpl, SystemGroup, SystemGroupImpl} from './schedule';
import {Planner} from './planner';
import type {Coroutine, CoroutineFunction} from './coroutines';
import {CheckError, InternalError} from './errors';
import type {Director} from './workers';
import {ComponentEnum} from './enums';


// TODO: figure out a better type for interleaved arrays, here and elsewhere
// https://stackoverflow.com/questions/67467302/type-for-an-interleaved-array-of-classes-and-values
type DefElement =
  ComponentType<any> | SystemType<System> | Record<string, unknown> | SystemGroup | ComponentEnum;
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

  /**
   * The maximum number of threads to use simultaneously when executing systems.  If set to 0 or
   * below, it's interpreted as an offset from the browser's reported number of available cores. (So
   * `-1` would request the use of all but one core.)  The number defaults to 1, i.e. the thread
   * where you created the world.
   *
   * If the number of threads is more than 1, one of the threads will be the browser's main (window)
   * thread.  Only systems that must run on the main thread will be allocated to it; if that's not
   * enough to keep the thread busy then it'll stay idle and the cores may be under-utilized.  If
   * you know this is the case for your systems you can always request one more thread than there
   * are cores.
   *
   * If more than one thread is requested, creating the world will automatically allocate multiple
   * workers.  You must specify the {@link WorldOptions.workerPath}.
   *
   * If you requested more than one thread then you need to explicitly {@link World.terminate} the
   * world to deallocate the workers (unless you just exit the process / page).
   */
  threads?: number;

  /**
   * The path from which to load the code for workers.  On Node, you can use the `__filename` of
   * your main module to load the same code as the main thread. In a browser you must provide a path
   * that points to a script of the appropriate type based on {@link workerModule}.
   *
   * It is crucial that the code referenced by this path initialize the world with *exactly* the
   * same options.  Ideally, you'd load the same code as in the main thread and use
   * {@link World.onMainThread} to limit your world setup and execution code to the main thread
   * only.
   */
  workerPath?: string;

  /**
   * Whether the {@link workerPath} points to a modern module, or to a classic non-module script.
   */
  workerModule?: boolean;

  maxEntities?: number;
  maxLimboComponents?: number;
  maxRefChangesPerFrame?: number;
  maxShapeChangesPerFrame?: number;
  maxWritesPerFrame?: number;
  defaultComponentStorage?: ComponentStorage;
}


export interface DispatcherOptions {
  isDirector?: boolean;
  isLaborer?: boolean;
  director?: Director;
  assignedSystemIds?: Set<SystemId>;
  singletonId?: EntityId;
  buffersPatch?: Patch;
  laneId?: number;
  hasNegativeQueries?: boolean;
  hasWriteQueries?: boolean;
}


export interface DispatcherCore {
  state: State;
  stats: Stats;
  initialize(): Promise<void>;
  execute(time?: number, delta?: number): Promise<void>;
  executeFunction(fn: (system: System) => void): void;
  createEntity(initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity;
  terminate(): void;
  control(options: ControlOptions): void;
  createCustomExecutor(groups: SystemGroup[]): Frame;
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

class Build extends System {
  static __internal = true;
  __callback: (system: System) => void;

  start<CoFn extends CoroutineFunction>(coroutineFn: CoFn, ...args: Parameters<CoFn>): Coroutine {
    CHECK: throw new CheckError('The build system cannot run coroutines');
  }

  execute() {
    this.__callback(this);
  }
}

class Validate extends System {
  static __internal = true;
}

export enum State {
  init = 0, setup, run, finish, done
}


export class Dispatcher {
  readonly maxEntities;
  readonly defaultComponentStorage;
  readonly registry;
  readonly systems: SystemBox[];
  readonly systemsByClass = new Map<SystemType<System>, SystemBox>();
  readonly systemsById: SystemBox[] = [];
  readonly systemGroups: SystemGroup[];
  private default: {group: SystemGroup, frame: Frame};
  lastTime: number;
  executing: boolean;
  private executingSyncFrame: boolean;
  state = State.init;
  readonly shapeLog: Log;
  readonly writeLog?: Log;
  private readonly shapeLogFramePointer: LogPointer;
  private readonly writeLogFramePointer?: LogPointer;
  readonly stats;
  readonly indexer: RefIndexer;
  readonly planner: Planner;
  readonly threads: number;
  readonly buffers: Buffers;
  readonly singleton?: Entity;
  readonly hasWriteQueries: boolean;
  private buildSystem: Build;
  private readonly deferredControls = new Map<SystemBox, RunState>();

  constructor(
    {
      defs,
      threads = 1,
      maxEntities = 10000,
      maxLimboComponents = Math.ceil(maxEntities / 5),
      maxShapeChangesPerFrame = maxEntities * 2,
      maxWritesPerFrame = maxEntities * 4,
      maxRefChangesPerFrame = maxEntities,
      defaultComponentStorage = 'packed'
    }: WorldOptions, {
      isDirector,
      isLaborer,
      director,
      assignedSystemIds,
      singletonId,
      laneId,
      hasNegativeQueries,
      hasWriteQueries,
      buffersPatch
    }: DispatcherOptions
  ) {
    CHECK: {
      if (threads < 1) throw new Error('Minimum of one thread');
      if (threads > MAX_NUM_LANES) {
        throw new Error(`Too many threads: ${threads} > ${MAX_NUM_LANES}`);
      }
      if (maxEntities > MAX_NUM_ENTITIES) {
        throw new Error(`maxEntities too high, the limit is ${MAX_NUM_ENTITIES}`);
      }
    }
    DEBUG: {
      if (!isDirector && !isLaborer || (threads === 1) !== (isDirector && isLaborer)) {
        throw new InternalError(`Invalid dispatcher configuration`);
      }
    }
    const {componentTypes, componentEnums, systemTypes, systemGroups} =
      this.splitDefs([defs ?? [], decoratedComponentTypes, decoratedSystemTypes]);
    CHECK: {
      if (componentTypes.length > MAX_NUM_COMPONENTS) {
        throw new Error(`Too many component types, the limit is ${MAX_NUM_COMPONENTS}`);
      }
    }
    STATS: this.stats = new Stats();
    this.threads = threads;
    this.buffers = new Buffers(isDirector ? (isLaborer ? 0 : threads) : 1, laneId);
    if (buffersPatch) this.buffers.applyPatch(buffersPatch, false);
    this.maxEntities = maxEntities;
    this.defaultComponentStorage = defaultComponentStorage;
    const removalLog = new Log(
      maxLimboComponents, 'maxLimboComponents', this.buffers, {writesAllowed: isLaborer});
    this.registry = new Registry(maxEntities, componentTypes, componentEnums, removalLog, this);
    this.indexer = new RefIndexer(this, maxRefChangesPerFrame, !(isDirector && isLaborer), laneId);
    this.shapeLog = new Log(maxShapeChangesPerFrame, 'maxShapeChangesPerFrame', this.buffers, {
      writesAllowed: isLaborer, sortedByComponentType: true,
      numComponentTypes: this.registry.types.length
    });
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.systemGroups = systemGroups;
    this.systems = this.createSystems(systemTypes, assignedSystemIds);
    if (laneId === 0) this.createBuildSystem();
    this.registry.initializeComponentTypes();
    this.registry.validateSystem = this.createValidateSystem(componentTypes);
    if (isDirector) {
      this.singleton = this.createSingletons();
    } else if (singletonId) {
      this.singleton = this.registry.holdEntity(singletonId);
    }
    if (isLaborer) {
      for (const box of this.systems) box.replacePlaceholders();
    }
    if (isDirector) {
      this.planner = new Planner(this, this.systems, this.systemGroups, director);
      this.planner.organize();
    }
    if (hasNegativeQueries === undefined) {
      hasNegativeQueries = this.systems.some(system => system.hasNegativeQueries);
    }
    this.registry.hasNegativeQueries = hasNegativeQueries;
    if (hasWriteQueries === undefined) {
      hasWriteQueries = this.systems.some(system => system.hasWriteQueries);
    }
    this.hasWriteQueries = hasWriteQueries;
    if (hasWriteQueries) {
      this.writeLog = new Log(maxWritesPerFrame, 'maxWritesPerFrame', this.buffers, {
        writesAllowed: isLaborer, sortedByComponentType: true,
        numComponentTypes: this.registry.types.length
      });
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
    if (isLaborer) {
      for (const box of this.systems) box.finishConstructing();
    }
    this.state = State.setup;
  }

  get threaded(): boolean {return this.threads > 1;}

  get defaultGroup(): SystemGroup {return this.default.group;}

  private createSystems(
    systemTypes: (SystemType<System> | Record<string, unknown>)[],
    assignedSystemIds?: Set<SystemId>
  ): SystemBox[] {
    const systems = [];
    const systemClasses = [];
    const typeNames = new Set<string>();
    let anonymousTypeCounter = 0;
    for (let i = 0; i < systemTypes.length; i++) {
      if (assignedSystemIds && !assignedSystemIds.has((i + 1) as SystemId)) continue;
      const SystemClass = systemTypes[i] as SystemType<System>;
      let box = this.systemsByClass.get(SystemClass);
      if (!box) {
        if (!SystemClass.name) {
          Object.defineProperty(
            SystemClass, 'name', {value: `Anonymous_${anonymousTypeCounter++}`});
        }
        CHECK: if (!SystemClass.__internal) {
          if (typeNames.has(SystemClass.name)) {
            throw new CheckError(
              `Multiple component types named ${SystemClass.name}; names must be unique`);
          }
          typeNames.add(SystemClass.name);
        }
        STATS: this.stats.forSystem(SystemClass);
        systemClasses.push(SystemClass);
        const system = new SystemClass();
        system.id = (i + 2) as SystemId;  // 0 and 1 are reserved for internal systems
        box = new SystemBox(system, this);
        systems.push(box);
        this.systemsByClass.set(SystemClass, box);
        this.systemsById[system.id] = box;
      }
      const props = systemTypes[i + 1];
      if (props && typeof props !== 'function') {
        box.assignProps(props);
        i++;
      }
    }
    this.default = this.createSingleGroupFrame(systemClasses);
    return systems;
  }

  private createBuildSystem(): void {
    this.buildSystem = new Build();
    this.buildSystem.id = 0 as SystemId;
    const box = new SystemBox(this.buildSystem, this);
    box.accessMasks.read = undefined;
    box.accessMasks.update = undefined;
    box.accessMasks.create = undefined;
    box.accessMasks.write = undefined;
    box.accessMasks.check = undefined;
    this.systems.push(box);
    this.systemsByClass.set(Build, box);
  }

  private createValidateSystem(componentTypes: ComponentType<any>[]): SystemBox {
    const system = new Validate();
    system.id = 1 as SystemId;
    const box = new SystemBox(system, this);
    for (const type of componentTypes) extendMaskAndSetFlag(box.accessMasks.check!, type);
    this.systems.push(box);
    this.systemsByClass.set(Validate, box);
    return box;
  }

  private createSingleGroupFrame(
      systemTypes: SystemType<System>[]): {group: SystemGroup, frame: Frame} {
    const group = new SystemGroupImpl(systemTypes);
    this.systemGroups.push(group);
    const frame = new FrameImpl(this, [group]);
    return {group, frame};
  }

  private createSingletons(): Entity | undefined {
    const types = new Set<ComponentType<any>>();
    const singletonComponentDefs =
      this.systems.flatMap(box => {
        return box.singletonComponentDefs.filter((item, i) => {
          let accepted = true;
          if (typeof item === 'function') {
            accepted = i < box.singletonComponentDefs.length - 1 &&
              typeof box.singletonComponentDefs[i + 1] !== 'function';
            if (accepted) types.add(item);
          }
          return accepted;
        });
      }).concat(this.systems.flatMap(box => {
        return box.singletonComponentDefs.filter(item => {
          if (typeof item === 'function' && !types.has(item)) {
            types.add(item);
            return true;
          }
          return false;
        });
      }));
    if (!singletonComponentDefs.length) return;
    this.executing = true;
    const singleton = this.createEntity(singletonComponentDefs).hold();
    this.executing = false;
    this.flush();
    return singleton;
  }

  private splitDefs(defs: DefsArray): {
    componentTypes: ComponentType<any>[],
    componentEnums: ComponentEnum[],
    systemTypes: (SystemType<System> | Record<string, unknown>)[],
    systemGroups: SystemGroupImpl[]
  } {
    const componentTypes: ComponentType<any>[] = [];
    const componentTypesSet = new Set<ComponentType<any>>();
    const componentEnums = new Set<ComponentEnum>();
    const systemTypes: (SystemType<System> | Record<string, unknown>)[] = [];
    const systemGroups: SystemGroupImpl[] = [];
    let lastDefWasSystem = false;
    for (const def of (defs as any).flat(Infinity) as DefElement[]) {
      if (def instanceof SystemGroupImpl) {
        systemGroups.push(def);
        const {
          componentTypes: nestedComponentTypes,
          systemTypes: nestedSystemTypes,
          systemGroups: nestedSystemGroups
        } = this.splitDefs(def.__contents);
        for (const type of nestedComponentTypes) addUniqueComponentType(type);
        systemTypes.push(...nestedSystemTypes);
        systemGroups.push(...nestedSystemGroups);
      } else if (typeof def === 'function') {
        lastDefWasSystem = !!(def as any).__system;
        if (lastDefWasSystem) {
          systemTypes.push(def as SystemType<any>);
        } else {
          addUniqueComponentType(def);
        }
      } else if (def instanceof ComponentEnum) {
        componentEnums.add(def);
        for (const type of def.__types) addUniqueComponentType(type);
      } else {
        CHECK: {
          if (!lastDefWasSystem) throw new CheckError('Unexpected value in world defs: ' + def);
        }
        systemTypes.push(def);
        lastDefWasSystem = false;
      }
    }
    return {componentTypes, componentEnums: Array.from(componentEnums), systemTypes, systemGroups};

    function addUniqueComponentType(type: ComponentType<any>) {
      if (type.enum && !componentEnums.has(type.enum)) {
        componentEnums.add(type.enum);
        for (const enumType of type.enum.__types) addUniqueComponentType(enumType);
      } else if (!componentTypesSet.has(type)) {
        componentTypes.push(type);
        componentTypesSet.add(type);
      }
    }
  }

  getSystems(designator: SystemType<System> | SystemGroup): SystemBox[] {
    if (designator instanceof SystemGroupImpl) return designator.__systems;
    const system = this.systemsByClass.get(designator);
    if (!system) throw new CheckError(`System ${designator.name} not registered in world`);
    return [system];
  }

  async initialize(): Promise<void> {
    await this.default.frame.begin();
    this.state = State.setup;
    await this.default.group.__plan.initialize();
    await this.default.frame.end();
    STATS: this.stats.frames -= 1;
  }

  private async finalize(): Promise<void> {
    await this.default.frame.begin();
    this.state = State.done;
    // Don't await anything else after this, as in multi-threaded mode we'll shut down before we get
    // to it!
    await this.default.group.__plan.finalize();
    await this.default.frame.end();
    STATS: this.stats.frames -= 1;
    this.release();
  }

  release(): void {
    this.registry.releaseComponentTypes();
  }

  initializeLaborerSystem(system: SystemBox): void {
    this.executing = true;
    this.indexer.processLog();
    system.initialize();
    this.flushLaborer();
    this.executing = false;
  }

  executeLaborerSystem(system: SystemBox, time: number, delta: number): void {
    this.executing = true;
    this.indexer.processLog();
    system.execute(time, delta);
    this.flushLaborer();
    this.executing = false;
  }

  finalizeLaborerSystem(system: SystemBox): void {
    this.executing = true;
    this.indexer.processLog();
    system.finalize();
    this.flushLaborer();
    this.executing = false;
  }

  async execute(time?: number, delta?: number): Promise<void> {
    await this.default.frame.begin();
    await this.default.frame.execute(this.default.group, time, delta);
    await this.default.frame.end();
  }

  executeFunction(fn: (system: System) => void): void {
    // This inlines the code for Frame begin/execute/end to make it synchronous.
    this.startFrame(this.lastTime);
    CHECK: this.executingSyncFrame = true;
    this.buildSystem.__callback = fn;
    this.systemsByClass.get(Build)!.execute(this.lastTime, 0);
    this.flush();
    this.completeCycle();
    this.completeFrame();  // async only if termination pending, but it's forbidden in this context
    CHECK: this.executingSyncFrame = false;
    // This is not really a frame, so back out the count.
    STATS: this.stats.frames -= 1;
  }

  completeCycle(): void {
    this.registry.completeCycle();  // may update writeLog
    this.indexer.completeCycle();
    this.writeLog?.commit();
  }

  startFrame(time: number): void {
    CHECK: if (this.executing) throw new CheckError('Another frame already executing');
    this.executing = true;
    CHECK: {
      if (this.state !== State.setup && this.state !== State.run && this.state !== State.finish) {
        throw new CheckError('World terminated');
      }
    }
    this.state = State.run;
    this.lastTime = time;
  }

  completeFrame(): Promise<void> {
    DEBUG: if (!this.executing) throw new InternalError('No frame executing');
    this.executing = false;
    STATS: this.gatherFrameStats();
    this.processDeferredControls();
    if (this.state === State.finish) return this.finalize();
    return Promise.resolve();
  }

  gatherFrameStats(): void {
    this.stats.frames += 1;
    this.stats.maxShapeChangesPerFrame = this.shapeLog.countSince(this.shapeLogFramePointer);
    this.stats.maxWritesPerFrame = this.writeLog?.countSince(this.writeLogFramePointer!) ?? 0;
  }

  flush(): void {
    this.registry.flush();
    this.shapeLog.commit();
    this.writeLog?.commit();
  }

  async terminate(): Promise<void> {
    CHECK: {
      if (this.state !== State.setup && this.state !== State.run) {
        throw new CheckError('World terminated');
      }
      if (this.executingSyncFrame) {
        throw new CheckError('Cannot terminate world from within build callback');
      }
    }
    this.state = State.finish;
    if (!this.executing) await this.finalize();
  }

  flushLaborer(): void {
    this.registry.flushLaborer();
    this.shapeLog.sortCorral();
    this.writeLog?.sortCorral();
  }

  flushDirector(laneId: number): void {
    this.registry.flushDirector(laneId);
    this.indexer.flushDirector(laneId);
    this.shapeLog.commit(laneId);
    this.writeLog?.commit(laneId);
  }

  createEntity(initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    const entity = this.registry.createEntity(initialComponents);
    if (!this.executing) this.flush();
    return entity;
  }

  createCustomExecutor(groups: SystemGroup[]): Frame {
    return new FrameImpl(this, groups);
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
      CHECK: if (!system) throw new CheckError(`System ${def.name} not defined for this world`);
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
        throw new CheckError(`Request to both stop and restart system ${def.name}`);
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
