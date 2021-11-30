import {checkTypeDefined, ComponentType, initComponent} from './component';
import type {Registry} from './registry';
import type {SystemBox} from './system';


export type EntityId = number & {__entityIdBrand: symbol};
export type ReadWriteMasks = {read?: number[], write?: number[]};


/**
 * An entity represents a collection of distinct components with a unique identity.
 *
 * You can obtain entities from queries in your system.  You must not keep references to entities
 * thus obtained, as they may be pointed to another entity at any time between system executions.
 * Instead, call {@link Entity.hold} to obtain a long-lived version of the object.
 */
export class EntityImpl {
  __id: EntityId;
  __valid = true;

  constructor(private readonly __registry: Registry) {}

  /**
   * Returns whether the entity is alive, i.e. has not been deleted.  Turning on
   * `accessRecentlyDeletedData` doesn't affect the return value.
   */
  get alive(): boolean {
    CHECK: this.__checkValid();
    return this.__registry.hasShape(this.__id, this.__registry.Alive, false);
  }

  /**
   * Adds a component to the entity.  If the entity already possesses a component of this type the
   * call will fail.
   * @param type The type of component to add.
   * @param values An optional object with field values to initialize the new component.
   */
  add<C>(type: ComponentType<C>, values?: Partial<C>): void {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, true);
      if (!this.__registry.hasShape(this.__id, this.__registry.Alive, false)) {
        throw new Error('Entity has been deleted');
      }
      if (this.__registry.hasShape(this.__id, type, false)) {
        throw new Error(`Entity already has a ${type.name} component`);
      }
    }
    this.__registry.setShape(this.__id, type);
    STATS: this.__registry.dispatcher.stats.forComponent(type).numEntities += 1;
    initComponent(type, this.__id, values);
  }

  /**
   * Adds a list of components to the entity.  If entity already possesses a component of any of
   * the given types, the call will fail.
   * @param args A list of component types to add, optionally interleaved wth objects that specify
   *  fields values for initializing the immediately preceding component.
   */
  addAll(...args: (ComponentType<any> | Record<string, unknown>)[]): void {
    CHECK: this.__checkValid();
    for (let i = 0; i < args.length; i++) {
      const type = args[i];
      CHECK: {
        if (typeof type !== 'function') {
          throw new Error(`Bad arguments to bulk add: expected component type, got: ${type}`);
        }
      }
      let value: ComponentType<any> | Record<string, unknown> | undefined = args[i + 1];
      if (typeof value === 'function') value = undefined; else i++;
      this.add(type, value);
    }
  }

  /**
   * Remove a component from the entity.  If the entity doesn't posssess a component of this type
   * the call will fail.
   * @param type The type of component to remove.
   */
  remove(type: ComponentType<any>): void {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, true);
      this.__checkHas(type, false);
    }
    this.__registry.clearShape(this.__id, type);
  }

  /**
   * Remove a list of components from the entity.  If the entity doesn't possess a component of any
   * of the given types, the call will fail.
   * @param types A list of component types to remove.
   */
  removeAll(...types: ComponentType<any>[]): void {
    for (const type of types) this.remove(type);
  }

  /**
   * Returns whether the entity currently contains a component of the given type.  If a system is
   * running in `accessRecentlyDeletedData` mode, this will also return true for recently removed
   * components.
   *
   * @param type The type of component to check for.
   * @returns Whether the entity has a component of the given type.
   */
  has(type: ComponentType<any>): boolean {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, false);
    }
    return this.__registry.hasShape(this.__id, type, true);
  }

  /**
   * Obtains a component of the entity that will not allow writing to its fields.  If a component of
   * the given type is not part of this entity this method will fail, unless a system is running in
   * `accessRecentlyDeletedData` mode and the component was only recently removed.
   *
   * The component returned must be used immediately; you must not retain a reference to it beyond
   * the local scope.  Any subsequent request to read the same component type on any entity will
   * invalidate the object.
   * @param type The type of component to obtain.
   * @returns The component of the given type that is part of the entity, ready for reading.
   */
  read<C>(type: ComponentType<C>): Readonly<C> {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, false);
      this.__checkHas(type, true);
    }
    return type.__bind!(this.__id, false);
  }

  /**
   * Obtains a component of the entity that will allow writing to its fields, and mark the component
   * as having been written to (for `changed` queries).  If a component of the given type is not
   * part of this entity this method will fail, unless a system is running in
   * `accessRecentlyDeletedData` mode and the component was only recently removed.
   *
   * The component returned must be used immediately; you must not retain a reference to it beyond
   * the local scope.  Any subsequent request to write the same component type on any entity will
   * invalidate the object.
   * @param type The type of component to obtain.
   * @returns The component of the given type that is part of the entity, ready for reading and
   *  writing.
   */
  write<C>(type: ComponentType<C>): C {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, true);
      this.__checkHas(type, true);
    }
    if (type.__binding!.trackedWrites) this.__registry.trackWrite(this.__id, type);
    return type.__bind!(this.__id, true);
  }

  /**
   * Deletes this entity and removes all its components.
   */
  delete(): void {
    CHECK: this.__checkValid();
    const Alive = this.__registry.Alive;
    CHECK: if (!this.__registry.hasShape(this.__id, Alive, false)) {
      throw new Error('Entity already deleted');
    }
    for (const type of this.__registry.types) {
      if (this.__registry.hasShape(this.__id, type, false)) {
        CHECK: if (type !== Alive) this.__checkMask(type, true);
        this.__registry.clearShape(this.__id, type);
      }
    }
    this.__registry.dispatcher.indexer.clearAllRefs(this.__id, false);
  }

  /**
   * Creates a long-lived version of this entity object, that you can safely keep for as long as the
   * entity exists.  Once the entity is deleted (and swept up after the end of the next frame) all
   * further calls on the object will fail.
   * @returns A long-lived version of this entity object.
   */
  hold(): Entity {
    CHECK: this.__checkValid();
    return this.__registry.holdEntity(this.__id);
  }

  /**
   * Returns whether this entity and another one are in fact the same entity.  This can be useful
   * for comparing held entities to transient query ones.
   * @param other The other entity to match against.
   * @returns Whether this entity and the other one are the same.
   */
  isSame(other: Entity): boolean {
    CHECK: this.__checkValid();
    return this.__id === other.__id;
  }

  private __checkMask(type: ComponentType<any>, write: boolean): void {
    checkMask(type, this.__registry.executingSystem, write);
  }

  private __checkHas(type: ComponentType<any>, allowRecentlyDeleted: boolean): void {
    if (!this.__registry.hasShape(this.__id, type, allowRecentlyDeleted)) {
      throw new Error(`Entity doesn't have a ${type.name} component`);
    }
  }

  private __checkValid(): void {
    if (!this.__valid) throw new Error('Entity handle no longer valid');
  }
}


// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Entity extends EntityImpl {}


export function checkMask(
  type: ComponentType<any>, system: SystemBox | undefined, write: boolean
): void {
  checkTypeDefined(type);
  const mask = write ? system?.rwMasks.write : system?.rwMasks.read;
  const ok = !mask || ((mask[type.__binding!.shapeOffset] ?? 0) & type.__binding!.shapeMask) !== 0;
  if (!ok) {
    throw new Error(
      `System didn't mark component ${type.name} as ${write ? 'writable' : 'readable'}`);
  }
}

export function extendMaskAndSetFlag(mask: number[], type: ComponentType<any>): void {
  CHECK: checkTypeDefined(type);
  const flagOffset = type.__binding!.shapeOffset!;
  if (flagOffset >= mask.length) {
    const oldLength = mask.length;
    mask.length = flagOffset + 1;
    mask.fill(0, oldLength, flagOffset);
  }
  mask[flagOffset] |= type.__binding!.shapeMask!;
}
