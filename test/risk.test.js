import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectWindowHours,
  computeConfidence,
  riskLevelFor,
  escapeHtml,
} from '../js/risk.js';

// ==========================================================================
// Fixtures
// ==========================================================================

/** Generate a forecast hourly entry at a specific date/hour. */
function h(dateStr, hour, overrides = {}) {
  const hh = String(hour).padStart(2, '0');
  return {
    time: `${dateStr}T${hh}:00`,
    pop: 0,
    precipitation: 0,
    windSpeed: 0,
    temperature: 25,
    weatherCode: 0,
    models: { pop: [], precipitation: [], temperature: [] },
    ...overrides,
  };
}

/** A minimal daily entry. */
function d(dateStr, overrides = {}) {
  return {
    time: dateStr,
    pop: 10,
    precipSum: 0,
    windMax: 5,
    tempMax: 30,
    tempMin: 20,
    weatherCode: 0,
    models: { pop: [], precipSum: [], tempMax: [] },
    ...overrides,
  };
}

/** A minimal forecast object for selectWindowHours. */
function forecast(hourly) {
  return { hourly, daily: [d(hourly[0]?.time?.slice(0, 10) || '2026-03-15')] };
}

// ==========================================================================
// riskLevelFor — danger tier
// ==========================================================================

describe('riskLevelFor()', () => {
  describe('danger tier', () => {
    it('precipitation total exactly 65 triggers danger', () => {
      const hours = [{ pop: 10, precipitation: 65, windSpeed: 0, temperature: 20 }];
      assert.equal(riskLevelFor(hours).level, 'danger');
    });

    it('precipitation 64.99 does NOT trigger danger from that factor alone', () => {
      const hours = [{ pop: 10, precipitation: 64.99, windSpeed: 0, temperature: 20 }];
      const r = riskLevelFor(hours);
      assert.notEqual(r.level, 'danger');
    });

    it('windSpeed exactly 62 triggers danger', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 62, temperature: 20 }];
      assert.equal(riskLevelFor(hours).level, 'danger');
    });

    it('windSpeed 61.9 does NOT trigger danger from that factor alone', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 61.9, temperature: 20 }];
      const r = riskLevelFor(hours);
      assert.notEqual(r.level, 'danger');
    });

    it('temperature exactly 45 triggers danger', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 0, temperature: 45 }];
      assert.equal(riskLevelFor(hours).level, 'danger');
    });

    it('temperature 44.9 does NOT trigger danger from that factor alone', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 0, temperature: 44.9 }];
      const r = riskLevelFor(hours);
      assert.notEqual(r.level, 'danger');
    });
  });

  // ==========================================================================
  // riskLevelFor — warning tier
  // ==========================================================================

  describe('warning tier', () => {
    it('precipitation total exactly 30 triggers warning', () => {
      const hours = [{ pop: 10, precipitation: 30, windSpeed: 0, temperature: 20 }];
      assert.equal(riskLevelFor(hours).level, 'warning');
    });

    it('precipitation 29.9 does NOT trigger warning from that factor alone', () => {
      const hours = [{ pop: 10, precipitation: 29.9, windSpeed: 0, temperature: 20 }];
      assert.notEqual(riskLevelFor(hours).level, 'warning');
    });

    it('pop exactly 70 triggers warning', () => {
      const hours = [{ pop: 70, precipitation: 0, windSpeed: 0, temperature: 20 }];
      assert.equal(riskLevelFor(hours).level, 'warning');
    });

    it('pop 69.9 does NOT trigger warning from that factor alone', () => {
      const hours = [{ pop: 69.9, precipitation: 0, windSpeed: 0, temperature: 20 }];
      assert.notEqual(riskLevelFor(hours).level, 'warning');
    });

    it('windSpeed exactly 40 triggers warning', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 40, temperature: 20 }];
      assert.equal(riskLevelFor(hours).level, 'warning');
    });

    it('windSpeed 39 does NOT trigger warning from that factor alone', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 39, temperature: 20 }];
      assert.notEqual(riskLevelFor(hours).level, 'warning');
    });

    it('temperature exactly 42 triggers warning', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 0, temperature: 42 }];
      assert.equal(riskLevelFor(hours).level, 'warning');
    });

    it('temperature 41.9 does NOT trigger warning from that factor alone', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 0, temperature: 41.9 }];
      assert.notEqual(riskLevelFor(hours).level, 'warning');
    });
  });

  // ==========================================================================
  // riskLevelFor — success (calm) case
  // ==========================================================================

  describe('success tier (calm)', () => {
    it('returns success for low values across all fields', () => {
      const hours = [{ pop: 20, precipitation: 5, windSpeed: 10, temperature: 25 }];
      const r = riskLevelFor(hours);
      assert.equal(r.level, 'success');
      assert.equal(r.label, 'No elevated risk');
    });
  });

  // ==========================================================================
  // riskLevelFor — empty hours array
  // ==========================================================================

  describe('empty hours array (no data)', () => {
    it('returns success — no data and no risk are indistinguishable', () => {
      // NOTE: This documents current behavior. "No data" looks identical to
      // "no risk." If a distinct 'no-data' level is desired, this test should
      // be updated to reflect that decision.
      const r = riskLevelFor([], [d('2026-03-15')]);
      assert.equal(r.level, 'success');
      assert.equal(r.maxPop, 0);
      assert.equal(r.maxPrecip, 0);
      assert.equal(r.maxWind, 0);
      assert.equal(r.maxTemp, 0);
    });
  });

  // ==========================================================================
  // riskLevelFor — multiple simultaneous triggers
  // ==========================================================================

  describe('multiple simultaneous triggers', () => {
    it('both high wind AND high temp → danger (highest tier wins)', () => {
      const hours = [{ pop: 10, precipitation: 0, windSpeed: 65, temperature: 46 }];
      const r = riskLevelFor(hours);
      assert.equal(r.level, 'danger');
    });

    it('warning-level wind + warning-level precip → warning', () => {
      const hours = [{ pop: 10, precipitation: 35, windSpeed: 42, temperature: 20 }];
      const r = riskLevelFor(hours);
      assert.equal(r.level, 'warning');
    });

    it('returns a properly shaped object', () => {
      const hours = [{ pop: 80, precipitation: 70, windSpeed: 65, temperature: 50 }];
      const r = riskLevelFor(hours);
      assert.ok('level' in r);
      assert.ok('label' in r);
      assert.ok('maxPop' in r);
      assert.ok('maxPrecip' in r);
      assert.ok('maxWind' in r);
      assert.ok('maxTemp' in r);
    });
  });

  // ==========================================================================
  // riskLevelFor — accumulates across multiple hours
  // ==========================================================================

  describe('multi-hour accumulation', () => {
    it('precipitation sums across hours; pop/wind/temp use max', () => {
      const hours = [
        { pop: 30, precipitation: 20, windSpeed: 35, temperature: 30 },
        { pop: 50, precipitation: 15, windSpeed: 40, temperature: 35 },
        { pop: 20, precipitation: 10, windSpeed: 10, temperature: 25 },
      ];
      const r = riskLevelFor(hours);
      assert.equal(r.maxPop, 50);
      assert.equal(r.maxPrecip, 45); // 20 + 15 + 10
      assert.equal(r.maxWind, 40);
      assert.equal(r.maxTemp, 35);
    });
  });
});

// ==========================================================================
// selectWindowHours
// ==========================================================================

describe('selectWindowHours()', () => {
  const BASE = '2026-03-15';

  it('"now" returns exactly one hour (the first matching hour)', () => {
    const fc = forecast([
      h(BASE, 8), h(BASE, 9), h(BASE, 10),
    ]);
    const { hours } = selectWindowHours(fc, 'now');
    assert.equal(hours.length, 1);
    assert.equal(hours[0].time, `${BASE}T08:00`);
  });

  it('"today_evening" filters to 17 <= hour < 21', () => {
    const fc = forecast([
      h(BASE, 15), h(BASE, 16), h(BASE, 17), h(BASE, 18),
      h(BASE, 19), h(BASE, 20), h(BASE, 21), h(BASE, 22),
    ]);
    const { hours } = selectWindowHours(fc, 'today_evening');
    const hourNums = hours.map((x) => Number(x.time.slice(11, 13)));
    assert.deepEqual(hourNums, [17, 18, 19, 20]);
    // 21:00 must be EXCLUDED (half-open interval)
    assert.ok(!hourNums.includes(21), '21:00 should be excluded');
  });

  it('"tomorrow" with dayOffset applies addDaysToDateStr correctly', () => {
    const hourly = [
      h(BASE, 0), h(BASE, 12), // base day
      h('2026-03-16', 0), h('2026-03-16', 12), // tomorrow
      h('2026-03-17', 0), // day after
    ];
    const fc = forecast(hourly);
    const { hours, targetDate } = selectWindowHours(fc, 'tomorrow');
    assert.equal(targetDate, '2026-03-16');
    assert.equal(hours.length, 2); // only 2 fixture entries on the target date
    assert.equal(hours[0].time.slice(0, 10), '2026-03-16');
    assert.equal(hours[1].time.slice(0, 10), '2026-03-16');
  });

  it('zero matching hours returns an empty array (not undefined, not error)', () => {
    // Forecast with only base-day hours, querying tomorrow
    const fc = forecast([h(BASE, 12)]);
    const { hours } = selectWindowHours(fc, 'tomorrow');
    assert.ok(Array.isArray(hours));
    assert.equal(hours.length, 0);
  });

  it('"week" returns hours from the base date (dayOffset=0)', () => {
    // selectWindowHours with 'week' filters to the base date (dayOffset=0, hourStart=0, hourEnd=24).
    // The `span` field is informational — the caller handles multi-day aggregation.
    const hourly = [];
    for (let day = 0; day < 7; day++) {
      const dt = new Date(Date.UTC(2026, 2, 15 + day));
      const ds = dt.toISOString().slice(0, 10);
      hourly.push(h(ds, 12));
    }
    const fc = forecast(hourly);
    const { hours, rule, targetDate } = selectWindowHours(fc, 'week');
    assert.equal(rule.span, 7);
    assert.equal(targetDate, BASE); // dayOffset=0
    // Only the base day's hour matches the filter
    assert.equal(hours.length, 1);
    assert.equal(hours[0].time.slice(0, 10), BASE);
  });
});

// ==========================================================================
// computeConfidence
// ==========================================================================

describe('computeConfidence()', () => {
  describe('pop/precipitation thresholds [15, 35]', () => {
    it('spread <= 15 → high confidence', () => {
      const hours = [
        { models: { pop: [10, 20, 18], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'high');
      assert.equal(r.label, 'High');
    });

    it('spread exactly 15 → high confidence', () => {
      const hours = [
        { models: { pop: [10, 25], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'high');
    });

    it('spread exactly 16 → moderate confidence', () => {
      const hours = [
        { models: { pop: [10, 26], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'moderate');
      assert.equal(r.label, 'Moderate');
    });

    it('spread <= 35 → moderate confidence', () => {
      const hours = [
        { models: { pop: [0, 35], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'moderate');
    });

    it('spread exactly 36 → low confidence', () => {
      const hours = [
        { models: { pop: [0, 36], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'low');
      assert.equal(r.label, 'Low');
    });
  });

  describe('temperature thresholds [1.5, 3.5]', () => {
    it('spread <= 1.5 → high confidence', () => {
      const hours = [
        { models: { temperature: [30, 31], pop: [], precipitation: [] } },
      ];
      const r = computeConfidence(hours, 'temperature');
      assert.equal(r.level, 'high');
    });

    it('spread exactly 1.5 → high confidence', () => {
      const hours = [
        { models: { temperature: [30, 31.5], pop: [], precipitation: [] } },
      ];
      const r = computeConfidence(hours, 'temperature');
      assert.equal(r.level, 'high');
    });

    it('spread exactly 2.0 → moderate confidence', () => {
      const hours = [
        { models: { temperature: [30, 32], pop: [], precipitation: [] } },
      ];
      const r = computeConfidence(hours, 'temperature');
      assert.equal(r.level, 'moderate');
    });

    it('spread <= 3.5 → moderate confidence', () => {
      const hours = [
        { models: { temperature: [28, 31.5], pop: [], precipitation: [] } },
      ];
      const r = computeConfidence(hours, 'temperature');
      assert.equal(r.level, 'moderate');
    });

    it('spread exactly 4.0 → low confidence', () => {
      const hours = [
        { models: { temperature: [28, 32], pop: [], precipitation: [] } },
      ];
      const r = computeConfidence(hours, 'temperature');
      assert.equal(r.level, 'low');
    });
  });

  describe('single-model spread', () => {
    it('single model → spread 0 → high confidence', () => {
      // This is correct given the formula but could be misread as a bug.
      // Writing it explicitly documents the property.
      const hours = [
        { models: { pop: [50], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'high');
      assert.equal(r.avgSpread, 0);
    });
  });

  describe('empty models array', () => {
    it('empty models → spread 0 → high confidence', () => {
      const hours = [
        { models: { pop: [], precipitation: [], temperature: [] } },
      ];
      const r = computeConfidence(hours, 'pop');
      assert.equal(r.level, 'high');
      assert.equal(r.avgSpread, 0);
    });
  });
});

// ==========================================================================
// escapeHtml
// ==========================================================================

describe('escapeHtml()', () => {
  it('escapes ampersand', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes less-than', () => {
    assert.equal(escapeHtml('a < b'), 'a &lt; b');
  });

  it('escapes greater-than', () => {
    assert.equal(escapeHtml('a > b'), 'a &gt; b');
  });

  it('escapes double quote', () => {
    assert.equal(escapeHtml('a "b" c'), 'a &quot;b&quot; c');
  });

  it('escapes single quote', () => {
    assert.equal(escapeHtml("a 'b' c"), 'a &#39;b&#39; c');
  });

  it('escapes all five special characters together', () => {
    const input = `<script>alert("xss" + 'y')</script>`;
    const out = escapeHtml(input);
    assert.ok(!out.includes('<'), 'no raw < remaining');
    assert.ok(!out.includes('>'), 'no raw > remaining');
    assert.equal(out, '&lt;script&gt;alert(&quot;xss&quot; + &#39;y&#39;)&lt;/script&gt;');
  });

  it('returns non-string input as a string', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
    assert.equal(escapeHtml(undefined), 'undefined');
  });

  it('returns empty string for empty input', () => {
    assert.equal(escapeHtml(''), '');
  });
});
