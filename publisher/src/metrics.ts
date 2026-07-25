import type { PublisherMetrics } from "./types.ts";

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function formatPrometheusMetrics(metrics: PublisherMetrics): string {
  const lines: string[] = [];

  lines.push("# HELP publisher_total_submitted Total number of leaf submissions received.");
  lines.push("# TYPE publisher_total_submitted counter");
  lines.push(`publisher_total_submitted ${metrics.totalSubmitted}`);

  lines.push("# HELP publisher_total_accepted Total number of leaf submissions accepted into the inbox.");
  lines.push("# TYPE publisher_total_accepted counter");
  lines.push(`publisher_total_accepted ${metrics.totalAccepted}`);

  lines.push("# HELP publisher_total_rejected Total number of leaf submissions rejected (backpressure).");
  lines.push("# TYPE publisher_total_rejected counter");
  lines.push(`publisher_total_rejected ${metrics.totalRejected}`);

  lines.push("# HELP publisher_total_published Total number of root publications to chain.");
  lines.push("# TYPE publisher_total_published counter");
  lines.push(`publisher_total_published ${metrics.totalPublished}`);

  lines.push("# HELP publisher_inbox_depth Current number of items in the inbox queue.");
  lines.push("# TYPE publisher_inbox_depth gauge");
  lines.push(`publisher_inbox_depth ${metrics.currentInboxDepth}`);

  lines.push("# HELP publisher_leaf_count Current number of leaves in the Merkle tree.");
  lines.push("# TYPE publisher_leaf_count gauge");
  lines.push(`publisher_leaf_count ${metrics.currentLeafCount}`);

  lines.push("# HELP publisher_last_publish_latency_ms Latency of the last successful publish tick in milliseconds.");
  lines.push("# TYPE publisher_last_publish_latency_ms gauge");
  lines.push(`publisher_last_publish_latency_ms ${metrics.lastPublishLatencyMs ?? -1}`);

  lines.push("# HELP publisher_uptime_seconds Seconds since the publisher process started.");
  lines.push("# TYPE publisher_uptime_seconds gauge");
  const uptimeMs = Date.now() - new Date(metrics.startedAt).getTime();
  lines.push(`publisher_uptime_seconds ${(uptimeMs / 1000).toFixed(1)}`);

  return lines.join("\n") + "\n";
}
