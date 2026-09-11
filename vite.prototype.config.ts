import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],publicDir:false,build:{outDir:'artifacts/wayline-prototype',emptyOutDir:true,rollupOptions:{input:'prototype.html'}}});
