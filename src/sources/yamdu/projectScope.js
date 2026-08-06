import '../../types.js'; // Type definitions, resolved globally by JSDoc

/** How Yamdu names a project in an identifier. */
const projectIdentifier = (projectId) => `com.yamdu.app.project.${projectId}`;

/**
 * Does this CreativeWork belong to the project being read?
 *
 * `AllCreativeWorks` returns every creative work in the **organisation**, not the project — the one
 * endpoint that ignores the `project` query parameter. In the sample pull that is 39 entities
 * spanning 21 productions, of which one is ours.
 *
 * A creative work says which project it belongs to in one of two ways, and both have to be checked:
 *
 * - **The project itself** carries `com.yamdu.app.project.<id>` as its own identifier.
 * - **An episode** carries `com.yamdu.app.episode.<id>` — its own id, not the project's — and names
 *   the project through its `Season` reference instead.
 *
 * Matching on the entity's own identifier alone would therefore drop every episode of a project
 * that has them. It happens to give the right answer for this production, which has no episodes,
 * but only by luck: the sample pull contains 18 episodes belonging to two other productions, and a
 * naive match would discard the same way for a production whose episodes are its own.
 *
 * The comparison is against the whole identifier rather than a substring of it, so project `12959`
 * cannot match `129593`.
 *
 * @param {OmcEntity} entity - A v2.x CreativeWork, before migration
 * @param {string} projectId - The Yamdu project being read
 * @returns {boolean} True when the work belongs to that project
 */
function creativeWorkInProject(entity, projectId) {
    const wanted = projectIdentifier(projectId);
    const ownIds = (entity.identifier ?? []).map((id) => id?.identifierValue);
    if (ownIds.includes(wanted)) return true;

    const seasonIds = (entity.Season ?? [])
        .flatMap((season) => season?.identifier ?? [])
        .map((id) => id?.identifierValue);
    return seasonIds.includes(wanted);
}

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
export default function scopeToProject(entities, projectId) {
    const kept = entities.filter((entity) => (
        entity?.entityType !== 'CreativeWork' || creativeWorkInProject(entity, projectId)
    ));
    return { entities: kept, dropped: entities.length - kept.length };
}
