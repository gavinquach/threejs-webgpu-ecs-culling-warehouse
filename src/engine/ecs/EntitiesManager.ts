import type {
  BoundsComponent,
  InteractiveComponent,
  RenderableComponent,
  TransformComponent,
} from "./components";

/** Stable numeric entity handle. Ids are never reused. */
export type Entity = number;

export interface ComponentMap {
  transform: TransformComponent;
  renderable: RenderableComponent;
  bounds: BoundsComponent;
  interactive: InteractiveComponent;
}

export type ComponentName = keyof ComponentMap;

type EntityRecord = Partial<ComponentMap>;

/**
 * Lightweight record-based ECS registry.
 *
 * A record per entity keeps the data flow obvious and avoids bookkeeping
 * duplication. Scene queries are flat scans, which is cheap at warehouse scale
 * and only happens once per frame.
 */
export class EntitiesManager {
  private nextId = 1;
  private readonly records = new Map<Entity, EntityRecord>();

  get entityCount(): number {
    return this.records.size;
  }

  createEntity(): Entity {
    const entity = this.nextId++;
    this.records.set(entity, {});
    return entity;
  }

  destroyEntity(entity: Entity): void {
    this.records.delete(entity);
  }

  hasEntity(entity: Entity): boolean {
    return this.records.has(entity);
  }

  addComponent<K extends ComponentName>(
    entity: Entity,
    name: K,
    value: ComponentMap[K],
  ): void {
    const record = this.records.get(entity);
    if (!record) throw new Error(`EntitiesManager: unknown entity ${entity}`);
    Object.assign(record, { [name]: value });
  }

  getComponent<K extends ComponentName>(
    entity: Entity,
    name: K,
  ): ComponentMap[K] | undefined {
    return this.records.get(entity)?.[name];
  }

  requireComponent<K extends ComponentName>(
    entity: Entity,
    name: K,
  ): ComponentMap[K] {
    const component = this.getComponent(entity, name);
    if (component === undefined) {
      throw new Error(`EntitiesManager: entity ${entity} is missing "${name}"`);
    }
    return component;
  }

  hasComponent<K extends ComponentName>(entity: Entity, name: K): boolean {
    return this.records.get(entity)?.[name] !== undefined;
  }

  removeComponent<K extends ComponentName>(entity: Entity, name: K): void {
    const record = this.records.get(entity);
    if (record) delete record[name];
  }

  /** Returns all entities that own every requested component. */
  query(...names: ComponentName[]): Entity[] {
    const result: Entity[] = [];

    entityLoop: for (const [entity, record] of this.records) {
      for (const name of names) {
        if (record[name] === undefined) continue entityLoop;
      }
      result.push(entity);
    }

    return result;
  }
}
