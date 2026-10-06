/**
 * Check a set of mappings against a schema version, before any data is read.
 *
 * **The checks now live in omc-util**, as `omcMapping.check`. They moved with the entity builder,
 * because the Portal's mapping canvas needs exactly the same answers — is this a real entity type,
 * does this property exist, is this edge allowed, is this constant one of the schema's controlled
 * values — and two implementations of that would drift from each other and from the schema.
 *
 * This is a thin adapter, kept so the callers in this package do not have to change and so the
 * plural `mappings` reads naturally beside a `TableSet`. The shared version also checks three
 * things the local one never did: that every entity nominates a key column, that no two entities
 * share a type, and that an inverse is not declared from both ends of a pair.
 *
 * @memberof namespace:DataPipeline
 */

import { omcMapping } from 'omc-util';

import '../types.js'; // Type definitions, resolved globally by JSDoc

/**
 * Check mappings against the schema.
 *
 * @memberof namespace:DataPipeline
 * @function checkMappings
 * @param {Object} params
 * @param {Array<DataPipeline.EntityMapping>} params.mappings - The mappings to check
 * @param {DataPipeline.OmcOptions} [params.options] - Schema version comes from here
 * @returns {DataPipeline.MappingCheck} The outcome
 */
export function checkMappings({ mappings, options = {} }) {
    return omcMapping.check({ mapping: mappings, options });
}

export default checkMappings;
