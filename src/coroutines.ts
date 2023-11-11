import type {ComponentType} from './component';
import type {Entity} from './entity';
import {CheckError} from './errors';
import type {System} from './system';

/**
 * Internal interface meant only to be passed to yield expressions in coroutines.  Do not invoke
 * any methods from user code!
 */
export interface Waitable<T> {
  markAwaited?(): void;
  isReady(): boolean;
  cancel?(): void;
  value?: T;
  error?: Error | undefined;
}


/**
 * An exception thrown by coroutines when they've been canceled. You should normally rethrow it
 * from any catch blocks, and it will be caught and ignored at the top coroutine nesting level.
 */
export class CanceledError extends Error {
  canceled = true;
  constructor() {
    super('Canceled');
  }
}


/**
 * A handle that you can use to configure a coroutine execution.  You can obtain one from
 * {@link System.start} explicitly, or implicitly by using the {@link co} decorator.
 *
 * The `cancel` family of methods will silently cancel (abort) the coroutine whenever a condition is
 * fulfilled at any `yield` statement, even if the coroutine is currently blocked.  These are
 * typically called when the coroutine is started. If you specify a `scope` for the coroutine it can
 * affect how the `cancel` conditions work.
 */
export interface Coroutine {
  // The same cancelation methods are also declared below for coDecorator, and in overlays.d.ts.

  /**
   * Unconditionally cancels (aborts) this coroutine, or the most deeply nested one that this
   * coroutine is currently waiting on.  This will throw a {@link CanceledError} from that
   * coroutine's current (or next) `yield` statement.
   */
  cancel(): void;

  /**
   * Cancels this coroutine if the given condition is true at any `yield` point.
   * @param condition The condition to check at every `yield` point.
   */
  cancelIf(condition: () => boolean): Coroutine;

  /**
   * Constrains the entity's scope to the given entity.  The coroutine will automatically be
   * canceled if the entity is deleted, and any conditional cancelations will only trigger if the
   * event's scope matches.
   *
   * The scope cannot be changed once set, and cannot be set once any cancelation conditions have
   * been added.
   * @param entity The entity that this coroutine is processing somehow.
   */
  scope(entity: Entity): Coroutine;

  /**
   * Cancels this coroutine if the given component is missing from the scoped entity at any `yield`
   * point.
   * @param type The type of component to check for.
   */
  cancelIfComponentMissing(type: ComponentType<any>): Coroutine;

  /**
   * Cancels this coroutine if another coroutine is started within this system.  By default, any
   * coroutine will trigger cancelation.  If this coroutine has a scope, then the newly started
   * coroutine must have the same scope.  If a `coroutineFn` is given, then the newly started
   * coroutine must be that one.
   * @param coroutineFn A specific mutually exclusive coroutine.  You can use `co.self` as a
   *  shortcut for the currently running coroutine.
   */
  cancelIfCoroutineStarted(coroutineFn?: CoroutineFunction): Coroutine;
}

/**
 * A handle to the currently executing coroutine.  You can access it via `co`, but only from inside
 * an executing coroutine.
 *
 * This has all the normal coroutine control methods and adds a bunch of `wait` methods for blocking
 * the coroutine until something happens.  You must pass the return value of the `wait` methods into
 * a `yield` expression for them to work.
 */
export interface CurrentCoroutine extends Coroutine {
  // The same waiting methods are also declared below for coDecorator.

  /**
   * Blocks the coroutine for the given number of frames.  Blocking for 1 frame will execute on the
   * next frame, for 2 frames will skip a round of executions, etc.
   *
   * Yielding on `co.waitForFrames(1)` is equivalent to a `yield` with no argument.
   * @param frames The number of frames to block the coroutine for.
   */
  waitForFrames(frames: number): Waitable<void>;

  /**
   * Blocks the coroutine for at least the given number of seconds (or whatever unit of time you're
   * using if you've customized the world's time counter).  Always waits at least until the next
   * frame.
   * @param seconds The number of seconds to block the coroutine for.
   */
  waitForSeconds(seconds: number): Waitable<void>;

  /**
   * Blocks the coroutine until the given condition returns `true`.  Always waits at least until the
   * next frame.
   * @param condition The condition to check every frame until it returns `true`.
   */
  waitUntil(condition: () => boolean): Waitable<void>;
}


let currentCoroutine: CoroutineImpl<any> | void;


class CoroutineImpl<T> implements Coroutine, Waitable<T>, CoroutineGenerator {
  private __cancellers: (() => boolean)[] = [];
  private __blocker: Waitable<any> | void;
  private __scope?: Entity;
  private __done = false;
  private __awaited = false;
  private __error?: Error;
  private __value: T;
  private __firstRun = true;

  constructor(
    private readonly __generator: Generator<Waitable<any> | void, T, any>,
    readonly __fn: CoroutineFunction,
    private readonly __supervisor: Supervisor
  ) {}

  __checkCancelation(): void {
    if (this.__done) return;
    for (const canceller of this.__cancellers) {
      if (canceller()) {
        this.cancel();
        break;
      }
    }
  }

  __step(): void {
    currentCoroutine = this;  // eslint-disable-line @typescript-eslint/no-this-alias
    try {
      if (!this.__done && (this.__blocker?.isReady() ?? true)) {
        try {
          let next;
          if (this.__blocker?.error) {
            next = this.__generator.throw(this.__blocker.error);
          } else if (this.__firstRun) {
            try {
              next = this.__generator.next(this.__blocker?.value);
            } finally {
              this.__firstRun = false;
              this.__supervisor.cancelMatching(this, this.__scope, this.__fn);
            }
          } else {
            next = this.__generator.next(this.__blocker?.value);
          }
          if (next.done) {
            this.__done = true;
            this.__value = next.value;
            this.__blocker = undefined;
          } else {
            this.__blocker = next.value;
            this.__blocker?.markAwaited?.();
          }
        } catch (e) {
          this.__done = true;
          if (!this.__error) this.__error = e as Error;
          this.__blocker = undefined;
        }
      }
      if (this.__error && !(this.__awaited || this.__error instanceof CanceledError)) {
        throw this.__error;
      }
    } finally {
      currentCoroutine = undefined;
    }
  }

  // Waitable methods

  isReady(): boolean {
    return this.__done;
  }

  get value(): T {
    return this.__value;
  }

  get error(): Error | undefined {
    return this.__error;
  }

  markAwaited(): void {
    this.__awaited = true;
  }

  // CurrentCoroutine methods

  waitForFrames(frames: number): Waitable<void> {
    CHECK: if (frames <= 0) throw new CheckError('Number of frames to wait for must be >0');
    return {
      isReady() {return --frames <= 0;}
    };
  }

  waitForSeconds(seconds: number): Waitable<void> {
    const system = this.__supervisor.system;
    const targetTime = system.time + seconds;
    return {
      isReady() {return system.time >= targetTime;}
    };
  }

  waitUntil(condition: () => boolean): Waitable<void> {
    return {isReady: condition};
  }

  // Coroutine methods

  cancel(): this {
    if (this.__blocker?.cancel) {
      this.__blocker.cancel();
    } else {
      this.__error = new CanceledError();
      this.__done = true;
    }
    return this;
  }

  cancelIf(condition: () => boolean): this {
    this.__cancellers.push(condition);
    return this;
  }

  scope(entity: Entity): this {
    CHECK: if (this.__scope) throw new CheckError('Scope already set for this coroutine');
    CHECK: if (this.__cancellers.length) {
      throw new CheckError('Scope must be set before any cancelation conditions');
    }
    this.__scope = entity;
    this.cancelIf(() => !entity.alive);
    return this;
  }

  cancelIfComponentMissing(type: ComponentType<any>): this {
    CHECK: if (!this.__scope) throw new CheckError('Required scope not set for this coroutine');
    this.cancelIf(() => !this.__scope?.has(type));
    return this;
  }

  cancelIfCoroutineStarted(coroutineFn?: CoroutineFunction): this {
    this.__supervisor.registerCancelIfStarted(
      this, this.__scope, coroutineFn === coDecorator.self ? this.__fn : coroutineFn);
    return this;
  }

  // We need to stub out all the Generator methods because we're overloading the type.  They must
  // not be called by the user, however.

  return(value: void): IteratorResult<any, void> {
    throw new CheckError('Generator methods not available for coroutines');
  }

  throw(e: any): IteratorResult<any, void> {
    throw new CheckError('Generator methods not available for coroutines');
  }

  next(...args: [] | [unknown]): IteratorResult<any, void> {
    throw new CheckError('Generator methods not available for coroutines');
  }

  [Symbol.iterator](): Generator<any, void, unknown> {
    throw new CheckError('Generator methods not available for coroutines');
  }
}


export type CoroutineGenerator = Generator<any, any, any>;
export type CoroutineFunction = (...args: any[]) => CoroutineGenerator;
type Self = {get self(): CoroutineFunction};

function coDecorator(
  target: System, name: string, descriptor: TypedPropertyDescriptor<CoroutineFunction>
): TypedPropertyDescriptor<CoroutineFunction> {
  const coroutine = descriptor.value!;
  return {
    value(this: System, ...args: []): CoroutineImpl<unknown> {
      return this.start(coroutine, ...args) as CoroutineImpl<unknown>;
    },
  };
}

coDecorator.waitForFrames = function(frames: number): Waitable<void> {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.waitForFrames(frames);
};

coDecorator.waitForSeconds = function(seconds: number): Waitable<void> {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.waitForSeconds(seconds);
};

coDecorator.waitUntil = function(condition: () => boolean): Waitable<void> {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.waitUntil(condition);
};

coDecorator.cancel = function(): void {
  CHECK: checkCurrentCoroutine();
  currentCoroutine!.cancel();
};

coDecorator.cancelIf = function(condition: () => boolean): CurrentCoroutine {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.cancelIf(condition);
};

coDecorator.scope = function(entity: Entity): CurrentCoroutine {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.scope(entity);
};

coDecorator.cancelIfComponentMissing = function(type: ComponentType<any>): CurrentCoroutine {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.cancelIfComponentMissing(type);
};

coDecorator.cancelIfCoroutineStarted = function(coroutineFn?: CoroutineFunction): CurrentCoroutine {
  CHECK: checkCurrentCoroutine();
  return currentCoroutine!.cancelIfCoroutineStarted(coroutineFn);
};

coDecorator.self = function*() {yield;};


function checkCurrentCoroutine(): void {
  if (!currentCoroutine) throw new CheckError('Cannot call co methods outside coroutine context');
}


/**
 * This object can be used in two ways:
 * 1. As a decorator, to wrap coroutine methods in a call to {@link System.start} so you can invoke
 * them directly.
 * 2. As a handle to the currently executing coroutine, so you can invoke coroutine control methods
 * from within the coroutine's code.
 */
export const co: typeof coDecorator & CurrentCoroutine & Self = coDecorator;


export class Supervisor {
  private readonly coroutines: CoroutineImpl<any>[] = [];
  private readonly mutuallyExclusiveCoroutines = new Map<string, Coroutine[]>();

  constructor(readonly system: System) {}

  start<CoFn extends CoroutineFunction>(coroutineFn: CoFn, ...args: Parameters<CoFn>): Coroutine {
    const coroutine =
      new CoroutineImpl(coroutineFn.apply(this.system, args), coroutineFn, this);
    this.coroutines.push(coroutine);
    return coroutine;
  }

  execute(): void {
    // Execute in reverse order, so that the most recently started coroutines execute first.  That
    // way, if coroutine A started coroutine B and is waiting for it to complete, it will resume in
    // the same frame as B finishes rather than having to wait for another go-around. At the same
    // time, if new coroutines are started while we're processing, keep iterating to execute the
    // extra ones within the same frame.
    let processedLength = 0;
    while (processedLength < this.coroutines.length) {
      const endIndex = processedLength;
      processedLength = this.coroutines.length;
      for (let i = processedLength - 1; i >= endIndex; i--) {
        this.system.accessRecentlyDeletedData(false);
        this.coroutines[i].__checkCancelation();
      }
      for (let i = processedLength - 1; i >= endIndex; i--) {
        this.system.accessRecentlyDeletedData(false);
        const coroutine = this.coroutines[i];
        coroutine.__step();
        if (coroutine.isReady()) {
          this.coroutines.splice(i, 1);
          processedLength -= 1;
        }
      }
    }
  }

  registerCancelIfStarted(
    targetCoroutine: Coroutine, scope: Entity | undefined,
    coroutineFn: CoroutineFunction | undefined
  ): void {
    const key = (scope?.__id ?? '') + (coroutineFn?.name ?? '');
    if (!this.mutuallyExclusiveCoroutines.has(key)) this.mutuallyExclusiveCoroutines.set(key, []);
    this.mutuallyExclusiveCoroutines.get(key)?.push(targetCoroutine);
  }

  cancelMatching(
    startingCoroutine: Coroutine, scope: Entity | undefined, coroutineFn: CoroutineFunction
  ): void {
    this.cancelMatchingKey(startingCoroutine, '');
    this.cancelMatchingKey(startingCoroutine, coroutineFn.name);
    if (scope) {
      this.cancelMatchingKey(startingCoroutine, '' + scope.__id);
      this.cancelMatchingKey(startingCoroutine, '' + scope.__id + coroutineFn.name);
    }
  }

  private cancelMatchingKey(requestingCoroutine: Coroutine, key: string): void {
    const coroutines = this.mutuallyExclusiveCoroutines.get(key);
    if (coroutines) {
      let hasRequesting = false;
      for (const coroutine of coroutines) {
        if (coroutine === requestingCoroutine) {
          hasRequesting = true;
        } else {
          coroutine.cancel();
        }
      }
      coroutines.length = 0;
      if (hasRequesting) coroutines.push(requestingCoroutine);
    }
  }
}
