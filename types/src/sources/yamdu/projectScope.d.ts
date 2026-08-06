/**
 * Drop the entities Yamdu returned that belong to other productions.
 *
 * Applied to the raw response, before migration: nothing downstream should have to reason about
 * data that was never asked for, and an entity migrated only to be discarded is wasted work.
 *
 * Only `CreativeWork` is filtered. Every other endpoint honours the `project` parameter — verified
 * against a full organisation pull, in which no entity of any other type referenced a foreign
 * project — so filtering them would risk dropping legitimate data to guard against a problem they
 * do not have.
 *
 * @param {Array<OmcEntity>} entities - Everything the endpoints returned
 * @param {string} projectId - The Yamdu project being read
 * @returns {{entities: Array<OmcEntity>, dropped: number}} What belongs to the project, and how
 *   many were discarded
 */
export default function scopeToProject(entities: Array<OmcEntity>, projectId: string): {
    entities: Array<OmcEntity>;
    dropped: number;
};
//# sourceMappingURL=projectScope.d.ts.map