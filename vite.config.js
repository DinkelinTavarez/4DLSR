import { defineConfig } from 'vite';
export default defineConfig(({mode})=>({
  publicDir:mode==='hosted'?false:'public',
  define:{'import.meta.env.VITE_HOSTED_PREVIEW':JSON.stringify(mode==='hosted')},
  worker:{format:'es'},
  build:{outDir:mode==='hosted'?'dist-hosted':'dist',target:'es2022',chunkSizeWarningLimit:2000,rollupOptions:{input:mode==='hosted'?{rig:'rig.html'}:{app:'index.html',quality:'quality.html',rig:'rig.html'}}}
}));
