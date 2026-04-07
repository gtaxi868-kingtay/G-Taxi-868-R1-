/**
 * Format a cent amount as TTD currency string.
 * Example: formatTTD(4500) => "TTD $45.00"
 */
export function formatTTD(cents: number): string {
  const dollars = cents / 100;
  return `TTD $${dollars.toFixed(2)}`;
}

/**
 * Format a dollar amount as TTD currency string.
 * Example: formatTTDDollars(45.0) => "TTD $45.00"
 */
export function formatTTDDollars(dollars: number): string {
  return `TTD $${dollars.toFixed(2)}`;
}
