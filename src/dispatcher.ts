import type {ComponentStorage, ComponentType} from './component';
import type {Entity} from './entity';
import {MAX_NUM_COMPONENTS, MAX_NUM_ENTITIES} from './consts';
import {Log, LogPointer} from './datatypes/log';
import {RunState, System, SystemBox, SystemId, SystemType} from './system';
import {Registry} from './registry';
import {Stats} from './stats';
import {RefIndexer} from './refindexer';
import {Buffers} from './buffers';
import {
  componentTypes as decoratedComponentTypes, systemTypes as decoratedSystemTypes
} from './decorators';
import {Frame, FrameImpl, SystemGroup, SystemGroupImpl} from './schedule';
import {Planner} from './planner';


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


export class Dispatcher {
  readonly maxEntities;
  readonly defaultComponentStorage;
  readonly registry;
  private readonly systems: SystemBox[];
  readonly systemsByClass = new Map<SystemType<System>, SystemBox>();
  readonly systemGroups: SystemGroup[];
  private default: {group: SystemGroup, frame: Frame};
  lastTime: number;
  executing: boolean;
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
  private userCallbackSystem: CallbackSystem;
  private callback: {group: SystemGroup, frame: Frame};
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
    this.threads = threads;
    this.buffers = new Buffers(threads > 1);
    this.maxEntities = maxEntities;
    this.defaultComponentStorage = defaultComponentStorage;
    this.registry = new Registry(maxEntities, maxLimboComponents, componentTypes, this);
    this.indexer = new RefIndexer(this, maxRefChangesPerFrame);
    this.shapeLog = new Log(
      maxShapeChangesPerFrame, 'maxShapeChangesPerFrame', this.buffers,
      {sortedByComponentType: true, numComponentTypes: this.registry.types.length}
    );
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.systemGroups = systemGroups;
    this.systems = this.createSystems(systemTypes);
    this.createCallbackSystem();
    this.registry.initializeComponentTypes();
    this.registry.hasNegativeQueries = this.systems.some(system => system.hasNegativeQueries);
    this.singleton = this.createSingletons();
    for (const box of this.systems) box.replacePlaceholders();
    this.planner = new Planner(this, this.systems, this.systemGroups);
    this.planner.organize();
    if (this.systems.some(system => system.hasWriteQueries)) {
      this.writeLog = new Log(
        maxWritesPerFrame, 'maxWritesPerFrame', this.buffers,
        {sortedByComponentType: true, numComponentTypes: this.registry.types.length}
      );
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
    for (const box of this.systems) box.finishConstructing();
  }

  get threaded(): boolean {return this.threads > 1;}

  private createSystems(
    systemTypes: (SystemType<System> | Record<string, unknown>)[]
  ): SystemBox[] {
    const systems = [];
    const systemClasses = [];
    for (let i = 0; i < systemTypes.length; i++) {
      const SystemClass = systemTypes[i] as SystemType<System>;
      let box = this.systemsByClass.get(SystemClass);
      if (!box) {
        systemClasses.push(SystemClass);
        const system = new SystemClass();
        system.id = (i + 1) as SystemId;  // 0 is reserved for the callback system
        box = new SystemBox(system, this);
        systems.push(box);
        this.systemsByClass.set(SystemClass, box);
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

  private createCallbackSystem(): void {
    this.userCallbackSystem = new CallbackSystem();
    this.userCallbackSystem.id = 0 as SystemId;
    const box = new SystemBox(this.userCallbackSystem, this);
    box.rwMasks.read = undefined;
    box.rwMasks.write = undefined;
    this.systems.push(box);
    this.systemsByClass.set(CallbackSystem, box);
    this.callback = this.createSingleGroupFrame([CallbackSystem]);
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
    systemTypes: (SystemType<System> | Record<string, unknown>)[],
    systemGroups: SystemGroupImpl[]
  } {
    const componentTypes: ComponentType<any>[] = [];
    const componentTypesSet = new Set<ComponentType<any>>();
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
        } else if (!componentTypesSet.has(def)) {
          componentTypes.push(def);
          componentTypesSet.add(def);
        }
      } else {
        CHECK: if (!lastDefWasSystem) throw new Error('Unexpected value in world defs: ' + def);
        systemTypes.push(def);
        lastDefWasSystem = false;
      }
    }
    return {componentTypes, systemTypes, systemGroups};
  }

  getSystems(designator: SystemType<System> | SystemGroup): SystemBox[] {
    if (designator instanceof SystemGroupImpl) return designator.__systems;
    const system = this.systemsByClass.get(designator);
    if (!system) throw new Error(`System ${designator.name} not registered in world`);
    return [system];
  }

  async initialize(): Promise<void> {
    this.default.frame.begin();
    await this.default.group.__plan.initialize();
    this.default.frame.end();
    STATS: this.stats.frames -= 1;
  }

  async execute(time?: number, delta?: number): Promise<void> {
    this.default.frame.begin();
    await this.default.frame.execute(this.default.group, time, delta);
    this.default.frame.end();
  }

  executeFunction(fn: (system: System) => void): void {
    this.callback.frame.begin();
    this.userCallbackSystem.__callback = fn;
    // We know this execution will always be synchronous.
    this.callback.frame.execute(this.callback.group, 0, 0);
    this.callback.frame.end();
    // This is not really a frame, so back out the count.
    STATS: this.stats.frames -= 1;
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
