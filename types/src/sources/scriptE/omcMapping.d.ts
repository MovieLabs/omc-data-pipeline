/**
 * How Script-E's interim tables become OMC entities.
 *
 * This is data, not code. The generic builder in `src/omc/build.js` applies it; nothing
 * here knows how to construct an entity, and nothing in the builder knows about Script-E.
 *
 * The two grains reflect what Script-E actually records. A **Slate** is what is held at the
 * head of a take, so there is one per row of `takes`. A **ProductionScene** is a scene from
 * the breakdown, covered by however many takes, so it groups those rows.
 *
 * @memberof namespace:DataPipeline
 * @type {Array<DataPipeline.EntityMapping>}
 */
export const omcMappings: Array<DataPipeline.EntityMapping>;
//# sourceMappingURL=omcMapping.d.ts.map