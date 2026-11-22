import assert from 'node:assert/strict';
import {forecastOrder} from './forecast-order.mjs';
assert.deepEqual(forecastOrder(3,8),[3,2,4,5,6,7,0,1]);
assert.deepEqual(forecastOrder(0,3),[0,1,2]);
assert.deepEqual(forecastOrder(2,3),[2,1,0]);
assert.deepEqual(forecastOrder(0,1),[0]);
console.log('Current, previous, future and earlier-backfill priorities passed.');
