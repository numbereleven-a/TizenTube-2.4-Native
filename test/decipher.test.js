'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('Malformed stream parameters return an error without starting a worker',()=>{
    const c=vm.createContext({Worker:function(){assert.fail('unexpected worker');}});
    vm.runInContext(fs.readFileSync('app/decipher.js','utf8'),c);
    let error;c.StreamDecipher.fix([{url:'https://example.test/v?n=%ZZ'}],'source','player',e=>error=e);assert.ok(error);
});
test('Decipher deduplicates challenges, updates URLs and reuses the matching player',()=>{
    let worker,constructs=0;
    const c=vm.createContext({setTimeout,clearTimeout,Worker:function(){constructs++;worker=this;this.postMessage=m=>{this.request=m;};this.terminate=()=>{};}});
    vm.runInContext(fs.readFileSync('app/decipher.js','utf8'),c);
    const formats=[{url:'https://media.example.test/v?x=1&n=one%2Btwo&range=0-9'},{url:'https://media.example.test/a?n=one%2Btwo'},{url:'https://media.example.test/plain?x=1'}];
    let completed=false;
    c.StreamDecipher.fix(formats,'synthetic source','player-a',(error,result)=>{assert.equal(error,null);assert.equal(result,formats);completed=true;});
    assert.equal(worker.request.player,'synthetic source');assert.deepEqual(Array.from(worker.request.challenges),['one+two']);
    worker.onmessage({data:{id:worker.request.id+1,ok:true,values:['stale']}});assert.equal(completed,false);
    worker.onmessage({data:{id:worker.request.id,ok:true,values:['fixed/value']}});
    assert.equal(completed,true);assert.equal(formats[0].url,'https://media.example.test/v?x=1&n=fixed%2Fvalue&range=0-9');
    assert.equal(formats[1].url,'https://media.example.test/a?n=fixed%2Fvalue');assert.equal(formats[2].url,'https://media.example.test/plain?x=1');
    c.StreamDecipher.fix([{url:'https://media.example.test/v?n=second'}],'synthetic source','player-a',error=>assert.equal(error,null));
    assert.equal(constructs,1);assert.equal(worker.request.player,'');worker.onmessage({data:{id:worker.request.id,ok:true,values:['second-fixed']}});
});
test('Decipher failure resets its worker without returning unprocessed streams',()=>{
    let worker,terminated=false,error;
    const c=vm.createContext({setTimeout,clearTimeout,Worker:function(){worker=this;this.postMessage=()=>{};this.terminate=()=>{terminated=true;};}});
    vm.runInContext(fs.readFileSync('app/decipher.js','utf8'),c);
    const formats=[{url:'https://media.example.test/v?n=synthetic'}];
    c.StreamDecipher.fix(formats,'source','player-a',e=>{error=e;});worker.onerror();
    assert.ok(error);assert.equal(terminated,true);assert.equal(formats[0].url,'https://media.example.test/v?n=synthetic');
});
test('Cancelling decipher terminates the pending job and allows the next video',()=>{
    const workers=[];
    const c=vm.createContext({setTimeout,clearTimeout,Worker:function(){workers.push(this);this.postMessage=m=>this.request=m;this.terminate=()=>this.terminated=true;}});
    vm.runInContext(fs.readFileSync('app/decipher.js','utf8'),c);
    c.StreamDecipher.fix([{url:'https://example.test/v?n=old'}],'source','player',()=>assert.fail('cancelled job completed'));
    c.StreamDecipher.cancel();assert.equal(workers[0].terminated,true);
    let complete=false;
    c.StreamDecipher.fix([{url:'https://example.test/v?n=new'}],'source','player',error=>{assert.equal(error,null);complete=true;});
    workers[0].onerror();assert.equal(complete,false);assert.notEqual(workers[1].terminated,true);
    workers[0].onmessage({data:{id:workers[0].request.id,ok:true,values:['old']}});assert.equal(complete,false);
    workers[1].onmessage({data:{id:workers[1].request.id,ok:true,values:['new']}});assert.equal(complete,true);
});
test('only prepared public code is persisted and reused after restarting for the same player',()=>{
    const storage=new Map(),workers=[];const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
    function load(){const c=vm.createContext({localStorage,setTimeout,clearTimeout,Worker:function(){workers.push(this);this.postMessage=m=>this.request=m;this.terminate=()=>{};}});vm.runInContext(fs.readFileSync('app/decipher.js','utf8'),c);return c;}
    const prepared={source:'packed-public-code',size:16};let c=load();
    c.StreamDecipher.fix([{url:'https://example.test/media?n=private-challenge'}],'public script','player-a',e=>assert.equal(e,null),12345);
    workers[0].onmessage({data:{id:workers[0].request.id,ok:true,values:['private-result'],prepared}});
    assert.doesNotMatch(storage.get('omega-decipher'),/private-|media\?/);
    assert.equal(c.StreamDecipher.timestamp('player-a'),12345);assert.equal(c.StreamDecipher.timestamp('player-b'),0);
    c=load();c.StreamDecipher.fix([{url:'https://example.test/v?n=new'}],'public script','player-a',e=>assert.equal(e,null));assert.equal(workers[1].request.prepared.source,prepared.source);assert.equal(workers[1].request.prepared.size,prepared.size);workers[1].onmessage({data:{id:workers[1].request.id,ok:true,values:['new-result']}});
    c=load();c.StreamDecipher.fix([{url:'https://example.test/v?n=other'}],'other script','player-b',e=>assert.equal(e,null));assert.equal(workers[2].request.prepared,'');workers[2].onmessage({data:{id:workers[2].request.id,ok:true,values:['other-result']}});
});
test('worker uses prepared code without extraction and rebuilds a damaged cache',()=>{
    let extracted=0;const messages=[],prepared="_result.n=function(v){return 'fixed-'+v;};";
    const c=vm.createContext({self:{postMessage:m=>messages.push(m)},decipherPhase:1,jsc:()=>{extracted++;return{preprocessed_player:prepared,responses:[{type:'result'}]};}});
    vm.runInContext(fs.readFileSync('scripts/decipher-worker.js','utf8'),c);
    c.self.onmessage({data:{id:1,key:'player-a',prepared:c.packDecipher(prepared),player:'public script',challenges:['one']}});assert.equal(extracted,0);assert.equal(messages[0].values[0],'fixed-one');
    c.self.onmessage({data:{id:2,key:'player-b',prepared:{source:'broken',size:99},player:'public script',challenges:['two']}});assert.equal(extracted,1);assert.equal(messages[1].ok,true);assert.equal(c.unpackDecipher(messages[1].prepared),prepared);assert.equal(messages[1].values[0],'fixed-two');
    const unicode='Жёлтый 😀 '+prepared.repeat(1000);assert.equal(c.unpackDecipher(c.packDecipher(unicode)),unicode);
});
