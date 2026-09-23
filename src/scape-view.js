import * as T from 'three';

export function scapeObject(layout){
 const root=new T.Group();root.name='Scape · inferred flat surfaces';root.userData={kind:layout.kind,assumptions:layout.assumptions,units:layout.units};
 for(const plane of layout.surfaces){
  const part=new T.Group();part.name=`${plane.role} ${plane.id} · ${plane.evidence}`;part.userData={...plane};
  const corners=plane.corners.map(p=>new T.Vector3(...p)),normal=new T.Vector3(...plane.normal);
  // Face inward: cutaway hides exterior walls when inspecting the whole layout.
  if(new T.Vector3().subVectors(corners[1],corners[0]).cross(new T.Vector3().subVectors(corners[2],corners[0])).dot(normal)<0)corners.reverse();
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(corners.flatMap(p=>p.toArray()),3));geometry.setIndex([0,1,2,0,2,3]);geometry.computeVertexNormals();
  const assumed=plane.evidence==='assumed',color=assumed?0x806345:plane.role==='floor'?0x476c68:plane.role==='ceiling'?0x748d9c:plane.role==='surface'?0x657e88:0x7ea697;
  const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color,roughness:1,metalness:0,side:T.FrontSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));part.add(mesh);
  const outlineGeometry=new T.BufferGeometry().setFromPoints([...corners,corners[0]]),edgeColor=assumed?0xf4bc73:0xb5eddb;
  const outline=new T.Line(outlineGeometry,assumed?new T.LineDashedMaterial({color:edgeColor,dashSize:layout.threshold*4,gapSize:layout.threshold*3}):new T.LineBasicMaterial({color:edgeColor}));outline.computeLineDistances();part.add(outline);
  const grid=[];for(let j=1;j<10;j++){const t=j/10;grid.push(corners[0].clone().lerp(corners[1],t),corners[3].clone().lerp(corners[2],t),corners[0].clone().lerp(corners[3],t),corners[1].clone().lerp(corners[2],t));}
  part.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(grid),new T.LineBasicMaterial({color:edgeColor,transparent:true,opacity:.13,depthWrite:false})));
  root.add(part);
 }
 return root;
}

export function scapeVisibility(root,{assumptions=true,ceiling=false,cutaway=true}={}){
 for(const part of root.children){part.visible=(assumptions||part.userData.evidence!=='assumed')&&(ceiling||part.userData.role!=='ceiling');for(const child of part.children)if(child.isMesh){child.material.side=cutaway?T.FrontSide:T.DoubleSide;child.material.needsUpdate=true;}}
}
