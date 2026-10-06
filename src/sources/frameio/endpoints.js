/**
 * Where the Frame.io V4 API lives, and how to address the parts of it this pipeline reads.
 *
 * Paths are built here rather than interpolated at each call site so that the one structural fact
 * about this API — **every resource is scoped by account** — is stated once. `/v4/projects/{id}`
 * does not exist; it is `/v4/accounts/{account_id}/projects/{project_id}`, and the same is true of
 * folders, files and version stacks. A run therefore needs an account id as well as a project id.
 *
 * Taken from the published OpenAPI document (`https://api.frame.io/v4/openapi.json`), which is
 * authoritative — the prose documentation only spells out `/me` and `/accounts`.
 *
 * @namespace namespace:DataPipeline.frameio
 */

/** The API root. `links.next` comes back as a path, so it is resolved against this origin. */
export const ORIGIN = 'https://api.frame.io';

/** Every path below is relative to the origin, so a `links.next` path can be used unchanged. */
export const BASE_PATH = '/v4';

/**
 * Rows per page, for every collection except a folder's children.
 *
 * **100 is a hard cap, not a preference.** The V4 schema has two page-size types and they differ:
 * `AssetRequestPageSize` allows 500, and `RequestPageSize` — used by comments, version-stack
 * children, accounts and projects — allows 100. Asking for more is a 422 naming the limit, not a
 * silently clamped page. This is the conservative one, so it is the default and a new endpoint is
 * safe without anyone checking.
 */
export const PAGE_SIZE = 100;

/**
 * Rows per page for a folder's children, which is the one collection that allows more.
 *
 * Worth taking: the rate limit is on *requests*, not rows, and a tree walk is many small listings,
 * so bigger pages are exactly what keeps a deep walk inside the limit.
 */
export const ASSET_PAGE_SIZE = 500;

/** The authenticated user. Used only to check the token before a walk starts. */
export const me = () => `${BASE_PATH}/me`;

/** Accounts the token can see. Used to resolve the account when the project setting omits it. */
export const accounts = () => `${BASE_PATH}/accounts`;

/**
 * One project. The response carries `root_folder_id`, which is where the walk begins.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.projectId
 * @returns {string} The path
 */
export const project = ({ accountId, projectId }) => `${BASE_PATH}/accounts/${encodeURIComponent(accountId)}`
    + `/projects/${encodeURIComponent(projectId)}`;

/**
 * Sideloads asked for on every folder listing.
 *
 * A file record is sparse by default — 13 fields, none of which describe the media or the take.
 * Everything else Frame.io knows arrives only through `include=metadata`: the technical inspection
 * it derives itself (resolution, codecs, bit rates, frame rate, duration) and every custom field the
 * account defines (Slate, Scene, Take, Camera, `OMC Take ID`).
 *
 * It is **free**: the same request, the same page, no per-file call and no extra rate-limit cost.
 * There is no reason a walk would ever not ask for it.
 */
export const CHILDREN_INCLUDE = 'metadata';

/**
 * Sideloads asked for on a comment listing.
 *
 * `owner` because the comment record itself carries no author at all — of its 17 fields not one
 * names who wrote it, so without this an annotation would arrive anonymous. `replies` because a
 * threaded reply is a comment on the same file and belongs with the rest of them.
 *
 * Both are the enum's own values. Comma-separated: the schema types `include` as a single string,
 * but the folder-children parameter documents `project,creator,metadata` as its example, so the
 * list form is what the API actually takes.
 */
export const COMMENT_INCLUDE = 'owner,replies';

/**
 * A folder's immediate children — files, folders and version stacks together, discriminated by
 * each item's `type`.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.folderId
 * @returns {string} The path
 */
export const folderChildren = ({ accountId, folderId }) => `${BASE_PATH}/accounts/${encodeURIComponent(accountId)}`
    + `/folders/${encodeURIComponent(folderId)}/children?include=${CHILDREN_INCLUDE}`;

/**
 * One file's comments, newest first.
 *
 * Read only for files whose `Comment Count` metadata is non-zero — the count arrives with the walk,
 * so the great majority of files cost no request at all.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.fileId
 * @returns {string} The path
 */
export const fileComments = ({ accountId, fileId }) => `${BASE_PATH}/accounts/${encodeURIComponent(accountId)}`
    + `/files/${encodeURIComponent(fileId)}/comments?include=${COMMENT_INCLUDE}`;

/**
 * One comment, with its author.
 *
 * Read only for **replies**, and only because `include=owner` on the file's comment listing
 * decorates the top-level comments and not the replies nested inside them — a reply comes back with
 * no `owner` key at all. Verified against the live API: fetched on its own with `include=owner`, the
 * same reply names its author. So this exists to fill a gap in the listing, at one request per
 * reply, and is skipped entirely for a comment that already has an owner.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.commentId
 * @returns {string} The path
 */
export const comment = ({ accountId, commentId }) => `${BASE_PATH}/accounts/${encodeURIComponent(accountId)}`
    + `/comments/${encodeURIComponent(commentId)}?include=owner`;

/**
 * A version stack's versions, newest first.
 *
 * Only read when a stack arrives without its `head_version` inlined; see `tree.js` for why a stack
 * contributes one asset rather than one per version.
 *
 * @param {Object} params
 * @param {string} params.accountId
 * @param {string} params.versionStackId
 * @returns {string} The path
 */
export const versionStackChildren = ({ accountId, versionStackId }) => `${BASE_PATH}`
    + `/accounts/${encodeURIComponent(accountId)}`
    + `/version_stacks/${encodeURIComponent(versionStackId)}/children`;
