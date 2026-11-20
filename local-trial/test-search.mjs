import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normal,rank,coordinates} from './location-search.mjs';
for(const [q,expected] of [['Berlin','Berlin'],['Mumbai','Mumbai'],['Nairobi','Nairobi'],['Tokyo','Tokyo'],['São Paulo','São Paulo'],['Wellington, New Zealand','Wellington'],['Munich','Munich']]){
 const key=[...normal(q).slice(0,2)].map(c=>c.codePointAt(0).toString(16)).join('-');
 const rows=JSON.parse(await readFile(new URL(`data/search/${key}.json`,import.meta.url)));
 const result=rank(rows,q);assert(result.length,q);assert(result[0][6].includes(normal(expected)),`${q}: ${result[0][0]}`);
}
assert.equal(coordinates('91, 0'),null);assert.equal(coordinates('0, 181'),null);assert.deepEqual(coordinates('-41.1, 174.8').slice(1,3),[-41.1,174.8]);
console.log('Global search, alternative names, country filtering and coordinate validation passed.');
