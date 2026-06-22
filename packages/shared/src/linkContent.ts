import type { ItemContent, LinkPreview } from "./types.js";

const LINK_CONTENT_LIMITS = {
  sourceId: 2048,
  image: 2048,
  imageProxy: 2048,
  thumbnailUrl: 2048,
  siteName: 200,
  title: 500,
  description: 2000,
} as const;

function clampText(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function boundedUrl(value: string | null | undefined, max: number): string | undefined {
  if (!value || value.length > max) return undefined;
  return value;
}

function firstBoundedUrl(
  values: readonly (string | null | undefined)[],
  max: number,
): string | undefined {
  for (const value of values) {
    const bounded = boundedUrl(value, max);
    if (bounded) return bounded;
  }
  return undefined;
}

export function linkPreviewToItemContent(preview: LinkPreview): ItemContent {
  const content: Record<string, unknown> = { source: "link_preview" };

  const sourceId = boundedUrl(preview.finalUrl, LINK_CONTENT_LIMITS.sourceId);
  if (sourceId) content.sourceId = sourceId;

  const image = boundedUrl(preview.image, LINK_CONTENT_LIMITS.image);
  if (image) content.image = image;

  const imageProxy = boundedUrl(preview.imageProxy, LINK_CONTENT_LIMITS.imageProxy);
  if (imageProxy) content.imageProxy = imageProxy;

  const thumbnail = firstBoundedUrl(
    [preview.imageProxy, preview.image, preview.favicon],
    LINK_CONTENT_LIMITS.thumbnailUrl,
  );
  if (thumbnail) content.thumbnailUrl = thumbnail;

  const siteName = clampText(preview.siteName, LINK_CONTENT_LIMITS.siteName);
  if (siteName) content.siteName = siteName;

  const title = clampText(preview.title, LINK_CONTENT_LIMITS.title);
  if (title) content.title = title;

  const description = clampText(preview.description, LINK_CONTENT_LIMITS.description);
  if (description) content.description = description;

  return content;
}
