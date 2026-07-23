export interface OperationalMetricsSnapshot {
	directResponses: number;
	directCostUsd: number;
}

/** In-memory only: no messages, prompts, files, or metrics are written to the vault. */
export class OperationalMetrics {
	private directResponses = 0;
	private directCostUsd = 0;

	recordDirectResponseCost(previousCost: number | undefined, nextCost: number): void {
		if (!Number.isFinite(nextCost) || nextCost < 0) return;
		if (previousCost === undefined) this.directResponses += 1;
		this.directCostUsd += nextCost - (previousCost ?? 0);
	}

	snapshot(): OperationalMetricsSnapshot {
		return { directResponses: this.directResponses, directCostUsd: Math.max(0, this.directCostUsd) };
	}
}
