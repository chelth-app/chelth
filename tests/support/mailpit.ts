/**
 * Reads auth emails captured by the LOCAL Mailpit instance (never a real
 * mailbox). Used to complete real sign-up / recovery flows in tests.
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[]; Created: string };

async function findLatest(
  to: string,
  subjectIncludes: string,
): Promise<MailpitSummary | undefined> {
  const response = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`,
  );
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const body = (await response.json()) as { messages: MailpitSummary[] };
  return body.messages
    .filter((message) => message.Subject.includes(subjectIncludes))
    .sort((a, b) => b.Created.localeCompare(a.Created))[0];
}

/** Waits for the newest matching email and returns the first link in its HTML body. */
export async function waitForEmailLink(
  to: string,
  subjectIncludes: string,
  { timeoutMs = 15_000, after }: { timeoutMs?: number; after?: Date } = {},
): Promise<URL> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const summary = await findLatest(to, subjectIncludes);
    if (summary && (!after || new Date(summary.Created) >= after)) {
      const message = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${summary.ID}`)
      ).json()) as {
        HTML: string;
      };
      const href = /href="([^"]+)"/.exec(message.HTML)?.[1];
      if (!href) throw new Error("Email contained no link");
      return new URL(href.replaceAll("&amp;", "&"));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No "${subjectIncludes}" email for ${to} within ${timeoutMs}ms`);
}

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}
