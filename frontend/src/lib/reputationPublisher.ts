export interface ReputationPublisherInclusion {
  verifierId: string;
  leaf: string;
  leafIndex: number;
  leafCount: number;
  root: string;
  datasetHash: string;
  pathElements: string[];
  pathIndices: number[];
}

export interface ReputationLeafSubmission {
  id: string;
  leaf: string;
  schemaId?: string;
  attestationUid?: string;
  txHash?: string;
  ledger?: number;
}

function publisherBaseUrl(): string {
  const raw = (import.meta.env.VITE_REPUTATION_PUBLISHER_URL as string | undefined)?.trim();
  if (!raw) {
    throw new Error(
      "Reputation publisher URL is not configured. Set VITE_REPUTATION_PUBLISHER_URL to enable on-chain PSR proofs.",
    );
  }
  return raw.replace(/\/+$/, "");
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new Error(`Reputation publisher request failed: ${detail}`);
  }
  return data as T;
}

export async function submitLeafAndFetchInclusion(
  submission: ReputationLeafSubmission,
): Promise<ReputationPublisherInclusion> {
  const base = publisherBaseUrl();
  const res = await fetch(`${base}/v1/reputation/leaves`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
  });
  const data = await parseJsonResponse<{ inclusion?: ReputationPublisherInclusion }>(res);
  if (data.inclusion) return data.inclusion;
  return fetchLeafInclusion(submission.leaf);
}

export async function fetchLeafInclusion(leaf: string): Promise<ReputationPublisherInclusion> {
  const base = publisherBaseUrl();
  const res = await fetch(`${base}/v1/reputation/root/${encodeURIComponent(leaf)}`);
  return parseJsonResponse<ReputationPublisherInclusion>(res);
}
