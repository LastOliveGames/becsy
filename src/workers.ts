import {
  ControlOptions, Dispatcher, DispatcherCore, DispatcherOptions, State, WorldOptions
} from './dispatcher';
import {InternalError} from './errors';
import type {
  Worker as NodeWorker, MessageChannel as NodeMessageChannel, MessagePort as NodeMessagePort
} from 'worker_threads';
import type {System, SystemId} from './system';
import type {ComponentType} from './component';
import type {Entity} from './entity';
import type {SystemGroup, Frame} from './schedule';
import type {Stats} from './stats';
import type {Patch} from './buffers';

type Port = (MessagePort | NodeMessagePort) & {onmessage: (message: any) => void};
type BootstrapMessage = {role: 'director', ports: Port[]} | {role: 'laborer', port: Port};

const ERROR_TYPES: {[key: string]: typeof Error | typeof InternalError} = {
  InternalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, EvalError
};

const workers: (Worker | NodeWorker)[] = [];
const channels: (MessageChannel | NodeMessageChannel)[] = [];


interface Request {
  type: 'req';
  id: number;
  action: string;
  args: any[];
  nextEntityOrdinal?: number;
  buffersPatch?: Patch;
}

interface Response {
  type: 'res';
  id: number;
  result?: any;
  error?: {
    name: string;
    message: string;
    stack: string;
  }
  nextEntityOrdinal?: number;
  buffersPatch?: Patch;
}


abstract class WorkerBridge {
  private nextMessageId = 0;

  private readonly outstandingRequests =
    // eslint-disable-next-line func-call-spacing
    new Map<number, {resolve: (value: any) => void, reject: (error: Error) => void}>();

  protected dispatcher: Dispatcher;

  constructor(protected readonly ports: Port[], private readonly buffersMaster: boolean) {
    for (let i = 0; i < ports.length; i++) {
      const port = ports[i];
      port.onmessage = this.receive.bind(this, port, i);
    }
  }

  private async receive(port: Port, laneId: number, message: Request | Response): Promise<void> {
    if (message.type === 'req') {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-types
        const fn = (this as any)[message.action] as Function;
        DEBUG: if (!fn) throw new InternalError('No such method: ' + message.action);
        this.dispatcher?.registry.updateNextEntityOrdinal(message.nextEntityOrdinal);
        if (message.buffersPatch) this.dispatcher?.buffers.applyPatch(message.buffersPatch, false);
        const result = await fn.apply(this, message.args);
        const nextEntityOrdinal = this.dispatcher?.registry.nextEntityOrdinal;
        const buffersPatch = this.buffersMaster ? undefined : this.dispatcher?.buffers.makePatch();
        port.postMessage({id: message.id, result, nextEntityOrdinal, buffersPatch} as Response);
      } catch (e: any) {
        port.postMessage(
          {id: message.id, error: {name: e.name, message: e.message, stack: e.stack}} as Response
        );
      }
    } else if (message.type === 'res') {
      const entry = this.outstandingRequests.get(message.id);
      DEBUG: if (!entry) throw new InternalError('Missing outstanding request: ' + message.id);
      this.outstandingRequests.delete(message.id);
      this.dispatcher?.registry.updateNextEntityOrdinal(message.nextEntityOrdinal);
      if (message.buffersPatch) {
        this.dispatcher?.buffers.applyPatch(message.buffersPatch, true, laneId);
      }
      if (message.error) {
        const error = message.error;
        const e = new (ERROR_TYPES[error.name] ?? Error)(error.message);
        e.stack = error.stack;
        entry.reject(e);
      } else {
        entry.resolve(message.result);
      }
    } else {
      DEBUG: throw new InternalError('Invalid worker message: ' + message);
    }
  }

  protected async send(
    port: Port, action: string, args: any[], nextEntityOrdinal?: number, buffersPatch?: Patch
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextMessageId++;
      port.postMessage({type: 'req', id, action, args, nextEntityOrdinal, buffersPatch});
      this.outstandingRequests.set(id, {resolve, reject});
    });
  }
}

export class Director extends WorkerBridge {
  constructor(options: WorldOptions, ports: Port[]) {
    super(ports, false);
    this.dispatcher = new Dispatcher(options, {
      isDirector: true,
      director: this,
    });
  }

  async request(laneId: number, action: string, ...args: any[]): Promise<any> {
    return this.send(
      this.ports[laneId], action, args, this.dispatcher?.registry.nextEntityOrdinal,
      this.dispatcher?.buffers.makePatch(laneId)
    );
  }

  async initialize(): Promise<void> {
    DEBUG: {
      const badSystem = this.dispatcher.systems.find(
        system => system.lane?.id === undefined || system.lane.id >= this.ports.length
      );
      if (badSystem) {
        throw new InternalError(
          `System ${badSystem.name} assigned to invalid lane ${badSystem.lane?.id}`);
      }
    }
    const bootstrapPromises = [];
    for (let i = 0; i < this.ports.length; i++) {
      const assignedSystemIds =
        this.dispatcher.systems.filter(system => system.lane?.id === i).map(system => system.id);
      if (assignedSystemIds.length) {
        bootstrapPromises.push(this.request(i, 'bootstrap', {
          isLaborer: true,
          assignedSystemIds: new Set(assignedSystemIds),
          singletonId: this.dispatcher.singleton?.__id,
          laneId: i,
          hasNegativeQueries: this.dispatcher.registry.hasNegativeQueries,
          hasWriteQueries: this.dispatcher.hasWriteQueries,
          buffersPatch: this.dispatcher.buffers.makePatch(i)
        } as DispatcherOptions));
      }
    }
    await Promise.all(bootstrapPromises);
    await this.dispatcher.initialize();
  }

  async execute(time?: number, delta?: number): Promise<void> {
    await this.dispatcher.execute(time, delta);
  }

  async terminate(): Promise<void> {
    await this.dispatcher.terminate();
  }

  async shutdown(): Promise<void> {
    await this.request(0, 'release');
    workers.slice(1).map(worker => worker.terminate());
    setTimeout(() => self.close());  // shut down after we post the response to the main thread
  }
}


class Laborer extends WorkerBridge {
  constructor(private readonly options: WorldOptions, readonly port: Port) {
    super([port], true);
  }

  async bootstrap(dispatcherOptions: DispatcherOptions): Promise<void> {
    this.dispatcher = new Dispatcher(this.options, dispatcherOptions);
  }

  async prepareSystem(systemId: SystemId): Promise<void> {
    const system = this.dispatcher.systemsById[systemId];
    await system.prepare();
  }

  async initializeSystem(systemId: SystemId): Promise<void> {
    const system = this.dispatcher.systemsById[systemId];
    this.dispatcher.initializeLaborerSystem(system);
  }

  async executeSystem(systemId: SystemId, time: number, delta: number): Promise<void> {
    const system = this.dispatcher.systemsById[systemId];
    this.dispatcher.executeLaborerSystem(system, time, delta);
  }

  async finalizeSystem(systemId: SystemId): Promise<void> {
    const system = this.dispatcher.systemsById[systemId];
    this.dispatcher.finalizeLaborerSystem(system);
  }
}


class MainThreadLaborer extends Laborer implements DispatcherCore {
  async request(action: string, ...args: any[]): Promise<any> {
    return this.send(this.port, action, args);
  }

  get state(): State {
    return this.dispatcher.state;
  }

  get stats(): Stats {
    throw new Error('Method not implemented.');
  }

  async initialize(): Promise<void> {
    return this.request('initialize');
  }

  async execute(time?: number, delta?: number): Promise<void> {
    await this.request('execute', time, delta);
  }

  executeFunction(fn: (system: System) => void): void {
    this.dispatcher.executeFunction(fn);
  }

  createEntity(initialComponents: (ComponentType<any> | Record<string, unknown>)[]): Entity {
    return this.dispatcher.createEntity(initialComponents);
  }

  async terminate(): Promise<void> {
    await this.request('terminate');
  }

  control(options: ControlOptions): void {
    throw new Error('Method not implemented.');
  }

  createCustomExecutor(groups: SystemGroup[]): Frame {
    throw new Error('Method not implemented.');
  }

  async release(): Promise<void> {
    this.dispatcher.release();
  }
}


export async function bootstrapThread(options: WorldOptions): Promise<DispatcherCore | undefined> {
  if (options.threads === undefined) options.threads = 1;
  if (options.threads <= 0) options.threads += navigator.hardwareConcurrency;
  if (options.threads === 1) {
    return new Dispatcher(options, {isDirector: true, isLaborer: true, laneId: 0});
  }

  const env = await normalizeEnvironment();
  if (env.mainThread) return bootstrapMainThread(options, env);
  bootstrapWorker(options, env);
}


function bootstrapMainThread(
  options: WorldOptions, env: Environment & {mainThread: true}
): DispatcherCore {
  CHECK: if (!options?.workerPath) throw new Error('Must specify a workerPath in world options');
  const numThreads = options?.threads ?? 1;
  for (let i = 0; i < numThreads; i++) {
    workers.push(new env.Worker(
      options.workerPath, {type: options?.workerModule ? 'module' : 'classic'}));
    channels.push(new env.Channel());
  }
  const directorPorts = channels.map(channel => channel.port1);
  workers[0].postMessage({role: 'director', ports: directorPorts}, directorPorts as any);
  for (let i = 1; i < numThreads; i++) {
    const port = channels[i].port2;
    workers[i].postMessage({role: 'laborer', port}, [port as any]);
  }
  return new MainThreadLaborer(options, channels[0].port2 as Port);
}

function bootstrapWorker(options: WorldOptions, env: Environment & {mainThread: false}): void {
  env.parentPort!.onmessage = function(message: BootstrapMessage) {
    switch (message.role) {
      case 'director':
        new Director(options, message.ports);  // eslint-disable-line no-new
        break;
      case 'laborer':
        new Laborer(options, message.port);  // eslint-disable-line no-new
        break;
      default:
        DEBUG: throw new InternalError('Unknown thread role: ' + (message as any).role);
    }
  };
}


type Environment = {
  mainThread: true;
  Worker: typeof Worker | typeof NodeWorker;
  Channel: typeof MessageChannel | typeof NodeMessageChannel;
} | {
  mainThread: false;
  parentPort?: Port;
}

async function normalizeEnvironment(): Promise<Environment> {
  if (typeof require !== 'undefined') {
    const workerThreads = await import('worker_threads');
    if (workerThreads.isMainThread) {
      return {
        mainThread: true, Worker: workerThreads.Worker, Channel: workerThreads.MessageChannel
      };
    }
    return {mainThread: false, parentPort: workerThreads.parentPort! as any};
  } else if (typeof window !== 'undefined') {
    return {mainThread: true, Worker: window.Worker, Channel: window.MessageChannel};
  } else if (typeof self !== 'undefined') {  // eslint-disable-line no-negated-condition
    return {mainThread: false, parentPort: self as any};
  }
  throw new InternalError('Unknown environment when boostrapping thread');
}
