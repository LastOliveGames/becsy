import type {ComponentStorage, ComponentType} from './component';
import {Entity, extendMaskAndSetFlag} from './entity';
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
import type {Coroutine, CoroutineFunction} from './coroutines';
import {CheckError, InternalError} from './errors';
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

class Build extends System {
  __callback: (system: System) => void;

  start<CoFn extends CoroutineFunction>(coroutineFn: CoFn, ...args: Parameters<CoFn>): Coroutine {
    CHECK: throw new CheckError('The build system cannot run coroutines');
  }

  execute() {
    this.__callback(this);
  }
}

class Validate extends System {
}

export enum State {
  init = 0, setup, run, finish, done
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
  private buildSystem: Build;
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
    if (threads < 1) throw new CheckError('Minimum of one thread');
    if (threads > 1) throw new CheckError('Multithreading not yet implemented');
    if (maxEntities > MAX_NUM_ENTITIES) {
      throw new CheckError(`maxEntities too high, the limit is ${MAX_NUM_ENTITIES}`);
    }
    const {componentTypes, componentEnums, systemTypes, systemGroups} =
      this.splitDefs([defs ?? [], decoratedComponentTypes, decoratedSystemTypes]);
    if (componentTypes.length > MAX_NUM_COMPONENTS) {
      throw new CheckError(`Too many component types, the limit is ${MAX_NUM_COMPONENTS}`);
    }
    STATS: this.stats = new Stats();
    this.threads = threads;
    this.buffers = new Buffers(threads > 1);
    this.maxEntities = maxEntities;
    this.defaultComponentStorage = defaultComponentStorage;
    this.registry =
      new Registry(maxEntities, maxLimboComponents, componentTypes, componentEnums, this);
    this.indexer = new RefIndexer(this, maxRefChangesPerFrame);
    this.shapeLog = new Log(
      maxShapeChangesPerFrame, 'maxShapeChangesPerFrame', this.buffers,
      {sortedByComponentType: true, numComponentTypes: this.registry.types.length}
    );
    this.shapeLogFramePointer = this.shapeLog.createPointer();
    this.systemGroups = systemGroups;
    this.systems = this.createSystems(systemTypes);
    this.createBuildSystem();
    this.registry.initializeComponentTypes();
    this.registry.validateSystem = this.createValidateSystem(componentTypes);
    this.singleton = this.createSingletons();
    for (const box of this.systems) box.replacePlaceholders();
    this.planner = new Planner(this, this.systems, this.systemGroups);
    this.planner.organize();
    this.registry.hasNegativeQueries = this.systems.some(system => system.hasNegativeQueries);
    if (this.systems.some(system => system.hasWriteQueries)) {
      this.writeLog = new Log(
        maxWritesPerFrame, 'maxWritesPerFrame', this.buffers,
        {sortedByComponentType: true, numComponentTypes: this.registry.types.length}
      );
      this.writeLogFramePointer = this.writeLog.createPointer();
    }
    for (const box of this.systems) box.finishConstructing();
    this.state = State.setup;
  }

  get threaded(): boolean {return this.threads > 1;}

  get defaultGroup(): SystemGroup {return this.default.group;}

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
        system.id = (i + 2) as SystemId;  // 0 and 1 are reserved for internal systems
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

  private createBuildSystem(): void {
    this.buildSystem = new Build();
    this.buildSystem.id = 0 as SystemId;
    const box = new SystemBox(this.buildSystem, this);
    box.accessMasks.read = undefined;
    box.accessMasks.create = undefined;
    box.accessMasks.write = undefined;
    box.accessMasks.check = undefined;
    this.systems.push(box);
    this.systemsByClass.set(Build, box);
    this.callback = this.createSingleGroupFrame([Build]);
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
    for (const def of defs.flat(Infinity) as DefElement[]) {
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
    this.default.frame.begin();
    this.state = State.setup;
    await this.default.group.__plan.initialize();
    this.default.frame.end();
    STATS: this.stats.frames -= 1;
  }

  private async finalize(): Promise<void> {
    this.default.frame.begin();
    this.state = State.done;
    await this.default.group.__plan.finalize();
    this.default.frame.end();
    STATS: this.stats.frames -= 1;
    this.registry.releaseComponentTypes();
  }

  async execute(time?: number, delta?: number): Promise<void> {
    this.default.frame.begin();
    await this.default.frame.execute(this.default.group, time, delta);
    this.default.frame.end();
  }

  executeFunction(fn: (system: System) => void): void {
    this.callback.frame.begin();
    this.buildSystem.__callback = fn;
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

  async completeFrame(): Promise<void> {
    DEBUG: if (!this.executing) throw new InternalError('No frame executing');
    this.executing = false;
    STATS: this.gatherFrameStats();
    this.processDeferredControls();
    if (this.state === State.finish) await this.finalize();
  }

  gatherFrameStats(): void {
    this.stats.frames += 1;
    this.stats.maxShapeChangesPerFrame = this.shapeLog.countSince(this.shapeLogFramePointer);
    this.stats.maxWritesPerFrame = this.writeLog?.countSince(this.writeLogFramePointer!) ?? 0;
  }

  flush(): void {
    this.indexer.flush();  // may update writeLog
    this.registry.flush();
    this.shapeLog.commit();
    this.writeLog?.commit();
  }

  async terminate(): Promise<void> {
    CHECK: {
      if (this.state !== State.setup && this.state !== State.run) {
        throw new CheckError('World terminated');
      }
    }
    this.state = State.finish;
    if (!this.executing) await this.finalize();
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
