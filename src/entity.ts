import {checkTypeDefined, ComponentType, initComponent} from './component';
import type {ComponentEnum} from './enums';
import {CheckError} from './errors';
import type {Registry} from './registry';
import type {SystemBox} from './system';


export type EntityId = number & {__entityIdBrand: symbol};
export type AccessMasks = {
  read?: number[], update?: number[], create?: number[], write?: number[], check?: number[]
};


/**
 * An entity represents a collection of distinct components with a unique identity.
 *
 * You can obtain entities from queries in your system.  You must not keep references to entities
 * thus obtained, as they may be pointed to another entity at any time between system executions.
 * Instead, call {@link Entity.hold} to obtain a long-lived version of the object.
 */
export class EntityImpl {
  declare __id: EntityId;
  declare __valid: boolean;
  declare __sortKey: any;

  constructor(private readonly __registry: Registry) {
    this.__id = undefined as unknown as EntityId;
    this.__sortKey = undefined;
    CHECK: {
      this.__valid = true;
    }
  }

  /**
   * Returns whether the entity is alive, i.e. has not been deleted.  Turning on
   * `accessRecentlyDeletedData` doesn't affect the return value.
   */
  get alive(): boolean {
    CHECK: this.__checkValid();
    return this.__registry.hasShape(this.__id, this.__registry.Alive, false);
  }

  /**
   * Returns the entity's ordinal number, as determined by the order of entity creation.  Entities
   * created in systems running concurrently may have overlapping ordinals.
   */
  get ordinal(): number {
    return this.__registry.entityOrdinals[this.__id];
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
      this.__checkMask(type, 'write');
      if (!this.__registry.hasShape(this.__id, this.__registry.Alive, false)) {
        throw new CheckError('Entity has been deleted');
      }
      if (this.__registry.hasShape(this.__id, type, false)) {
        throw new CheckError(`Entity already has a ${type.name} component`);
      }
    }
    this.__registry.setShape(this.__id, type);
    STATS: this.__registry.dispatcher.stats.forComponent(type).numEntities += 1;
    initComponent(type, this.__id, values, false);
  }

  /**
   * Adds a list of components to the entity.  If entity already possesses a component of any of
   * the given types, the call will fail.
   * @param args A list of component types to add, optionally interleaved wth objects that specify
   *  fields values for initializing the immediately preceding component.
   */
  addAll(...args: (ComponentType<any> | Record<string, unknown>)[]): void {
    CHECK: this.__checkValid();
    CHECK: {
      const enums = new Set<ComponentEnum>();
      for (const arg of args) {
        if (typeof arg === 'function' && arg.enum) {
          if (enums.has(arg.enum)) {
            throw new CheckError(`Can't add multiple components from the same enum`);
          }
          enums.add(arg.enum);
        }
      }
    }
    for (let i = 0; i < args.length; i++) {
      const type = args[i];
      CHECK: {
        if (typeof type !== 'function') {
          throw new CheckError(`Bad arguments to addAll: expected component type, got: ${type}`);
        }
      }
      let value: ComponentType<any> | Record<string, unknown> | undefined = args[i + 1];
      if (typeof value === 'function') value = undefined; else i++;
      this.add(type, value);
    }
  }

  /**
   * Remove a component from the entity.  If the entity doesn't possess a component of this type
   * the call will fail.
   * @param type The type of component to remove.
   */
  remove(type: ComponentType<any> | ComponentEnum): void {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, 'write');
      if (typeof type === 'function') this.__checkHas(type, false);
    }
    if (typeof type !== 'function') {
      const currentType = this.__registry.getEnumShape(this.__id, type, false);
      CHECK: if (!currentType) {
        throw new CheckError(`Entity doesn't have any components from ${type.name} enumeration`);
      }
      type = currentType;
    }
    this.__registry.clearShape(this.__id, type);
  }

  /**
   * Remove a list of components from the entity.  If the entity doesn't possess a component of any
   * of the given types, the call will fail.
   * @param types A list of component types to remove.
   */
  removeAll(...types: (ComponentType<any> | ComponentEnum)[]): void {
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
  has(type: ComponentType<any> | ComponentEnum): boolean {
    CHECK: {
      this.__checkValid();
      this.__checkMask(type, 'check');
    }
    if (typeof type === 'function') return this.__registry.hasShape(this.__id, type, true);
    return !!this.__registry.getEnumShape(this.__id, type, true);
  }

  // TODO: see if precomputing the masks and using Registry.match gets better performance on the
  // following has* methods.

  /**
   * Returns whether the entity currently contains a component of any of the given types.  If a
   * system is running in `accessRecentlyDeletedData` mode, this will also consider recently removed
   * components.
   * @param types A list of component types to check for.
   * @returns Whether the entity has a component of at least one of the given types.
   */
  hasSomeOf(...types: (ComponentType<any> | ComponentEnum)[]): boolean {
    CHECK: this.__checkValid();
    for (const type of types) if (this.has(type)) return true;
    return false;
  }

  /**
   * Returns whether the entity currently contains a component of every one of the given types.  If
   * a system is running in `accessRecentlyDeletedData` mode, this will also consider recently
   * removed components.
   * @param types A list of component types to check for.
   * @returns Whether the entity has a component of every one of the given types.
   */
  hasAllOf(...types: ComponentType<any>[]): boolean {
    CHECK: this.__checkValid();
    for (const type of types) if (!this.has(type)) return false;
    return true;
  }

  /**
   * Returns whether the entity currently contains a component of any type other than the given
   * ones.  If a system is running in `accessRecentlyDeletedData` mode, this will also consider
   * recently removed components.
   * @param types A list of component types to exclude from the check.
   * @returns Whether the entity has a component of a type not given.
   */
  hasAnyOtherThan(...types: (ComponentType<any> | ComponentEnum)[]): boolean {
    CHECK: this.__checkValid();
    const typeSet = new Set(types);
    for (const type of this.__registry.types) {
      CHECK: this.__checkMask(type, 'check');
      if (!(typeSet.has(type) || type.enum && typeSet.has(type.enum)) &&
          this.__registry.hasShape(this.__id, type, true)) return true;
    }
    return false;
  }

  /**
   * Counts the number of components of the given types the entity currently contains. If a system
   * is running in `accessRecentlyDeletedData` mode, this will also consider recently removed
   * components.
   * @param types A list of component types to count.
   * @returns The number of components present from among the given types.
   */
  countHas(...types: (ComponentType<any> | ComponentEnum)[]): number {
    CHECK: this.__checkValid();
    let count = 0;
    for (const type of types) if (this.has(type)) count += 1;
    return count;
  }

  /**
   * Returns the type from the given enumeration currently contained by the entity, if any.  If a
   * system is running in `accessRecentlyDeletedData` mode, this will also consider recently removed
   * components.
   * @param enumeration The enumeration of the desired types.
   * @returns A type from the enumeration if contained by the entity, or `undefined` if none.
   */
  hasWhich(enumeration: ComponentEnum): ComponentType<any> | undefined {
    CHECK: this.__checkValid();
    CHECK: this.__checkMask(enumeration, 'check');
    return this.__registry.getEnumShape(this.__id, enumeration, true);
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
      this.__checkMask(type, 'read');
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
      this.__checkMask(type, 'write');
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
      throw new CheckError('Entity already deleted');
    }
    for (const type of this.__registry.types) {
      if (this.__registry.hasShape(this.__id, type, false)) {
        CHECK: if (type !== Alive) this.__checkMask(type, 'write');
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

  private __checkMask(type: ComponentType<any> | ComponentEnum, kind: keyof AccessMasks): void {
    checkMask(type, this.__registry.executingSystem, kind);
  }

  private __checkHas(type: ComponentType<any>, allowRecentlyDeleted: boolean): void {
    if (!this.__registry.hasShape(this.__id, type, allowRecentlyDeleted)) {
      throw new CheckError(`Entity doesn't have a ${type.name} component`);
    }
  }

  private __checkValid(): void {
    if (!this.__valid) throw new CheckError('Entity handle no longer valid');
  }
}


// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Entity extends EntityImpl {}


export function checkMask(
  type: ComponentType<any> | ComponentEnum, system: SystemBox | undefined, kind: keyof AccessMasks
): void {
  checkTypeDefined(type);
  const mask = system?.accessMasks[kind];
  if (!mask) return;
  // Inline isMaskFlagSet for performance.
  const binding = type.__binding!;
  if (((mask[binding.shapeOffset] ?? 0) & binding.shapeMask) === 0) {
    throw new CheckError(`System ${system.name} didn't mark component ${type.name} as ${kind}able`);
  }
}

export function isMaskFlagSet(mask: number[], type: ComponentType<any> | ComponentEnum): boolean {
  const binding = type.__binding!;
  return ((mask[binding.shapeOffset] ?? 0) & binding.shapeMask) !== 0;
}

export function extendMaskAndSetFlag(
  mask: number[], type: ComponentType<any> | ComponentEnum, useValues?: false
): void;
export function extendMaskAndSetFlag(
  mask: number[], type: ComponentType<any>, useValues: true
): void;

export function extendMaskAndSetFlag(
  mask: number[], type: ComponentType<any> | ComponentEnum, useValues = false
): void {
  CHECK: checkTypeDefined(type);
  const flagOffset = type.__binding!.shapeOffset!;
  if (flagOffset >= mask.length) {
    const oldLength = mask.length;
    mask.length = flagOffset + 1;
    mask.fill(0, oldLength, flagOffset);
  }
  mask[flagOffset] |=
    useValues ? (type as ComponentType<any>).__binding!.shapeValue : type.__binding!.shapeMask!;
}
