import { describe, expect, it } from 'vitest';
import { calculateStats, describePart, parseQuantity, type VehicleIndexes } from '../../src/domain/vehicle';

describe('source-backed legacy power units', () => {
  it('uses integer kW for bare assign-backed power, and accepts only game power unit strings', () => {
    // assign.cpp:371–386; units.h:1124–1128, not an assumed SI numeric watt default.
    expect(parseQuantity(-1, 'W')).toBe(-1000);
    expect(parseQuantity(2, 'W')).toBe(2000);
    expect(parseQuantity(0.5, 'W')).toBeUndefined();
    expect(parseQuantity(Number.MAX_SAFE_INTEGER, 'W')).toBeUndefined();
    expect(parseQuantity('750 mW', 'W')).toBe(.75);
    expect(parseQuantity('1 kW 250 W', 'W')).toBe(1250);
    expect(parseQuantity('1 MW', 'W')).toBeUndefined();
    expect(parseQuantity('1 hp', 'W')).toBeUndefined();
    expect(parseQuantity(4, 'ml')).toBe(1000);
    expect(parseQuantity(.5, 'ml')).toBeUndefined();
    expect(parseQuantity(.5, 'g')).toBeUndefined();
    expect(parseQuantity('0.5 g', 'g')).toBe(.5);
  });
  it('keeps aggregate ratings consistent with per-part details for legacy/mod numeric power', () => {
    const indexes: VehicleIndexes = { parts: new Map([['legacy', { id: 'legacy', type: 'vehicle_part', flags: ['ENGINE'], power: 2, epower: -1 }]]), items: new Map() };
    const stats = calculateStats({ name: 'legacy', parts: [{ id: 'legacy', mount_dx: 0, mount_dy: 0 }] }, indexes);
    const fields = describePart('legacy', indexes).sections.flatMap(section => section.fields);
    expect(stats.ratedPower.known).toBe(2000);
    expect(fields.find(field => field.id === 'mechanical_output')?.value).toBe(stats.ratedPower.known);
    expect(fields.find(field => field.id === 'fixed_consumption')?.value).toBe(1000);
  });
});
