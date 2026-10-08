import { describe, expect, it } from 'vitest';
import { isSupportedCommerceVersion, PRODUCT_NAME } from '../src/index.js';

describe('core', () => {
  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('SAP Commerce VS-Tools');
  });

  it('recognises the supported SAP Commerce version', () => {
    expect(isSupportedCommerceVersion('2211-jdk21')).toBe(true);
    expect(isSupportedCommerceVersion('1905')).toBe(false);
  });
});
