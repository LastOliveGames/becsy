
export const ENTITY_ID_BITS = 23;
export const COMPONENT_ID_BITS = 32 - ENTITY_ID_BITS;
export const FIELD_SEQ_BITS = COMPONENT_ID_BITS - 2;

export const MAX_NUM_ENTITIES = 2 ** ENTITY_ID_BITS;
export const ENTITY_ID_MASK = MAX_NUM_ENTITIES - 1;
export const MAX_NUM_COMPONENTS = 2 ** COMPONENT_ID_BITS;
export const MAX_NUM_FIELDS = 2 ** FIELD_SEQ_BITS;

// TODO: enforce max length of ref structs/arrays
