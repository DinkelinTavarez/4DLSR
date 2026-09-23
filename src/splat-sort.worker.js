import {sortSplats} from './splat-sort.js';
let records,generation;
self.onmessage=({data})=>{
 if(data.type==='load'){records=data.records;generation=data.generation;return;}
 if(!records||generation!==data.generation)return;
 const sorted=sortSplats(records,data.direction);self.postMessage({generation,sorted},[sorted.buffer]);
};
