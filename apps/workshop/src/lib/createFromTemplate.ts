/**
 * One-tap list creation (UX pass 4.2, 4.3). Tapping a template, or a starter
 * on the empty home, makes the list straight away with the template's name,
 * emoji and color, then lands in it with home beneath and the add surface
 * open. The name is editable in the list header afterwards.
 */
import type { CreateListRequest } from "@workshop/shared";
import type { ToggleFeature } from "@workshop/shared/listKinds";
import { type ListTemplate, templateListName } from "@workshop/shared/templates";
import { type Href, router } from "expo-router";

/** The create request for a template, with optional overrides from Customize. */
export function templateCreateRequest(
  template: ListTemplate,
  overrides: Partial<Pick<CreateListRequest, "name" | "emoji" | "color" | "description">> & {
    coverPhotoUrl?: string | null;
    /** Features chosen in Customize; the template's defaults otherwise. */
    modules?: ToggleFeature[];
  } = {},
): CreateListRequest {
  const name = overrides.name?.trim() || templateListName(template);
  const description = overrides.description?.trim();
  return {
    name,
    emoji: overrides.emoji ?? template.defaults.emoji,
    color: overrides.color ?? template.defaults.color,
    itemKind: template.defaults.itemKind,
    modules: overrides.modules ?? template.defaults.modules,
    ...(description ? { description } : {}),
    ...(overrides.coverPhotoUrl ? { coverPhotoUrl: overrides.coverPhotoUrl } : {}),
    // Templates like Letterboxd match attach a fixed-config source; no prompt.
    ...(template.autoSource
      ? { sources: [{ kind: template.autoSource.kind, config: template.autoSource.config }] }
      : {}),
  };
}

/** `/list/:id/add` with the given params, as an href. */
export function addSurfaceHref(listId: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/list/${listId}/add?${qs}` : `/list/${listId}/add`;
}

/**
 * Land on a brand-new list: home beneath it (so back goes home, 3.8) and the
 * add surface open on top, prefilled when a share is being carried through.
 * For routes inside the `(lists)` stack.
 */
export function openNewList(listId: string, addParams: Record<string, string> = {}): void {
  router.dismissTo("/");
  router.push(`/list/${listId}` as Href);
  router.push(addSurfaceHref(listId, addParams) as Href);
}
