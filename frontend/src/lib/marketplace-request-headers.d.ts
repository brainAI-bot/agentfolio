export function createMarketplaceMutationHeaders(
  actorId: string,
  idempotencyKey?: string,
): Record<string, string>;

export interface MarketplaceMutationKeyStore {
  keyFor(fingerprint: string, explicitKey?: string): string;
  settle(fingerprint: string, responseStatus: number): void;
}

export function createMarketplaceMutationKeyStore(): MarketplaceMutationKeyStore;
