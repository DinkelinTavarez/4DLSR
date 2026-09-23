import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {fitScape} from './scape-layout.js';
self.onmessage=({data})=>{
 try{const geometry=new PLYLoader().parse(data),layout=fitScape(geometry.getAttribute('position').array);geometry.dispose();self.postMessage({layout});}
 catch(error){self.postMessage({error:error.message});}
};
