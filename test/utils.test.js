import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuery,
  resolveTimeWindow,
  addDaysToDateStr,
  mean,
  spread,
} from '../js/utils.js';

// Small fixture city list (shape matches QUICK_CITIES from app.js)
const CITIES = [
  { name: 'Raipur', admin1: 'Chhattisgarh', country: 'India', latitude: 21.25, longitude: 81.63 },
  { name: 'Mumbai', admin1: 'Maharashtra', country: 'India', latitude: 19.08, longitude: 72.88 },
  { name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.61, longitude: 77.21 },
  { name: 'Pune', admin1: 'Maharashtra', country: 'India', latitude: 18.52, longitude: 73.86 },
];

// ==========================================================================
// parseQuery — time keywords
// ==========================================================================

describe('parseQuery()', () => {
  describe('time keywords', () => {
    it('resolves "tomorrow morning"', () => {
      const r = parseQuery('tomorrow morning in Mumbai', CITIES);
      assert.equal(r.time, 'tomorrow_morning');
    });

    it('resolves "tomorrow evening"', () => {
      const r = parseQuery('tomorrow evening forecast', CITIES);
      assert.equal(r.time, 'tomorrow_evening');
    });

    it('resolves bare "tomorrow"', () => {
      const r = parseQuery('tomorrow rain in Delhi', CITIES);
      assert.equal(r.time, 'tomorrow');
    });

    it('resolves "this evening"', () => {
      const r = parseQuery('this evening in Pune', CITIES);
      assert.equal(r.time, 'today_evening');
    });

    it('resolves "tonight"', () => {
      const r = parseQuery('tonight weather', CITIES);
      assert.equal(r.time, 'today_evening');
    });

    it('resolves "next week"', () => {
      const r = parseQuery('next week rain', CITIES);
      assert.equal(r.time, 'week');
    });

    it('resolves "right now"', () => {
      const r = parseQuery('right now in Mumbai', CITIES);
      assert.equal(r.time, 'now');
    });

    it('resolves "currently"', () => {
      const r = parseQuery('currently in Delhi', CITIES);
      assert.equal(r.time, 'now');
    });

    it('resolves bare "today"', () => {
      const r = parseQuery('today forecast', CITIES);
      assert.equal(r.time, 'today');
    });

    it('resolves Hindi term "kal subah" → tomorrow_morning', () => {
      const r = parseQuery('kal subah barish hogi', CITIES);
      assert.equal(r.time, 'tomorrow_morning');
    });

    it('resolves Hindi term "kal shaam" → tomorrow_evening', () => {
      const r = parseQuery('kal shaam ka mausam', CITIES);
      assert.equal(r.time, 'tomorrow_evening');
    });

    it('resolves Hindi term "kal" → tomorrow', () => {
      const r = parseQuery('kal kaisa hoga', CITIES);
      assert.equal(r.time, 'tomorrow');
    });

    it('resolves Hindi term "shaam" → today_evening', () => {
      const r = parseQuery('shaam ko baarish', CITIES);
      assert.equal(r.time, 'today_evening');
    });

    it('resolves Hindi term "abhi" → now', () => {
      const r = parseQuery('abhi ka mausam', CITIES);
      assert.equal(r.time, 'now');
    });

    it('resolves Hindi term "aaj" → today', () => {
      const r = parseQuery('aaj ka forecast', CITIES);
      assert.equal(r.time, 'today');
    });

    it('"tomorrow evening" resolves to tomorrow_evening, NOT bare tomorrow', () => {
      const r = parseQuery('tomorrow evening will it rain?', CITIES);
      assert.equal(r.time, 'tomorrow_evening');
      // Confirm it does NOT fall through to the 'tomorrow' branch
      assert.notEqual(r.time, 'tomorrow');
    });
  });

  // ==========================================================================
  // parseQuery — variable extraction
  // ==========================================================================

  describe('variable extraction', () => {
    it('rain → rainfall', () => {
      assert.equal(parseQuery('will it rain tomorrow', CITIES).variable, 'rainfall');
    });

    it('baarish → rainfall', () => {
      assert.equal(parseQuery('baarish hogi kal', CITIES).variable, 'rainfall');
    });

    it('precipitation → rainfall', () => {
      assert.equal(parseQuery('precipitation forecast', CITIES).variable, 'rainfall');
    });

    it('showers → rainfall', () => {
      assert.equal(parseQuery('rain showers expected', CITIES).variable, 'rainfall');
    });

    it('wind → wind', () => {
      assert.equal(parseQuery('wind speed today', CITIES).variable, 'wind');
    });

    it('hawa → wind', () => {
      assert.equal(parseQuery('hawa tez hogi', CITIES).variable, 'wind');
    });

    it('warning → warnings', () => {
      assert.equal(parseQuery('any warning for Delhi?', CITIES).variable, 'warnings');
    });

    it('alert → warnings', () => {
      assert.equal(parseQuery('is there an alert in Mumbai?', CITIES).variable, 'warnings');
    });

    it('temperature → temperature', () => {
      assert.equal(parseQuery('temperature in Pune', CITIES).variable, 'temperature');
    });

    it('hot → temperature', () => {
      assert.equal(parseQuery('how hot will it be?', CITIES).variable, 'temperature');
    });

    it('cold → temperature', () => {
      assert.equal(parseQuery('will it be cold tonight?', CITIES).variable, 'temperature');
    });

    it('garmi → temperature', () => {
      assert.equal(parseQuery('garmi kitni hai?', CITIES).variable, 'temperature');
    });

    it('thand → temperature', () => {
      assert.equal(parseQuery('thand badhegi kal?', CITIES).variable, 'temperature');
    });

    it('climate → climate', () => {
      assert.equal(parseQuery('climate trend for Mumbai', CITIES).variable, 'climate');
    });

    it('historical (without conflicting variable keyword) → climate', () => {
      assert.equal(parseQuery('historical data for Mumbai', CITIES).variable, 'climate');
    });

    it('trend (without conflicting variable keyword) → climate', () => {
      assert.equal(parseQuery('climate trend this year', CITIES).variable, 'climate');
    });
  });

  // ==========================================================================
  // parseQuery — location matching
  // ==========================================================================

  describe('location matching', () => {
    it('matches a city by name', () => {
      const r = parseQuery('rain in Mumbai tomorrow', CITIES);
      assert.equal(r.location.name, 'Mumbai');
    });

    it('returns null for an unmatched city', () => {
      const r = parseQuery('rain in Tokyo tomorrow', CITIES);
      assert.equal(r.location, null);
    });

    it('matches case-insensitively', () => {
      const r = parseQuery('DELHI forecast today', CITIES);
      assert.equal(r.location.name, 'Delhi');
    });

    it('matches the first city in list when ambiguous', () => {
      const r = parseQuery('rain in Maharashtra cities', CITIES);
      assert.equal(r.location, null); // "Maharashtra" is not a city name
    });
  });

  // ==========================================================================
  // parseQuery — intent detection
  // ==========================================================================

  describe('intent detection', () => {
    it('"should i" → decision', () => {
      assert.equal(parseQuery('should i carry an umbrella?', CITIES).intent, 'decision');
    });

    it('"can i" → decision', () => {
      assert.equal(parseQuery('can i go for a walk?', CITIES).intent, 'decision');
    });

    it('"is it safe" → decision', () => {
      assert.equal(parseQuery('is it safe to travel tonight?', CITIES).intent, 'decision');
    });

    it('"worth" → decision', () => {
      assert.equal(parseQuery('worth going to the beach?', CITIES).intent, 'decision');
    });

    it('plain question → forecast (default)', () => {
      assert.equal(parseQuery('rain forecast tomorrow', CITIES).intent, 'forecast');
    });
  });

  // ==========================================================================
  // parseQuery — no-match case
  // ==========================================================================

  describe('no-match (nonsense input)', () => {
    it('returns null fields and default intent', () => {
      const r = parseQuery('asdfghjkl', CITIES);
      assert.equal(r.time, null);
      assert.equal(r.variable, null);
      assert.equal(r.location, null);
      assert.equal(r.intent, 'forecast');
    });
  });
});

// ==========================================================================
// addDaysToDateStr
// ==========================================================================

describe('addDaysToDateStr()', () => {
  it('rolls over across a month boundary (Jan 31 + 1)', () => {
    assert.equal(addDaysToDateStr('2026-01-31', 1), '2026-02-01');
  });

  it('rolls over across a year boundary (Dec 31 + 1)', () => {
    assert.equal(addDaysToDateStr('2026-12-31', 1), '2027-01-01');
  });

  it('handles leap-year Feb 28 + 1 in a leap year', () => {
    assert.equal(addDaysToDateStr('2028-02-28', 1), '2028-02-29');
  });

  it('handles negative offset (Feb 1 - 1)', () => {
    assert.equal(addDaysToDateStr('2026-02-01', -1), '2026-01-31');
  });

  it('handles zero offset', () => {
    assert.equal(addDaysToDateStr('2026-03-15', 0), '2026-03-15');
  });
});

// ==========================================================================
// resolveTimeWindow
// ==========================================================================

describe('resolveTimeWindow()', () => {
  it('returns the correct rule for a known key', () => {
    const r = resolveTimeWindow('tomorrow_evening');
    assert.equal(r.dayOffset, 1);
    assert.equal(r.hourStart, 17);
    assert.equal(r.hourEnd, 21);
  });

  it('falls back to "today" for an unknown key', () => {
    const r = resolveTimeWindow('nonexistent_key');
    assert.equal(r.dayOffset, 0);
    assert.equal(r.hourStart, 0);
    assert.equal(r.hourEnd, 24);
    assert.equal(r.whole, true);
  });
});

// ==========================================================================
// mean
// ==========================================================================

describe('mean()', () => {
  it('returns null for an empty array', () => {
    assert.equal(mean([]), null);
  });

  it('returns null for an array of all null/undefined/NaN', () => {
    assert.equal(mean([null, undefined, NaN]), null);
  });

  it('returns the value for a single-element array', () => {
    assert.equal(mean([42]), 42);
  });

  it('filters out nulls and computes correctly', () => {
    // [10, null, 20, undefined, 30] → mean of [10, 20, 30] = 20
    assert.equal(mean([10, null, 20, undefined, 30]), 20);
  });

  it('computes a normal case with mixed values', () => {
    assert.equal(mean([1, 2, 3, 4, 5]), 3);
  });
});

// ==========================================================================
// spread
// ==========================================================================

describe('spread()', () => {
  it('returns 0 for an empty array', () => {
    assert.equal(spread([]), 0);
  });

  it('returns 0 for a single-element array', () => {
    assert.equal(spread([5]), 0);
  });

  it('returns 0 for an array of all null/undefined', () => {
    assert.equal(spread([null, undefined]), 0);
  });

  it('computes max - min, filtering nulls', () => {
    // [10, null, 30, undefined, 20] → 30 - 10 = 20
    assert.equal(spread([10, null, 30, undefined, 20]), 20);
  });

  it('returns 0 when all values are the same', () => {
    assert.equal(spread([7, 7, 7]), 0);
  });
});
