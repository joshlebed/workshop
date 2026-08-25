interface HTMLRewriterElement {
  append(content: string, options?: { html?: boolean }): void;
  remove(): void;
  setInnerContent(content: string, options?: { html?: boolean }): void;
}

interface HTMLRewriterElementHandler {
  element(element: HTMLRewriterElement): void;
}

declare class HTMLRewriter {
  on(selector: string, handler: HTMLRewriterElementHandler): this;
  transform(response: Response): Response;
}
