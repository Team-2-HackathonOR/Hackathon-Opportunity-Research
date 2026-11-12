// Shared parsing helpers keep query strings, env values, and AI payloads consistent across domains.
export const parsePositiveInteger = (value: unknown): number | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parsePositiveInteger(item);

      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const parseNonNegativeInteger = (value: unknown): number | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseNonNegativeInteger(item);

      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);

    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
};

export const toNullableBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }

  return null;
};

export const getPrimitiveValue = (
  value: unknown,
): string | number | boolean | null | undefined => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return undefined;
};
