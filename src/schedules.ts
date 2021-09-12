import type {Component, ComponentType} from './component';
import {Graph} from './datatypes/graph';
import type {Dispatcher} from './dispatcher';
import type {System, SystemBox, SystemType} from './system';

const now = typeof window !== 'undefined' && typeof window.performance !== 'undefined' ?
  performance.now.bind(performance) : Date.now.bind(Date);


/**
 * A fluent DSL for specifying a system's scheduling constraints.
 *
 * Any given pair of systems will be ordered by the first of the following rules that matches:
 * 1. A system was explicitly placed `before` or `after` another.
 * 2. A system was explicitly left unordered with respect to another using `inAnyOrderWith`.
 * 3. A system was implicitly placed before or after another system based on the components the
 *    other system reads or writes, using `beforeReadsFrom`, `afterReadsFrom`, `beforeWritesTo` or
 *    `afterWritesTo`.
 * 4. A system was implicitly placed after another because it reads a component that the other
 *    system writes.
 *
 * If there are multiple constraints at the same priority level they will conflict and create a
 * cycle.  If there are any cycles in the order graph (whether due to explicit conflicts or implicit
 * circular dependencies), world creation will fail with an informative error and you'll need to
 * break the cycles by adding scheduling constraints to the systems involved.
 */
export class ScheduleBuilder {
  private __systems: SystemBox[];
  private __dispatcher: Dispatcher;

  constructor(
    private readonly __callback: (s: ScheduleBuilder) => void,
    private readonly __schedule: Schedule
  ) {}

  __build(systems: SystemBox[], name: string): void {
    try {
      this.__systems = systems;
      this.__dispatcher = systems[0].dispatcher;
      this.__callback(this);
    } catch (e: any) {
      e.message = `Failed to build schedule in ${name}: ${e.message}`;
      throw e;
    }
  }

  /**
   * Schedule this system before all the given ones (highest priority).
   * @param systemTypes The systems or groups that this one should precede.
   * @returns The builder for chaining calls.
   */
  before(...systemTypes: (SystemType<System> | SystemGroup)[]): this {
    for (const type of systemTypes) {
      for (const other of this.__dispatcher.getSystems(type)) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.addEdge(system, other, 4);
        }
      }
    }
    return this;
  }

  /**
   * Schedule this system after all the given ones (highest priority).
   * @param systemTypes The systems or groups that this one should follow.
   * @returns The builder for chaining calls.
   */
  after(...systemTypes: (SystemType<System> | SystemGroup)[]): this {
    for (const type of systemTypes) {
      for (const other of this.__dispatcher.getSystems(type)) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.addEdge(other, system, 4);
        }
      }
    }
    return this;
  }

  /**
   * Schedule this system in any order relative to the given ones (high priority).
   * @param systemTypes The systems or groups whose order doesn't matter relative to this one.
   * @returns The builder for chaining calls.
   */
  inAnyOrderWith(...systemTypes: (SystemType<System> | SystemGroup)[]): this {
    for (const type of systemTypes) {
      for (const other of this.__dispatcher.getSystems(type)) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.denyEdge(system, other, 3);
        }
      }
    }
    return this;
  }

  /**
   * Schedule this system before all other systems that declared a read dependency on the given
   * component types (medium priority).
   * @param componentTypes The component types whose readers this system should precede.
   * @returns The builder for chaining calls.
   */
  beforeReadsFrom(...componentTypes: ComponentType<any>[]): this {
    for (const componentType of componentTypes) {
      for (const other of this.__dispatcher.planner.readers!.get(componentType)!) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.addEdge(system, other, 2);
        }
      }
    }
    return this;
  }

  /**
   * Schedule this system after all other systems that declared a read dependency on the given
   * component types (medium priority).
   * @param componentTypes The component types whose readers this system should follow.
   * @returns The builder for chaining calls.
   */
  afterReadsFrom(...componentTypes: ComponentType<any>[]): this {
    for (const componentType of componentTypes) {
      for (const other of this.__dispatcher.planner.readers!.get(componentType)!) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.addEdge(other, system, 2);
        }
      }
    }
    return this;
  }

  /**
   * Schedule this system before all other systems that declared a write dependency on the given
   * component types (medium priority).
   * @param componentTypes The component types whose writers this system should precede.
   * @returns The builder for chaining calls.
   */
  beforeWritesTo(...componentTypes: ComponentType<any>[]): this {
    for (const componentType of componentTypes) {
      for (const other of this.__dispatcher.planner.writers!.get(componentType)!) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.addEdge(system, other, 2);
        }
      }
    }
    return this;
  }

  /**
   * Schedule this system after all other systems that declared a write dependency on the given
   * component types (medium priority).
   * @param componentTypes The component types whose writers this system should follow.
   * @returns The builder for chaining calls.
   */
  afterWritesTo(...componentTypes: ComponentType<any>[]): this {
    for (const componentType of componentTypes) {
      for (const other of this.__dispatcher.planner.writers!.get(componentType)!) {
        for (const system of this.__systems) {
          this.__dispatcher.planner.graph.addEdge(other, system, 2);
        }
      }
    }
    return this;
  }
}


/**
 * A placeholder object returned from {@link System.schedule} with no public API.
 */
export class Schedule {
}


export type GroupContentsArray = (SystemType<System> | Record<string, unknown> | SystemGroup)[];

export class SystemGroupImpl {
  __plan: Plan;
  __executed = false;
  __systems: SystemBox[];
  __scheduleBuilder: ScheduleBuilder | undefined | null;

  constructor(readonly __contents: GroupContentsArray) { }

  __collectSystems(dispatcher: Dispatcher): SystemBox[] {
    if (!this.__systems) {
      this.__systems = [];
      for (const item of this.__contents) {
        if (item instanceof Function && item.__system) {
          this.__systems.push(dispatcher.systemsByClass.get(item)!);
        } else if (item instanceof SystemGroupImpl) {
          this.__systems.push(...item.__collectSystems(dispatcher));
        }
      }
    }
    return this.__systems;
  }

  __buildSchedule(): void {
    this.__scheduleBuilder?.__build(this.__systems, `a group`);
    this.__scheduleBuilder = null;
  }

  /**
   * Creates scheduling constraints for all systems in the group; this works exactly as if the
   * call was made individually to every {@link System.schedule}.  Can be called at most once.
   * @param buildCallback A function that constrains the schedule using a small DSL.  See
   * {@link ScheduleBuilder} for the API.
   * @returns This group for chaining calls.
   */
  schedule(buildCallback: (s: ScheduleBuilder) => void): this {
    CHECK: if (this.__scheduleBuilder === null) {
      throw new Error(`Attempt to define group schedule after world initialized`);
    }
    CHECK: if (this.__scheduleBuilder) {
      throw new Error(`Attempt to define multiple schedules in a group`);
    }
    this.__scheduleBuilder = new ScheduleBuilder(buildCallback, new Schedule());
    return this;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SystemGroup extends SystemGroupImpl { }


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
    const lastTime = this.dispatcher.lastTime ?? this.time;
    this.time = now() / 1000;
    this.delta = this.time - lastTime;
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
    await group.__plan.execute(time ?? this.time, delta ?? this.delta);
  }
}

/**
 * A frame executor that lets you manually run system groups.  You can create one by calling
 * `world.createCustomExecutor`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Frame extends FrameImpl { }


export abstract class Plan {
  protected readonly graph: Graph<SystemBox>;

  constructor(protected readonly planner: Planner, protected readonly group: SystemGroup) {
    this.graph = planner.graph.induceSubgraph(group.__systems);
    this.graph.seal();
  }

  abstract execute(time: number, delta: number): Promise<void>;
}


class SimplePlan extends Plan {
  private readonly systems: SystemBox[];

  constructor(protected readonly planner: Planner, protected readonly group: SystemGroup) {
    super(planner, group);
    this.systems = this.graph.topologicallSortedVertices;
    CHECK: if (typeof process === 'undefined' || process.env.NODE_ENV === 'development') {
      console.log('System execution order:');
      for (const system of this.systems) console.log(' ', system.name);
    }
  }

  async execute(time: number, delta: number): Promise<void> {
    const dispatcher = this.planner.dispatcher;
    const registry = dispatcher.registry;
    const systems = this.systems;
    this.group.__executed = true;
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      registry.executingSystem = system;
      system.execute(time, delta);
      dispatcher.flush();
    }
    registry.executingSystem = undefined;
  }

}


class ThreadedPlan extends Plan {
  execute(time: number, delta: number): Promise<void> {
    throw new Error('Method not implemented.');
  }
}


export class Planner {
  readonly graph: Graph<SystemBox>;
  readers? = new Map<ComponentType<Component>, Set<SystemBox>>();
  writers? = new Map<ComponentType<Component>, Set<SystemBox>>();

  constructor(
    readonly dispatcher: Dispatcher, private readonly systems: SystemBox[],
    private readonly groups: SystemGroup[]
  ) {
    this.graph = new Graph(systems);
    for (const componentType of dispatcher.registry.types) {
      this.readers!.set(componentType, new Set());
      this.writers!.set(componentType, new Set());
    }
  }

  organize(): void {
    for (const group of this.groups) group.__collectSystems(this.dispatcher);
    for (const system of this.systems) system.buildQueries();
    for (const system of this.systems) system.buildSchedule();
    for (const group of this.groups) group.__buildSchedule();
    for (const [componentType, systems] of this.readers!.entries()) {
      for (const reader of systems) {
        for (const writer of this.writers!.get(componentType)!) {
          this.graph.addEdge(writer, reader, 1);
        }
      }
    }
    delete this.readers;
    delete this.writers;
    for (const group of this.groups) {
      group.__plan =
        this.dispatcher.threaded ? new ThreadedPlan(this, group) : new SimplePlan(this, group);
    }
  }

}
