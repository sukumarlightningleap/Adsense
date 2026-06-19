"use server";

/**
 * Server action behind the "Repair" button on the health page.
 *
 * v1 scope: just generates a ready-to-paste gtag snippet pre-filled with
 * the Google Ads customer ID. The customer fills in the conversion label
 * placeholder from their Google Ads UI.
 *
 * v1.1 will swap this for a TagSnippetService call so the label is
 * auto-filled and a verifier endpoint that fires a test event.
 */
import { auth } from "@/auth";
import { db } from "@/lib/db";

export type FetchSnippetResult =
  | {
      ok: true;
      snippet: {
        conversionId: string;
        customerId: string;
        gtagSnippet: string;
        noScriptSnippet: string;
      };
    }
  | { ok: false; error: string };

export async function fetchSnippetAction(
  conversionId: string,
): Promise<FetchSnippetResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign-in required." };

  const action = await db.conversionAction.findFirst({
    where: { id: conversionId },
    select: {
      id: true,
      providerConversionId: true,
      account: {
        select: { id: true, customerId: true, userId: true },
      },
    },
  });
  if (!action) return { ok: false, error: "Conversion action not found." };
  if (action.account.userId !== session.user.id) {
    return { ok: false, error: "Not your conversion action." };
  }

  // The gtag conversion ID format is `AW-<customer-id>`. The
  // <conversion-label> is the per-action snippet ID — surfaced in
  // Google Ads UI under Goals → Tag setup. We placeholder it for now;
  // v1.1 fetches it via TagSnippetService.
  const awId = `AW-${action.account.customerId.replace(/-/g, "")}`;

  const gtagSnippet = `<!-- Global site tag (gtag.js) - Google Ads -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${awId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${awId}');
</script>

<!-- Fire on the page that represents the conversion (e.g. /thanks) -->
<script>
  gtag('event', 'conversion', {
    'send_to': '${awId}/YOUR_LABEL_HERE',
    'value': 1.0,
    'currency': 'USD'
  });
</script>`;

  const noScriptSnippet = `<noscript>
  <img src="https://www.googleadservices.com/pagead/conversion/${action.account.customerId.replace(
    /-/g,
    "",
  )}/?label=YOUR_LABEL_HERE&amp;guid=ON&amp;script=0" />
</noscript>`;

  return {
    ok: true,
    snippet: {
      conversionId: action.providerConversionId ?? action.id,
      customerId: action.account.customerId,
      gtagSnippet,
      noScriptSnippet,
    },
  };
}
