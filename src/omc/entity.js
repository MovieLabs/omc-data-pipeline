/**
 * Minting an entity from a key and a set of resolved properties.
 *
 * **This now lives in omc-util**, as `omcMapping`. It moved because the same logic drives the
 * Portal's mapping canvas: identity hashed from a key, the shape deciding which properties an
 * entity may carry, schema-required defaults filled in. Two implementations of that would drift,
 * and the browser needs one too.
 *
 * Re-exported rather than deleted so nothing in this package has to change its imports, and so a
 * reader who comes looking for `createEntity` here finds out where it went.
 *
 * @see {@link https://github.com/MovieLabs/omc-util} `src/omc/omcMapping/entity.js`
 */

export {
    DEFAULT_OPTIONS,
    resolveOptions,
    seedFor,
    createEntity,
    entityRef,
} from 'omc-util/mapping';
