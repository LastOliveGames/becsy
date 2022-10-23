import type {Component, ComponentType} from './component';
import {Graph} from './datatypes/graph';
import type {Dispatcher} from './dispatcher';
import {InternalError} from './errors';
import type {SystemGroup} from './schedule';
import type {SystemBox} from './system';
import type {Director} from './workers';

export abstract class Plan {
  protected readonly graph: Graph<SystemBox>;

  constructor(protected readonly planner: Planner, protected readonly group: SystemGroup) {
    this.graph = planner.graph.induceSubgraph(group.__systems);
  }

  abstract execute(time: number, delta: number): Promise<void>;
  abstract initialize(): Promise<void>;
  abstract finalize(): Promise<void>;
}


class SimplePlan extends Plan {
  private readonly systems: SystemBox[];

  constructor(protected readonly planner: Planner, protected readonly group: SystemGroup) {
    super(planner, group);
    this.systems = this.graph.topologicallySortedVertices;
    CHECK: if (this.systems.length > 1 && (
      typeof process === 'undefined' || process.env.NODE_ENV === 'development'
    )) {
      console.log('System execution order:');
      for (const system of this.systems) console.log(' ', system.name);
    }
  }

  execute(time: number, delta: number): Promise<void> {
    const dispatcher = this.planner.dispatcher;
    const systems = this.systems;
    this.group.__executed = true;
    for (let i = 0; i < systems.length; i++) {
      const system = systems[i];
      system.execute(time, delta);
      dispatcher.flush();
    }
    return Promise.resolve();
  }

  async initialize(): Promise<void> {
    const dispatcher = this.planner.dispatcher;
    this.group.__executed = true;
    return new Promise((resolve, reject) => {
      let rejected = false;

      const initSystem = async (system: SystemBox) => {
        try {
          await system.prepare();
          if (rejected) return;
          system.initialize();
          dispatcher.flush();
          const systems = this.graph.traverse(system);
          if (!systems) return resolve();
          for (let i = 0; i < systems.length; i++) initSystem(systems[i]);
        } catch (e) {
          rejected = true;
          reject(e);
        }
      };

      const systems = this.graph.traverse();
      if (!systems) return resolve();
      for (let i = 0; i < systems.length; i++) initSystem(systems[i]);
    });
  }

  async finalize(): Promise<void> {
    const dispatcher = this.planner.dispatcher;
    this.group.__executed = true;
    return new Promise((resolve, reject) => {
      const finalizeSystem = (system: SystemBox) => {
        try {
          system.finalize();
          dispatcher.flush();
          const systems = this.graph.traverse(system);
          if (!systems) return resolve();
          for (let i = 0; i < systems.length; i++) finalizeSystem(systems[i]);
        } catch (e) {
          reject(e);
        }
      };

      const systems = this.graph.traverse();
      if (!systems) return resolve();
      for (let i = 0; i < systems.length; i++) finalizeSystem(systems[i]);
    });
  }
}


class LaneState {
  busy = false;
  readyWeight = 0;
  runningWeight = 0;
  priority = 0;

  queueSystem(system: SystemBox): void {
    this.readyWeight += system.weight;
    this.computePriority();
  }

  activateSystem(system: SystemBox): void {
    this.busy = true;
    this.readyWeight -= system.weight;
    // Discount running system by a factor of 2, since we don't know how much is left to execute.
    this.runningWeight = system.weight / 2;
    this.computePriority();
  }

  becomeIdle(): void {
    this.busy = false;
    this.runningWeight = 0;
    this.computePriority();
  }

  private computePriority(): void {
    // Default factor is arbitrary but hopefully will result in a priority higher than any
    // reasonable running weight.
    this.priority = 1 / ((this.readyWeight + this.runningWeight) || 0.0001);
  }
}


class Sequencer {
  private readonly graph: Graph<SystemBox>;
  private readonly readySystems: SystemBox[] = [];
  private readonly lanes: LaneState[] = [];
  private readonly currentExclusions: number[];
  private readonly prepareFn?: (system: SystemBox) => Promise<void>;
  private readonly executeFn: (system: SystemBox) => Promise<void>;

  constructor({
    graph, numSystems, numLanes, prepare, execute
  }: {
    graph: Graph<SystemBox>, numSystems: number, numLanes: number,
    prepare?: (system: SystemBox) => Promise<void>,
    execute: (system: SystemBox) => Promise<void>
  }) {
    this.graph = graph;
    this.prepareFn = prepare;
    this.executeFn = execute;
    this.currentExclusions = new Array(numSystems).fill(0);
    for (let i = 0; i < numLanes; i++) this.lanes.push(new LaneState());
  }

  async run(): Promise<void> {
    await this.traverse();
  }

  private async traverse(completedSystem?: SystemBox): Promise<void> {
    const systems = this.graph.traverse(completedSystem);
    if (!systems) return;
    if (this.prepareFn) {
      await Promise.all(systems.map(system => this.prepare(system)));
    } else {
      for (const system of systems) {
        this.readySystems.push(system);
        this.lanes[system.lane!.id].queueSystem(system);
      }
      await this.delegate();
    }
  }

  private async prepare(system: SystemBox): Promise<void> {
    await this.prepareFn!(system);
    this.readySystems.push(system);
    this.lanes[system.lane!.id].queueSystem(system);
    await this.delegate();
  }

  private async delegate(): Promise<void> {
    const systems: SystemBox[] = [];
    let nextSystem: SystemBox | undefined;
    // eslint-disable-next-line no-cond-assign
    while (nextSystem = this.selectNextSystem()) systems.push(nextSystem);
    await Promise.all(systems.map(system => this.execute(system)));
  }

  private async execute(system: SystemBox): Promise<void> {
    await this.executeFn(system);
    this.lanes[system.lane!.id].becomeIdle();
    for (const excludedSystemId of system.excludedSystemIds) {
      this.currentExclusions[excludedSystemId] -= 1;
    }
    await Promise.all([this.traverse(system), this.delegate()]);
  }

  private selectNextSystem(): SystemBox | undefined {
    let bestImpact = 0, bestIndex: number | undefined;
    for (let i = 0; i < this.readySystems.length; i++) {
      const system = this.readySystems[i];
      if (this.lanes[system.lane!.id].busy) continue;
      if (this.currentExclusions[system.id]) continue;
      let impact = 0;
      for (let j = 0; j < this.lanes.length; j++) {
        impact += system.completionLaneImpacts[j] * this.lanes[j].priority;
      }
      if (impact > bestImpact) {
        bestImpact = impact;
        bestIndex = i;
      }
    }
    if (bestIndex) {
      const system = this.readySystems.splice(bestIndex, 1)[0];
      this.lanes[system.lane!.id].activateSystem(system);
      for (const excludedSystemId of system.excludedSystemIds) {
        this.currentExclusions[excludedSystemId] += 1;
      }
      return system;
    }
  }

}


class ThreadedPlan extends Plan {
  private readonly sequencerForInitialize: Sequencer;
  private readonly sequencerForExecute: Sequencer;
  private readonly sequencerForFinalize: Sequencer;
  private time: number;
  private delta: number;

  constructor(
    protected readonly planner: Planner, protected readonly group: SystemGroup,
    private readonly director: Director
  ) {
    super(planner, group);
    this.sequencerForInitialize = new Sequencer({
      graph: this.graph,
      numSystems: this.planner.systems.length,
      numLanes: this.planner.lanes.length,
      prepare: system => this.prepareSystem(system),
      execute: system => this.initializeSystem(system),
    });
    this.sequencerForExecute = new Sequencer({
      graph: this.graph,
      numSystems: this.planner.systems.length,
      numLanes: this.planner.lanes.length,
      execute: system => this.executeSystem(system),
    });
    this.sequencerForFinalize = new Sequencer({
      graph: this.graph,
      numSystems: this.planner.systems.length,
      numLanes: this.planner.lanes.length,
      execute: system => this.finalizeSystem(system)
    });
  }

  private async prepareSystem(system: SystemBox): Promise<void> {
    if (system.hasCustomPrepare) {
      await this.director.request(system.lane!.id, 'prepareSystem', system.id);
    }
  }

  private async initializeSystem(system: SystemBox): Promise<void> {
    if (system.hasCustomInitialize) {
      await this.director.request(system.lane!.id, 'initializeSystem', system.id);
      this.planner.dispatcher.flushDirector(system.lane!.id);
    }
  }

  private async finalizeSystem(system: SystemBox): Promise<void> {
    if (system.hasCustomFinalize) {
      await this.director.request(system.lane!.id, 'finalizeSystem', system.id);
      this.planner.dispatcher.flushDirector(system.lane!.id);
    }
  }

  private async executeSystem(system: SystemBox): Promise<void> {
    if (system.hasCustomExecute) {
      await this.director.request(
        system.lane!.id, 'executeSystem', system.id, this.time, this.delta);
      this.planner.dispatcher.flushDirector(system.lane!.id);
    }
  }

  execute(time: number, delta: number): Promise<void> {
    this.time = time;
    this.delta = delta;
    this.group.__executed = true;
    return this.sequencerForExecute.run();
  }

  initialize(): Promise<void> {
    this.group.__executed = true;
    return this.sequencerForInitialize.run();
  }

  async finalize(): Promise<void> {
    this.group.__executed = true;
    await this.sequencerForFinalize.run();
    await this.director.shutdown();
  }
}


export class Lane {
  id: number;
  readonly systems: SystemBox[] = [];

  constructor(id: number) {
    this.id = id;
  }

  add(...systems: SystemBox[]): void {
    for (const system of systems) system.lane = this;
    this.systems.push(...systems);
  }

  merge(other: Lane): Lane {
    if (this === other) return this;
    if (this.id === -1 || (other.id !== -1 && other.id < this.id)) return other.merge(this);
    this.add(...other.systems);
    other.systems.length = 0;
    return this;
  }

}


export class Planner {
  readonly graph: Graph<SystemBox>;
  readers? = new Map<ComponentType<Component>, Set<SystemBox>>();
  writers? = new Map<ComponentType<Component>, Set<SystemBox>>();
  lanes: Lane[] = [];
  replicatedLane?: Lane;
  laneCount = 0;

  constructor(
    readonly dispatcher: Dispatcher, readonly systems: SystemBox[],
    private readonly groups: SystemGroup[], private readonly director?: Director
  ) {
    this.graph = new Graph(systems);
    for (const componentType of dispatcher.registry.types) {
      this.readers!.set(componentType, new Set());
      this.writers!.set(componentType, new Set());
    }
    if (dispatcher.threaded) {
      DEBUG: if (!director) throw new InternalError('Threaded planner needs a director');
      this.createLane();
      // special lane id, and don't keep this in the lanes array
      this.replicatedLane = new Lane(-1);
    }
  }

  get mainLane(): Lane | undefined {
    return this.lanes[0];
  }

  createLane(): Lane {
    const lane = new Lane(this.laneCount++);
    this.lanes.push(lane);
    return lane;
  }

  organize(): void {
    for (const group of this.groups) group.__collectSystems(this.dispatcher);
    for (const system of this.systems) system.buildQueries();
    for (const system of this.systems) system.buildSchedule();
    for (const group of this.groups) group.__buildSchedule();
    this.addComponentEntitlementDependencies();
    this.graph.seal();
    if (this.dispatcher.threaded) {
      this.computeExcludedSystems();
      this.computeCompletionLaneImpacts();
      this.assignSystemsToLanes();
    }
    STATS: for (const system of this.systems) system.stats.worker = system.lane?.id ?? 0;
    delete this.readers;
    delete this.writers;
    for (const group of this.groups) {
      group.__plan = this.dispatcher.threaded ?
        new ThreadedPlan(this, group, this.director!) : new SimplePlan(this, group);
    }
  }

  private addComponentEntitlementDependencies(): void {
    for (const [componentType, systems] of this.readers!.entries()) {
      for (const reader of systems) {
        for (const writer of this.writers!.get(componentType)!) {
          this.graph.addEdge(writer, reader, 1);
        }
      }
    }
  }

  private computeExcludedSystems(): void {
    for (let i = 0; i < this.systems.length; i++) {
      const system1 = this.systems[i];
      for (let j = i + 1; j < this.systems.length; j++) {
        const system2 = this.systems[j];
        if (
          doMasksIntersect(system1.accessMasks.write, system2.accessMasks.read) ||
          doMasksIntersect(system1.accessMasks.write, system2.accessMasks.write) ||
          doMasksIntersect(system1.accessMasks.write, system2.accessMasks.create) ||
          doMasksIntersect(system1.accessMasks.write, system2.accessMasks.update) ||
          doMasksIntersect(system1.accessMasks.read, system2.accessMasks.write) ||
          doMasksIntersect(system1.accessMasks.read, system2.accessMasks.create) ||
          doMasksIntersect(system1.accessMasks.create, system2.accessMasks.write) ||
          doMasksIntersect(system1.accessMasks.create, system2.accessMasks.read) ||
          doMasksIntersect(system1.accessMasks.create, system2.accessMasks.update) ||
          doMasksIntersect(system1.accessMasks.update, system2.accessMasks.write) ||
          doMasksIntersect(system1.accessMasks.update, system2.accessMasks.create)
        ) {
          system1.excludedSystemIds.push(system2.id);
          system2.excludedSystemIds.push(system1.id);
        }
      }
    }
  }

  private computeCompletionLaneImpacts(): void {
    for (const system of this.systems) {
      system.completionLaneImpacts = new Array(this.lanes.length).fill(0);
      for (const otherSystem of this.systems) {
        if (system === otherSystem) continue;
        if (this.graph.hasEdge(system, otherSystem)) {
          system.completionLaneImpacts[otherSystem.lane!.id] += otherSystem.weight;
        }
        if (this.graph.hasPath(system, otherSystem)) {
          // This will double the weighing of immediately following systems.
          system.completionLaneImpacts[otherSystem.lane!.id] += otherSystem.weight;
        }
      }
    }
  }

  private assignSystemsToLanes(): void {
    this.initSystemLanes();
    this.mergeAccessorsOfUnsharedComponentTypes();
    this.mergeAttachedSystems();
    this.pruneEmptyLanes();
    this.reduceLanes(this.dispatcher.threads);
    this.pruneEmptyLanes();
  }

  private initSystemLanes(): void {
    for (const system of this.systems) {
      if (!system.lane) this.createLane().add(system);
    }
  }

  private mergeAccessorsOfUnsharedComponentTypes(): void {
    for (const componentType of this.dispatcher.registry.types) {
      if (componentType.__binding!.fields.every(field => field.type.shared)) continue;
      const readers = this.readers!.get(componentType);
      const writers = this.writers!.get(componentType);
      if (!readers && !writers) continue;
      let lane = componentType.options?.restrictedToMainThread ? this.mainLane! : this.createLane();
      readers?.forEach(system => {
        lane = lane.merge(system.lane!);
      });
      writers?.forEach(system => {
        lane = lane.merge(system.lane!);
      });
    }
  }

  private mergeAttachedSystems(): void {
    for (const system of this.systems) {
      for (const attachedSystem of system.attachedSystems) {
        if (!attachedSystem) continue;
        system.lane!.merge(attachedSystem.lane!);
      }
    }
  }

  private reduceLanes(maxNumLanes: number): void {
    if (this.lanes.length <= maxNumLanes) return;
    let pairs: {laneA: Lane, laneB: Lane, independence: number}[] = [];
    for (let i = 1; i < this.lanes.length - 1; i++) {  // don't merge into lane 0 unless necessary
      const laneA = this.lanes[i];
      for (let j = i + 1; j < this.lanes.length; j++) {
        const laneB = this.lanes[j];
        pairs.push({laneA, laneB, independence: this.computeIndependence(laneA, laneB)});
      }
    }
    let numLanes = this.lanes.length;
    while (numLanes > maxNumLanes) {
      pairs.sort((pair1, pair2) => pair2.independence - pair1.independence);
      const tangledPair = pairs.pop()!;
      const combinedLane = tangledPair.laneA.merge(tangledPair.laneB);
      const discardedLane =
        combinedLane === tangledPair.laneA ? tangledPair.laneB : tangledPair.laneA;
      numLanes -= 1;
      if (numLanes > maxNumLanes) {
        pairs = pairs.filter(pair => {
          if (pair.laneA === discardedLane || pair.laneB === discardedLane) return false;
          if (pair.laneA === combinedLane || pair.laneB === combinedLane) {
            pair.independence = this.computeIndependence(pair.laneA, pair.laneB);
          }
          return true;
        });
      }
    }
  }

  private computeIndependence(laneA: Lane, laneB: Lane): number {
    return Math.min(
      this.computeIndependentWeight(laneA, laneB), this.computeIndependentWeight(laneB, laneA));
  }

  private computeIndependentWeight(lane: Lane, otherLane: Lane): number {
    let independentWeight = 0;
    for (const system of lane.systems) {
      let otherWeight = 0;
      for (const otherSystem of otherLane.systems) {
        if (!this.graph.hasPath(system, otherSystem) && !this.graph.hasPath(otherSystem, system)) {
          otherWeight += otherSystem.weight;
        }
      }
      independentWeight += Math.min(system.weight, otherWeight);
    }
    return independentWeight;
  }

  private pruneEmptyLanes(): void {
    this.lanes = this.lanes.filter(lane => lane.id === 0 || lane.systems.length);
    // Never prune the main thread lane.
    for (let i = 1; i < this.lanes.length; i++) {
      this.lanes[i].id = i;
    }
  }

}

function doMasksIntersect(mask1: number[] | undefined, mask2: number[] | undefined): boolean {
  if (!mask1 || !mask2) return false;
  const length = Math.min(mask1.length, mask2.length);
  for (let i = 0; i < length; i++) {
    if ((mask1[i] & mask2[i]) !== 0) return true;
  }
  return false;
}

