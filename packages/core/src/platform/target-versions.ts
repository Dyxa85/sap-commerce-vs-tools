/**
 * SAP Commerce releases this tool is developed and tested against.
 * Newest first. Update the matrix in docs/compatibility.md together with this list.
 */
export const SUPPORTED_COMMERCE_VERSIONS = ['2211-jdk21'] as const;

export type SupportedCommerceVersion = (typeof SUPPORTED_COMMERCE_VERSIONS)[number];

export function isSupportedCommerceVersion(value: string): value is SupportedCommerceVersion {
  return (SUPPORTED_COMMERCE_VERSIONS as readonly string[]).includes(value);
}
