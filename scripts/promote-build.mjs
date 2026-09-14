import {existsSync,lstatSync,readdirSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

export function promoteBuild(source,destination,{workspaceRoot=process.cwd()}={}) {
 const root=resolve(workspaceRoot),stage=resolve(source),live=resolve(destination);
 const inside=path=>path.startsWith(root+sep);
 if(!inside(stage)||!inside(live)||stage===live||stage.startsWith(live+sep)||live.startsWith(stage+sep))throw Error('Build paths must be separate directories inside the workspace');
 function rejectLinks(path) {
  let current=root;
  for(const part of relative(root,path).split(sep)){current=resolve(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('Build paths cannot contain symbolic links');}
 }
 rejectLinks(stage);rejectLinks(live);
 const files=[];
 function walk(path) {
  for(const entry of readdirSync(path,{withFileTypes:true})) {
   if(entry.isSymbolicLink())throw Error('Build output cannot contain symbolic links');
   const full=resolve(path,entry.name);
   if(entry.isDirectory())walk(full);else if(entry.isFile())files.push(relative(stage,full));
  }
 }
 walk(stage);
 for(const entry of ['index.html','sw.js'])if(!files.includes(entry))throw Error('Incomplete build: '+entry+' is missing');
 const html=readFileSync(resolve(stage,'index.html'),'utf8');
 for(const [,url] of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g))if(!files.includes(url.slice(1).split('/').join(sep)))throw Error('Incomplete build: referenced entry asset is missing');
 // Finish validating before touching live files. Old hashed chunks remain available
 // to tabs that loaded an earlier index and have not requested their lazy pages yet.
 for(const file of files)rejectLinks(resolve(live,file));
 const order=[...files.filter(f=>!['index.html','sw.js'].includes(f)),'index.html','sw.js'];
 for(const file of order) {
  const target=resolve(live,file),bytes=readFileSync(resolve(stage,file));
  if(existsSync(target)&&readFileSync(target).equals(bytes))continue;
  mkdirSync(dirname(target),{recursive:true});
  const temporary=target+'.tmp-'+randomUUID();
  try {writeFileSync(temporary,bytes);renameSync(temporary,target);}
  finally {if(existsSync(temporary))unlinkSync(temporary);}
 }
 return {published:files.length,retainsPreviousAssets:true};
}
