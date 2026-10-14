/**
 * Resource ownership for saved recipes.
 *
 * Saved recipes live in the C++ engine's storage, which knows nothing
 * about users. Ownership is therefore enforced HERE, at the Node edge --
 * the only way into the engine -- by recording the owner's id inside each
 * saved record and checking it on every access.
 *
 *  - The owner id is always taken from the authenticated session, never
 *    from the request: a client-supplied `ownerId` is overwritten.
 *  - A record with no ownerId (saved before accounts existed) belongs to
 *    nobody, so no user can read or delete it through the API.
 *  - `ownerId` is an internal field and is stripped from responses.
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Returns a copy of `recipe` owned by `user`. Non-objects are returned as-is (the engine rejects them). */
function stampOwner(recipe, user) {
  if (!isPlainObject(recipe)) return recipe;
  return { ...recipe, ownerId: user.id };      // spread first, so a client-sent ownerId is overwritten
}

function isOwner(record, user) {
  return isPlainObject(record) && Boolean(user)
    && typeof record.ownerId === 'string' && typeof user.id === 'string'
    && record.ownerId === user.id;
}

/** Removes internal-only fields before a record is sent to a client. */
function toClientRecipe(record) {
  if (!isPlainObject(record)) return record;
  const { ownerId, ...rest } = record;          // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = { stampOwner, isOwner, toClientRecipe };
