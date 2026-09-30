export const MAIN_CONTENT_ID = "main-content";

/** First focusable element on every page: lets keyboard users bypass navigation. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only rounded-md bg-surface px-4 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
    >
      Skip to main content
    </a>
  );
}
