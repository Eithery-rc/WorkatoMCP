/**
 * Shared in-page helpers for the recipe Versions tab endpoints.
 *
 *   GET /recipes/<id>/versions.json?page=N
 *     -> { versions: [{version_no, major_version_no, created_at, user_name, comment}], total_count }
 *
 * Used by set-version-comment.ts (post-timeout verification) and
 * version-diff.ts (annotating the diff with version metadata).
 */

export interface RecipeVersionEntry {
  version_no: number;
  major_version_no?: number;
  created_at?: string;
  user_name?: string;
  comment?: string | null;
}

export interface VersionsInPageResult {
  ok: boolean;
  versions?: RecipeVersionEntry[];
  total_count?: number;
  failure?: {
    stage: 'fetch' | 'shape';
    status?: number;
    body_excerpt?: string;
    message: string;
  };
}

/**
 * Runs in the Workato tab's MAIN world. Self-contained, promise-chain based
 * (see pull-recipe.ts for why async/await is forbidden here).
 */
export function fetchRecipeVersionsInPage(
  recipeId: number,
  page: number,
): Promise<VersionsInPageResult> {
  return fetch(`/recipes/${recipeId}/versions.json?page=${page}`, {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
  }).then((r) =>
    r.text().then((bodyText) => {
      if (r.status < 200 || r.status >= 300) {
        return {
          ok: false,
          failure: {
            stage: 'fetch' as const,
            status: r.status,
            body_excerpt: bodyText.slice(0, 512),
            message: `GET /recipes/${recipeId}/versions.json?page=${page} returned HTTP ${r.status}`,
          },
        };
      }
      let json: unknown = null;
      try {
        json = JSON.parse(bodyText);
      } catch (e) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: bodyText.slice(0, 512),
            message: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        };
      }
      const versions = (json as any)?.versions;
      if (!Array.isArray(versions)) {
        return {
          ok: false,
          failure: {
            stage: 'shape' as const,
            body_excerpt: JSON.stringify(json).slice(0, 512),
            message: 'Unexpected response shape — missing versions array.',
          },
        };
      }
      return {
        ok: true,
        versions: versions.map((v: any) => ({
          version_no: Number(v?.version_no ?? 0),
          major_version_no:
            typeof v?.major_version_no === 'number' ? v.major_version_no : undefined,
          created_at: v?.created_at != null ? String(v.created_at) : undefined,
          user_name: v?.user_name != null ? String(v.user_name) : undefined,
          comment: v?.comment != null ? String(v.comment) : null,
        })),
        total_count: Number((json as any)?.total_count ?? versions.length),
      };
    }),
  );
}
