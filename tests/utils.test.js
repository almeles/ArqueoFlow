'use strict';

const {
  DENOMINATIONS,
  formatCurrency,
  formatDenomination,
  calcMontoEsperado,
  calcTotalEfectivo,
  buildReconciliationMessage,
} = require('../src/utils');

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe('formatCurrency', () => {
  test('formats whole amounts', () => {
    expect(formatCurrency(10000)).toBe('C$ 10,000');
    expect(formatCurrency(500)).toBe('C$ 500');
    expect(formatCurrency(0)).toBe('C$ 0');
  });

  test('formats decimal amounts', () => {
    expect(formatCurrency(9450.5)).toBe('C$ 9,450.5');
    expect(formatCurrency(100.25)).toBe('C$ 100.25');
  });
});

// ---------------------------------------------------------------------------
// formatDenomination
// ---------------------------------------------------------------------------
describe('formatDenomination', () => {
  test('formats whole denominations', () => {
    expect(formatDenomination(1000)).toBe('C$ 1000');
    expect(formatDenomination(500)).toBe('C$ 500');
    expect(formatDenomination(1)).toBe('C$ 1');
  });

  test('formats fractional denominations', () => {
    expect(formatDenomination(0.5)).toBe('C$ 0.50');
    expect(formatDenomination(0.25)).toBe('C$ 0.25');
    expect(formatDenomination(0.1)).toBe('C$ 0.10');
  });
});

// ---------------------------------------------------------------------------
// calcMontoEsperado — devoluciones is now number[] (array of amounts)
// ---------------------------------------------------------------------------
describe('calcMontoEsperado', () => {
  test('returns full planilla amount when no devoluciones', () => {
    expect(calcMontoEsperado(10000, [])).toBe(10000);
  });

  test('subtracts single devolucion amount', () => {
    expect(calcMontoEsperado(10000, [500])).toBe(9500);
  });

  test('subtracts multiple devolucion amounts', () => {
    expect(calcMontoEsperado(10000, [300, 200])).toBe(9500);
  });

  test('subtracts three devolucion amounts', () => {
    expect(calcMontoEsperado(10000, [500, 200, 100])).toBe(9200);
  });

  test('matches problem statement example: 10000 - 500 = 9500', () => {
    expect(calcMontoEsperado(10000, [500])).toBe(9500);
  });
});

// ---------------------------------------------------------------------------
// calcTotalEfectivo
// ---------------------------------------------------------------------------
describe('calcTotalEfectivo', () => {
  test('returns 0 for empty denomination map', () => {
    expect(calcTotalEfectivo({})).toBe(0);
  });

  test('calculates total for a single denomination', () => {
    expect(calcTotalEfectivo({ '500': 2 })).toBe(1000);
    expect(calcTotalEfectivo({ '100': 5 })).toBe(500);
  });

  test('calculates total for multiple denominations', () => {
    const denominaciones = { '500': 10, '100': 5, '50': 2 };
    // 500*10 + 100*5 + 50*2 = 5000 + 500 + 100 = 5600
    expect(calcTotalEfectivo(denominaciones)).toBe(5600);
  });

  test('ignores unknown denominations not in DENOMINATIONS list', () => {
    const denominaciones = { '500': 1, '999': 10 };
    expect(calcTotalEfectivo(denominaciones)).toBe(500);
  });

  test('handles fractional denominations', () => {
    const denominaciones = { '0.5': 4, '1': 2 };
    expect(calcTotalEfectivo(denominaciones)).toBeCloseTo(4);
  });

  test('covers problem statement example: 9450 efectivo', () => {
    // Build 9450 from denominations
    const denominaciones = { '1000': 9, '500': 0, '200': 0, '100': 4, '50': 1 };
    // 9000 + 400 + 50 = 9450
    expect(calcTotalEfectivo(denominaciones)).toBe(9450);
  });
});

// ---------------------------------------------------------------------------
// buildReconciliationMessage — devoluciones is now number[]
// ---------------------------------------------------------------------------
describe('buildReconciliationMessage', () => {
  const baseSession = {
    planillaId: '105020',
    ruta: 'Ruta 1',
    montoPlanilla: 10000,
    devoluciones: [],
    montoEsperado: 10000,
    totalEfectivo: 10000,
  };

  test('shows CUADRADO when efectivo equals monto esperado', () => {
    const msg = buildReconciliationMessage(baseSession);
    expect(msg).toContain('✅ CUADRADO');
  });

  test('shows SOBRANTE when efectivo is greater', () => {
    const session = { ...baseSession, totalEfectivo: 10050, montoEsperado: 10000 };
    const msg = buildReconciliationMessage(session);
    expect(msg).toContain('✅ SOBRANTE');
    expect(msg).toContain('C$ 50');
  });

  test('shows FALTANTE when efectivo is less — problem statement example', () => {
    // Planilla 10000, devolucion 500 → A Entregar 9500, Efectivo 9450 → Faltante -50
    const session = {
      planillaId: '105020',
      ruta: 'Ruta 1',
      montoPlanilla: 10000,
      devoluciones: [500],
      montoEsperado: 9500,
      totalEfectivo: 9450,
    };
    const msg = buildReconciliationMessage(session);
    expect(msg).toContain('❌ FALTANTE');
    expect(msg).toContain('-50');
  });

  test('includes planilla ID and route in message', () => {
    const msg = buildReconciliationMessage(baseSession);
    expect(msg).toContain('#105020');
    expect(msg).toContain('Ruta 1');
  });

  test('shows devoluciones count and total when present', () => {
    const session = {
      ...baseSession,
      devoluciones: [200],
      montoEsperado: 9800,
      totalEfectivo: 9800,
    };
    const msg = buildReconciliationMessage(session);
    expect(msg).toContain('Devoluciones');
    expect(msg).toContain('(1)');
    expect(msg).toContain('C$ 200');
  });

  test('shows correct count for multiple devoluciones', () => {
    const session = {
      ...baseSession,
      devoluciones: [300, 200],
      montoEsperado: 9500,
      totalEfectivo: 9500,
    };
    const msg = buildReconciliationMessage(session);
    expect(msg).toContain('(2)');
    expect(msg).toContain('C$ 500');
  });

  test('does NOT show invoice IDs in devoluciones line', () => {
    const session = {
      ...baseSession,
      devoluciones: [500, 200, 100],
      montoEsperado: 9200,
      totalEfectivo: 9200,
    };
    const msg = buildReconciliationMessage(session);
    expect(msg).not.toContain('Facturas:');
    expect(msg).not.toContain('facturaId');
  });

  test('does not include devoluciones line when list is empty', () => {
    const msg = buildReconciliationMessage(baseSession);
    expect(msg).not.toContain('Devoluciones');
    expect(msg).not.toContain('Facturas:');
  });

  test('includes Monto Planilla label', () => {
    const msg = buildReconciliationMessage(baseSession);
    expect(msg).toContain('Monto Planilla');
    expect(msg).toContain('C$ 10,000');
  });

  test('includes A Entregar (Neto) amount', () => {
    const session = {
      ...baseSession,
      devoluciones: [500],
      montoEsperado: 9500,
      totalEfectivo: 9450,
    };
    const msg = buildReconciliationMessage(session);
    expect(msg).toContain('A Entregar (Neto)');
    expect(msg).toContain('C$ 9,500');
  });
});

// ---------------------------------------------------------------------------
// DENOMINATIONS array
// ---------------------------------------------------------------------------
describe('DENOMINATIONS', () => {
  test('is sorted in descending order', () => {
    for (let i = 0; i < DENOMINATIONS.length - 1; i++) {
      expect(DENOMINATIONS[i]).toBeGreaterThan(DENOMINATIONS[i + 1]);
    }
  });

  test('includes standard NIO denominations', () => {
    expect(DENOMINATIONS).toContain(1000);
    expect(DENOMINATIONS).toContain(500);
    expect(DENOMINATIONS).toContain(100);
    expect(DENOMINATIONS).toContain(50);
    expect(DENOMINATIONS).toContain(1);
  });
});
