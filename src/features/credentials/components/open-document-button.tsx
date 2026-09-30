import { Button } from "@/components/ui/button";

import { openDocumentAction } from "../actions";

/**
 * POSTs to the audited access gate, which redirects to a 60-second signed URL.
 * The URL is never rendered into the page, stored or logged.
 */
export function OpenDocumentButton(props: {
  documentId: string;
  organisationId?: string;
  label: string;
}) {
  return (
    <form action={openDocumentAction}>
      <input type="hidden" name="documentId" value={props.documentId} />
      {props.organisationId ? (
        <input type="hidden" name="organisationId" value={props.organisationId} />
      ) : null}
      <Button type="submit" variant="outline" size="sm" aria-label={props.label}>
        Open
      </Button>
    </form>
  );
}
