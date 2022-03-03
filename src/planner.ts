import type {Component, ComponentType} from './component';
import {Graph} from './datatypes/graph';
import type {Dispatcher} from './dispatcher';
import type {SystemGroup} from './schedule';
import type {SystemBox} from './system';

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


class ThreadedPlan extends Plan {
  execute(time: number, delta: number): Promise<void> {
    return Promise.resolve();
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  finalize(): Promise<void> {
    return Promise.resolve();
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
    readonly dispatcher: Dispatcher, private readonly systems: SystemBox[],
    private readonly groups: SystemGroup[]
  ) {
    this.graph = new Graph(systems);
    for (const componentType of dispatcher.registry.types) {
      this.readers!.set(componentType, new Set());
      this.writers!.set(componentType, new Set());
    }
    if (dispatcher.threaded) {
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
    this.addComponentReaderWriterDependencies();
    this.graph.seal();
    if (this.dispatcher.threaded) this.assignSystemsToLanes();
    STATS: for (const system of this.systems) system.stats.worker = system.lane?.id ?? 0;
    delete this.readers;
    delete this.writers;
    for (const group of this.groups) {
      group.__plan =
        this.dispatcher.threaded ? new ThreadedPlan(this, group) : new SimplePlan(this, group);
    }
  }

  private addComponentReaderWriterDependencies(): void {
    for (const [componentType, systems] of this.readers!.entries()) {
      for (const reader of systems) {
        for (const writer of this.writers!.get(componentType)!) {
          this.graph.addEdge(writer, reader, 1);
        }
      }
    }
  }

  private assignSystemsToLanes(): void {
    this.initSystemLanes();
    this.mergeReadersOfUnsharedComponentTypes();
    this.mergeAttachedSystems();
    this.pruneEmptyLanes();
    this.reduceLanes(this.dispatcher.threads + 1);
    this.pruneEmptyLanes();
  }

  private initSystemLanes(): void {
    for (const system of this.systems) {
      if (!system.lane) this.createLane().add(system);
    }
  }

  private mergeReadersOfUnsharedComponentTypes(): void {
    for (const componentType of this.dispatcher.registry.types) {
      if (componentType.__binding!.fields.every(field => field.type.shared)) continue;
      const readers = this.readers!.get(componentType);
      if (!readers) continue;
      let lane = componentType.options?.restrictedToMainThread ? this.mainLane! : this.createLane();
      readers.forEach(system => {
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
