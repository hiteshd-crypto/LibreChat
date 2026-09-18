/**
 * Token Pricing Configuration
 *
 * Pattern Matching
 * ================
 * `findMatchingPattern` uses `modelName.includes(key)` and selects the **longest**
 * matching key. If a key's length equals the model name's length (exact match), it
 * returns immediately — no further keys are checked.
 *
 * For keys of different lengths, definition order does not affect the result — the
 * longest match always wins. For **same-length ties**, the function iterates in
 * reverse, so the last-defined key wins. Key ordering therefore matters for:
 * 1. **Performance**: list older/legacy models first, newer models last — newer
 *    models are more commonly used and will match earlier in the reverse scan.
 * 2. **Same-length tie-breaking**: when two keys of equal length both match,
 *    the last-defined key wins.
 */

export interface TxDeps {
  /** From @librechat/api — matches a model name to a canonical key. */
  matchModelName: (model: string, endpoint?: string) => string | undefined;
  /** From @librechat/api — finds the longest key in `values` whose key is a substring of `model`. */
  findMatchingPattern: (
    model: string,
    values: Record<string, number | Record<string, number>>,
  ) => string | undefined;
}

export const defaultRate = 6;

/**
 * Mapping of model token sizes to their respective multipliers for prompt and completion.
 * The rates are 1 USD per 1M tokens.
 */
export const tokenValues: Record<string, { prompt: number; completion: number }> = {};

/**
 * Mapping of model token sizes to their respective multipliers for cached input, read and write.
 * The rates are 1 USD per 1M tokens.
 */
export const cacheTokenValues: Record<string, { write: number; read: number }> = {};

/**
 * Premium (tiered) pricing for models whose rates change based on prompt size.
 */
export const premiumTokenValues: Record<
  string,
  { threshold: number; prompt: number; completion: number }
> = {};

/**
 * Premium (tiered) cache pricing for models whose cache rates change once the
 * prompt crosses the long-context threshold. Cache write/read scale by the same
 * multiplier the long-context tier applies to input (e.g. 2x for the gpt-5.x
 * family), so these mirror `premiumTokenValues` on the cache dimension.
 */
export const premiumCacheTokenValues: Record<
  string,
  { threshold: number; write: number; read: number }
> = {
  'gpt-5.4': { threshold: 272000, write: 5, read: 0.5 },
  'gpt-5.5': { threshold: 272000, write: 10, read: 1 },
  'gpt-5.6': { threshold: 272000, write: 10, read: 0.8 },
  'gpt-5.6-terra': { threshold: 272000, write: 5, read: 0.4 },
  'gpt-5.6-luna': { threshold: 272000, write: 0.5, read: 0.04 },
};

export function createTxMethods(
  _mongoose: typeof import('mongoose'),
  txDeps: TxDeps,
): {
  tokenValues: Record<
    string,
    {
      prompt: number;
      completion: number;
    }
  >;
  premiumTokenValues: Record<
    string,
    {
      threshold: number;
      prompt: number;
      completion: number;
    }
  >;
  getValueKey: (model: string, endpoint?: string) => string | undefined;
  getMultiplier: ({
    model,
    valueKey,
    endpoint,
    tokenType,
    inputTokenCount,
    endpointTokenConfig,
  }: {
    model?: string;
    valueKey?: string;
    endpoint?: string;
    tokenType?: 'prompt' | 'completion';
    inputTokenCount?: number;
    endpointTokenConfig?: Record<string, Record<string, number>>;
  }) => number;
  getPremiumRate: (
    valueKey: string,
    tokenType: string,
    inputTokenCount?: number | null,
  ) => number | null;
  getCacheMultiplier: ({
    valueKey,
    cacheType,
    model,
    endpoint,
    endpointTokenConfig,
    inputTokenCount,
  }: {
    valueKey?: string;
    cacheType?: 'write' | 'read';
    model?: string;
    endpoint?: string;
    endpointTokenConfig?: Record<string, Record<string, number>>;
    inputTokenCount?: number | null;
  }) => number | null;
  defaultRate: number;
  cacheTokenValues: Record<
    string,
    {
      write: number;
      read: number;
    }
  >;
} {
  const { matchModelName, findMatchingPattern } = txDeps;

  /**
   * Retrieves the key associated with a given model name.
   */
  function getValueKey(model: string, endpoint?: string): string | undefined {
    if (!model || typeof model !== 'string') {
      return undefined;
    }

    if (!endpoint || (typeof endpoint === 'string' && !tokenValues[endpoint])) {
      const matchedKey = findMatchingPattern(model, tokenValues);
      if (matchedKey) {
        return matchedKey;
      }
    }

    const modelName = matchModelName(model, endpoint);
    if (!modelName) {
      return undefined;
    }

    if (modelName.includes('gpt-3.5-turbo-16k')) {
      return '16k';
    } else if (modelName.includes('gpt-3.5')) {
      return '4k';
    } else if (modelName.includes('gpt-4-vision')) {
      return 'gpt-4-1106';
    } else if (modelName.includes('gpt-4-0125')) {
      return 'gpt-4-1106';
    } else if (modelName.includes('gpt-4-turbo')) {
      return 'gpt-4-1106';
    } else if (modelName.includes('gpt-4-32k')) {
      return '32k';
    } else if (modelName.includes('gpt-4')) {
      return '8k';
    }

    return undefined;
  }

  /**
   * Checks if premium (tiered) pricing applies and returns the premium rate.
   */
  function getPremiumRate(
    valueKey: string,
    tokenType: string,
    inputTokenCount?: number | null,
  ): number | null {
    if (inputTokenCount == null) {
      return null;
    }
    const premiumEntry = premiumTokenValues[valueKey];
    if (!premiumEntry || inputTokenCount <= premiumEntry.threshold) {
      return null;
    }
    return premiumEntry[tokenType as 'prompt' | 'completion'] ?? null;
  }

  /**
   * Retrieves the multiplier for a given value key and token type.
   */
  function getMultiplier({
    model,
    valueKey,
    endpoint,
    tokenType,
    inputTokenCount,
    endpointTokenConfig,
  }: {
    model?: string;
    valueKey?: string;
    endpoint?: string;
    tokenType?: 'prompt' | 'completion';
    inputTokenCount?: number;
    endpointTokenConfig?: Record<string, Record<string, number>>;
  }): number {
    if (endpointTokenConfig && model) {
      const modelConfig = endpointTokenConfig[model];
      /** A partial override only prices the models it lists; others fall
       *  through to the standard tables so billing matches the advertised
       *  token config instead of charging defaultRate */
      if (modelConfig) {
        return modelConfig[tokenType as string] ?? defaultRate;
      }
    }

    if (valueKey && tokenType) {
      const premiumRate = getPremiumRate(valueKey, tokenType, inputTokenCount);
      if (premiumRate != null) {
        return premiumRate;
      }
      return tokenValues[valueKey]?.[tokenType] ?? defaultRate;
    }

    if (!tokenType || !model) {
      return 1;
    }

    valueKey = getValueKey(model, endpoint);
    if (!valueKey) {
      return defaultRate;
    }

    const premiumRate = getPremiumRate(valueKey, tokenType, inputTokenCount);
    if (premiumRate != null) {
      return premiumRate;
    }

    return tokenValues[valueKey]?.[tokenType] ?? defaultRate;
  }

  /**
   * Checks if premium (tiered) cache pricing applies and returns the premium rate.
   */
  function getPremiumCacheRate(
    valueKey: string,
    cacheType: 'write' | 'read',
    inputTokenCount?: number | null,
  ): number | null {
    if (inputTokenCount == null) {
      return null;
    }
    const premiumEntry = premiumCacheTokenValues[valueKey];
    if (!premiumEntry || inputTokenCount <= premiumEntry.threshold) {
      return null;
    }
    return premiumEntry[cacheType] ?? null;
  }

  /**
   * Retrieves the cache multiplier for a given value key and token type.
   * When `inputTokenCount` crosses a model's long-context threshold, the
   * premium cache rate applies instead of the standard one.
   */
  function getCacheMultiplier({
    valueKey,
    cacheType,
    model,
    endpoint,
    endpointTokenConfig,
    inputTokenCount,
  }: {
    valueKey?: string;
    cacheType?: 'write' | 'read';
    model?: string;
    endpoint?: string;
    endpointTokenConfig?: Record<string, Record<string, number>>;
    inputTokenCount?: number | null;
  }): number | null {
    if (endpointTokenConfig && model) {
      const modelConfig = endpointTokenConfig[model];
      /** Models absent from a partial override fall through to standard
       *  cache rates rather than reporting no cache pricing */
      if (modelConfig) {
        return modelConfig[cacheType as string] ?? null;
      }
    }

    if (valueKey && cacheType) {
      return (
        getPremiumCacheRate(valueKey, cacheType, inputTokenCount) ??
        cacheTokenValues[valueKey]?.[cacheType] ??
        null
      );
    }

    if (!cacheType || !model) {
      return null;
    }

    valueKey = getValueKey(model, endpoint);
    if (!valueKey) {
      return null;
    }

    return (
      getPremiumCacheRate(valueKey, cacheType, inputTokenCount) ??
      cacheTokenValues[valueKey]?.[cacheType] ??
      null
    );
  }

  return {
    tokenValues,
    premiumTokenValues,
    getValueKey,
    getMultiplier,
    getPremiumRate,
    getCacheMultiplier,
    defaultRate,
    cacheTokenValues,
  };
}

export type TxMethods = ReturnType<typeof createTxMethods>;
