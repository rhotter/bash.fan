import { sql, type SQL } from "drizzle-orm"

/** Database equivalent of playerSlug: find one player's memberships without
 * transferring the complete player directory to the app. */
export function playerSlugSql(name: SQL): SQL {
  return sql`trim(both '-' from regexp_replace(
    regexp_replace(
      regexp_replace(replace(replace(lower(${name}), '''', ''), '’', ''), '[^a-z0-9[:space:]-]', '', 'g'),
      '[[:space:]]+', '-', 'g'
    ), '-+', '-', 'g'
  ))`
}
