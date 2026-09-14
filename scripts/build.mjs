import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {promoteBuild} from './promote-build.mjs';
const root=process.cwd(),stagingRoot=resolve(root,'tmp');
mkdirSync(stagingRoot,{recursive:true});
const stage=mkdtempSync(join(stagingRoot,'wayline-build-'));
const cleanupTarget=resolve(stage);
if(!cleanupTarget.startsWith(stagingRoot+sep+'wayline-build-'))throw Error('Unsafe build cleanup path');
const env={...process.env,NODE_ENV:'production',WAYLINE_BUILD_OUT_DIR:stage};
try {
 for(const args of [
  ['node_modules/typescript/bin/tsc','-b'],
  ['node_modules/vite/bin/vite.js','build','--outDir',stage],
  ['scripts/build-sw.mjs']
 ])execFileSync(process.execPath,args,{stdio:'inherit',env,windowsHide:true});
 console.log('Published staged build:',promoteBuild(stage,resolve(root,'standalone'),{workspaceRoot:root}));
}finally {
 rmSync(cleanupTarget,{recursive:true,force:true});
}
