/**
 * The OMC endpoints Yamdu's Third-Party API exposes, each reachable at
 * `/ThirdPartyApi/v1/OMC/<name>`.
 *
 * Data, not code: a new endpoint is a line here. Every one returns OMC entities directly, which is
 * what makes this source unlike a delivery-based one — there is nothing to parse or map, only to
 * fetch and bring up to the project's schema version.
 *
 * API docs: https://app.yamdu.com/thirdpartyapi/docs#tag/omc
 *
 * @memberof namespace:DataPipeline
 * @type {Array<string>}
 */
export const ENDPOINTS = [
    'AllCharacters',
    'AllCreativeWorks',
    'AllEffects',
    'AllNarrativeAudios',
    'AllNarrativeLocations',
    'AllNarrativeObjects',
    'AllNarrativeScenes',
    'AllNarrativeWardrobes',
    'AllParticipants',
    'AllProductionLocations',
    'AllProductionScenes',
    'AllShootDayContexts',
    'AllSpecialActions',
];

/** Yamdu's maximum, and its default, page size. */
export const PAGE_SIZE = 50;

/** Where the Third-Party API lives. */
export const BASE_URL = 'https://app.yamdu.com/ThirdPartyApi/v1/OMC';
