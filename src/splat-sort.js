// Linear-time back-to-front ordering. Translation adds one constant to depth,
// so only camera orientation changes require another sort.
export function sortSplats(records,direction,bins=65536){
 const n=records.length/14,depths=new Float32Array(n),bucket=new Uint16Array(n),heads=new Uint32Array(bins),out=new Float32Array(records.length);
 let low=Infinity,high=-Infinity;
 for(let i=0;i<n;i++){const p=i*14,d=direction[0]*records[p]+direction[1]*records[p+1]+direction[2]*records[p+2];depths[i]=d;low=Math.min(low,d);high=Math.max(high,d);}
 const scale=(bins-1)/Math.max(high-low,1e-8);
 for(let i=0;i<n;i++){const b=Math.max(0,Math.min(bins-1,Math.floor((depths[i]-low)*scale)));bucket[i]=b;heads[b]++;}
 let offset=0;for(let b=0;b<bins;b++){const count=heads[b];heads[b]=offset;offset+=count;}
 for(let i=0;i<n;i++){const p=i*14,dest=heads[bucket[i]]++*14;for(let j=0;j<14;j++)out[dest+j]=records[p+j];}
 return out;
}
