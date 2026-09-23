// Deterministic, bounded plane fitting for an inspectable *assumed* layout.
// Input uses the same Y-up, relative coordinates as the saved pre-training PLY.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const quantile=(a,q)=>a[Math.min(a.length-1,Math.floor((a.length-1)*q))];
function range(points,axis){const values=points.map(p=>dot(p,axis)).sort((a,b)=>a-b);return [quantile(values,.015),quantile(values,.985)];}

function leastSquares(points,initial){
 const center=mul(points.reduce(add,[0,0,0]),1/points.length),matrix=Array.from({length:3},()=>[0,0,0]),vectors=[[1,0,0],[0,1,0],[0,0,1]];
 for(const p of points){const d=sub(p,center);for(let i=0;i<3;i++)for(let j=0;j<3;j++)matrix[i][j]+=d[i]*d[j];}
 // Jacobi eigensolver; the smallest covariance eigenvector is the plane normal.
 for(let iteration=0;iteration<20;iteration++){
  let p=0,q=1;for(const [i,j]of [[0,2],[1,2]])if(Math.abs(matrix[i][j])>Math.abs(matrix[p][q])){p=i;q=j;}
  if(Math.abs(matrix[p][q])<1e-12)break;
  const angle=.5*Math.atan2(2*matrix[p][q],matrix[q][q]-matrix[p][p]),c=Math.cos(angle),s=Math.sin(angle),a=matrix[p][p],b=matrix[q][q],v=matrix[p][q];
  matrix[p][p]=c*c*a-2*s*c*v+s*s*b;matrix[q][q]=s*s*a+2*s*c*v+c*c*b;matrix[p][q]=matrix[q][p]=0;
  for(let i=0;i<3;i++){
   if(i!==p&&i!==q){const x=matrix[i][p],y=matrix[i][q];matrix[i][p]=matrix[p][i]=c*x-s*y;matrix[i][q]=matrix[q][i]=s*x+c*y;}
   const x=vectors[i][p],y=vectors[i][q];vectors[i][p]=c*x-s*y;vectors[i][q]=s*x+c*y;
  }
 }
 let k=0;for(let i=1;i<3;i++)if(matrix[i][i]<matrix[k][k])k=i;
 let normal=unit(vectors.map(row=>row[k]));if(dot(normal,initial)<0)normal=mul(normal,-1);
 return {normal,center,offset:dot(normal,center)};
}

function patch(plane,up,scale){
 const {normal,points,center}=plane;
 let u=unit(cross(normal,Math.abs(dot(normal,up))>.85?[1,0,0]:up));
 if(Math.hypot(...u)<.5)u=unit(cross(normal,[0,0,1]));
 const v=unit(cross(normal,u)),[u0,u1]=range(points,u),[v0,v1]=range(points,v);
 if(Math.min(u1-u0,v1-v0)<scale*.065)return null;
 const cells=new Set();for(const p of points){const x=Math.floor(6*(dot(p,u)-u0)/(u1-u0)),y=Math.floor(6*(dot(p,v)-v0)/(v1-v0));if(x>=0&&x<6&&y>=0&&y<6)cells.add(x+6*y);}
 if(cells.size<12)return null;
 const origin=mul(normal,plane.offset),corners=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([a,b])=>add(origin,add(mul(u,a),mul(v,b))));
 return {normal,center,corners,area:(u1-u0)*(v1-v0),support:points.length,rms:plane.rms,coverage:cells.size/36,evidence:'fitted',extent:'rectangle inferred from point bounds'};
}

export function fitScape(positions){
 let seed=9231;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 // Reservoir sampling caps work and avoids correlation with file/grid ordering.
 const points=[];let valid=0;
 for(let i=0;i+2<positions.length;i+=3){const p=[positions[i],positions[i+1],positions[i+2]];if(!p.every(Number.isFinite))continue;valid++;if(points.length<7000)points.push(p);else{const j=Math.floor(random()*valid);if(j<7000)points[j]=p;}}
 if(points.length<80)throw new Error('Scape needs at least 80 valid geometry points.');
 const axes=[[1,0,0],[0,1,0],[0,0,1]],bounds=axes.map(axis=>range(points,axis)),scale=Math.hypot(...bounds.map(([a,b])=>b-a));
 if(!Number.isFinite(scale)||scale<1e-7)throw new Error('Scape cannot fit a layout to degenerate geometry.');
 const threshold=scale*.005,minimum=Math.max(90,Math.floor(points.length*.035)),planes=[];let remaining=points;
 for(let k=0;k<10&&remaining.length>=minimum;k++){
  let best=[],normal;
  for(let trial=0;trial<260;trial++){
   const a=remaining[Math.floor(random()*remaining.length)],b=remaining[Math.floor(random()*remaining.length)],c=remaining[Math.floor(random()*remaining.length)];
   const n=cross(sub(b,a),sub(c,a));if(Math.hypot(...n)<scale*scale*.001)continue;
   const direction=unit(n),d=dot(direction,a),members=[];
   for(const p of remaining)if(Math.abs(dot(direction,p)-d)<threshold)members.push(p);
   if(members.length>best.length){best=members;normal=direction;}
  }
  if(best.length<minimum)break;
  const fitted=leastSquares(best,normal);best=remaining.filter(p=>Math.abs(dot(fitted.normal,p)-fitted.offset)<threshold);
  if(best.length<minimum)break;
  fitted.points=best;fitted.rms=Math.sqrt(best.reduce((s,p)=>s+(dot(fitted.normal,p)-fitted.offset)**2,0)/best.length);
  const candidate=patch(fitted,[0,1,0],scale);
  if(candidate)planes.push(candidate);
  const members=new Set(best);remaining=remaining.filter(p=>!members.has(p));
 }
 // Gravity is not measured: near-horizontal structure refines a camera-upright assumption.
 const horizontal=planes.filter(p=>Math.abs(p.normal[1])>.866).sort((a,b)=>b.area-a.area);
 const up=horizontal.length?mul(horizontal[0].normal,Math.sign(horizontal[0].normal[1])):[0,1,0];
 const vertical=planes.filter(p=>Math.abs(dot(p.normal,up))<.25).sort((a,b)=>b.area-a.area);
 let right=vertical.length?unit(sub(vertical[0].normal,mul(up,dot(vertical[0].normal,up)))):unit(sub([1,0,0],mul(up,up[0])));
 if(dot(right,[1,0,0])<0)right=mul(right,-1);
 const back=unit(cross(right,up)),basis=[right,up,back],limits=basis.map(axis=>range(points,axis));
 const height=limits[1][1]-limits[1][0],used=new Set(),surfaces=[];
 const toWorld=p=>p.reduce((sum,v,i)=>add(sum,mul(basis[i],v)),[0,0,0]);
 const center=toWorld(limits.map(([a,b])=>(a+b)/2));
 // A rectangular room is a completion hypothesis, not a recovered topology.
 if(limits.every(([a,b])=>b-a>scale*.025))for(let axis=0;axis<3;axis++)for(let side=0;side<2;side++){
  const coordinate=limits[axis][side],tangent=[0,1,2].filter(i=>i!==axis),normal=mul(basis[axis],side?-1:1);
  const faceCenter=limits.map(([a,b])=>(a+b)/2);faceCenter[axis]=coordinate;
  const corners=[[0,0],[1,0],[1,1],[0,1]].map(pair=>{const p=faceCenter.slice();for(let j=0;j<2;j++)p[tangent[j]]=limits[tangent[j]][pair[j]];return toWorld(p);});
  const faceArea=tangent.reduce((a,i)=>a*(limits[i][1]-limits[i][0]),1);
  const matches=planes.map((plane,index)=>({plane,index,distance:Math.abs(dot(plane.center,basis[axis])-coordinate)})).filter(({plane,index,distance})=>!used.has(index)&&Math.abs(dot(plane.normal,normal))>.96&&distance<scale*.055&&plane.area>faceArea*.12).sort((a,b)=>a.distance-b.distance);
  const match=matches[0],role=axis===1?(side?'ceiling':'floor'):'wall';
  if(match){
   used.add(match.index);const p=match.plane,n=dot(p.normal,normal)<0?mul(p.normal,-1):p.normal,d=dot(n,p.center);
   surfaces.push({...p,normal:n,corners:corners.map(c=>sub(c,mul(n,dot(n,c)-d))),role,extent:'assumed extension to room bounds'});
  }else surfaces.push({normal,corners,center:toWorld(faceCenter),role,evidence:'assumed',support:0,rms:null,coverage:0,extent:'unobserved boundary at trimmed point bounds'});
 }
 for(let i=0;i<planes.length;i++)if(!used.has(i)){
  const p=planes[i],level=dot(p.center,up),horizontal=Math.abs(dot(p.normal,up))>.85;
  const role=horizontal?(level<limits[1][0]+height*.18?'floor':level>limits[1][1]-height*.18?'ceiling':'surface'):Math.abs(dot(p.normal,up))<.3?'wall':'surface';
  surfaces.push({...p,role,normal:dot(p.normal,sub(center,p.center))<0?mul(p.normal,-1):p.normal});
 }
 if(!surfaces.length)throw new Error('No stable planes or room bounds could be fitted to this geometry.');
 return {version:1,kind:'inferred-static-scape',source:'pre-training seed points',units:'relative camera baseline; not meters',assumptions:['Camera approximately upright; no measured gravity.','One rectangular room; plane extents and hidden boundaries are assumed.','Reference frame only; furniture and people are not semantically identified.'],sourcePoints:valid,sampledPoints:points.length,threshold,basis,bounds:limits,center,surfaces:surfaces.map((s,i)=>({...s,id:i+1}))};
}
