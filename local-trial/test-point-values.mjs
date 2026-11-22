import assert from 'node:assert/strict';
import {displayPoint,snapForecast} from './point-values.mjs';
const raw={u:3,v:4,gust:2,temperature:4,dewpoint:6};
const point=displayPoint(raw);
assert.equal(point.gust,5);assert.equal(point.dewpoint,4);assert.equal(raw.gust,2);assert.equal(raw.dewpoint,6);
assert.equal(displayPoint({...raw,gust:10,dewpoint:-1}).gust,10);
assert.equal(displayPoint({...raw,gust:undefined}).gust,undefined);
assert.equal(snapForecast(.6,5),2);assert.equal(snapForecast(2,28),27);
console.log('Point display bounds preserve source data; chart clicks snap to forecast times.');
