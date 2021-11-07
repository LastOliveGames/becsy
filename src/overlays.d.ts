// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Generator<T, TReturn, TNext> extends Coroutine {
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
  cancelIf(condition: () => boolean): this;

  /**
   * Constrains the entity's scope to the given entity.  The coroutine will automatically be
   * canceled if the entity is deleted, and any conditional cancellations will only trigger if the
   * event's scope matches.
   * @param entity The entity that this coroutine is processing somehow.
   */
  scope(entity: Entity): this;

  /**
   * Cancels this coroutine if the give component is missing from the scoped entity at any `yield`
   * point.
   * @param type The type of component to check for.
   */
  cancelIfComponentMissing(type: ComponentType<any>): this;
}
