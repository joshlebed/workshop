import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { CreateListRequest } from "@workshop/shared";
import type { ListTemplate } from "@workshop/shared/templates";
import { haptics, useToast } from "@workshop/ui";
import { createList } from "../api/lists";
import { openNewList, templateCreateRequest } from "../lib/createFromTemplate";
import { createListErrorMessage } from "../lib/errorCopy";
import { useAuth } from "./useAuth";

interface CreateVars {
  template: ListTemplate;
  overrides?: Parameters<typeof templateCreateRequest>[1];
  /** Params for the add surface the new list opens with (a carried share). */
  addParams?: Record<string, string>;
}

/**
 * Make a list from a template and land in it with the add surface open
 * (4.2, 4.3). `pendingTemplateId` drives the busy row.
 */
export function useCreateFromTemplate() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const mutation = useMutation({
    mutationFn: ({ template, overrides }: CreateVars) => {
      const body: CreateListRequest = templateCreateRequest(template, overrides);
      return createList(body, token);
    },
    onSuccess: async (res, vars) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      openNewList(res.list.id, vars.addParams);
    },
    onError: (e) => showToast({ message: createListErrorMessage(e), tone: "danger" }),
  });
  return {
    create: (vars: CreateVars) => {
      if (mutation.isPending) return;
      haptics.success();
      mutation.mutate(vars);
    },
    pendingTemplateId: mutation.isPending ? (mutation.variables?.template.id ?? null) : null,
  };
}
