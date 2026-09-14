import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {promoteBuild} from '../scripts/promote-build.mjs';
function fixture(t) {
 const parent=resolve('tmp');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'build-publish-test-')),stage=join(root,'stage'),live=join(root,'live');
 for(const dir of [stage,live])mkdirSync(join(dir,'assets'),{recursive:true});
 writeFileSync(join(live,'index.html'),'<script src="/assets/old.js"></script>');
 writeFileSync(join(live,'assets','old.js'),'old lazy chunk');
 writeFileSync(join(live,'sw.js'),'old worker');
 writeFileSync(join(stage,'index.html'),'<script src="/assets/new.js"></script>');
 writeFileSync(join(stage,'assets','new.js'),'new entry');
 writeFileSync(join(stage,'sw.js'),'new worker');
 t.after(()=>{assert.ok(resolve(root).startsWith(parent+sep));rmSync(root,{recursive:true,force:true});});
 return {root,stage,live,options:{workspaceRoot:root}};
}
test('publishing a new build keeps lazy chunks referenced by already-open tabs',t=>{
 const f=fixture(t),oldIndex=readFileSync(join(f.live,'index.html'),'utf8');
 const result=promoteBuild(f.stage,f.live,f.options);
 assert.equal(result.retainsPreviousAssets,true);
 assert.equal(readFileSync(join(f.live,oldIndex.match(/src="([^"]+)/)[1].slice(1)),'utf8'),'old lazy chunk');
 assert.equal(readFileSync(join(f.live,'assets','new.js'),'utf8'),'new entry');
 assert.equal(readFileSync(join(f.live,'index.html'),'utf8'),readFileSync(join(f.stage,'index.html'),'utf8'));
 assert.equal(readFileSync(join(f.live,'sw.js'),'utf8'),'new worker');
});
test('incomplete build cannot replace the current index or worker',t=>{
 const f=fixture(t);rmSync(join(f.stage,'sw.js'));
 assert.throws(()=>promoteBuild(f.stage,f.live,f.options),/Incomplete build/);
 assert.equal(readFileSync(join(f.live,'sw.js'),'utf8'),'old worker');
 assert.match(readFileSync(join(f.live,'index.html'),'utf8'),/old.js/);
 assert.equal(existsSync(join(f.live,'assets','new.js')),false);
});
test('missing referenced assets reject publication before any live writes',t=>{
 const f=fixture(t);writeFileSync(join(f.stage,'index.html'),'<script src="/assets/missing.js"></script>');
 assert.throws(()=>promoteBuild(f.stage,f.live,f.options),/referenced entry asset/);
 assert.equal(existsSync(join(f.live,'assets','new.js')),false);
 assert.match(readFileSync(join(f.live,'index.html'),'utf8'),/old.js/);
});
test('build publication rejects escaping, overlapping, and identical paths',t=>{
 const f=fixture(t);
 for(const [stage,live] of [[f.stage,f.stage],[f.stage,join(f.stage,'nested')],[f.stage,resolve(f.root,'..','outside')]])assert.throws(()=>promoteBuild(stage,live,f.options),/separate directories inside/);
});
