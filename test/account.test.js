'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function fixture(stored){
    const requests=[],timers=[],storage=new Map();if(stored)storage.set('omega-account',JSON.stringify(stored));
    const c=vm.createContext({NativeNet:{request:(url,options,cb)=>requests.push({url,options,cb})},
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:id=>{if(timers[id-1])timers[id-1].cancelled=true;}});
    vm.runInContext(fs.readFileSync('app/account.js','utf8'),c);return{auth:c.Auth,requests,timers,storage};
}
function begin(f,events){
    f.auth.start(e=>events.push(e));
    f.requests.shift().cb(null,'<script id="base-js" src="/synthetic.js"></script>',200);
    f.requests.shift().cb(null,'clientId:"synthetic-client",key:"synthetic-public-identity"',200);
    f.requests.shift().cb(null,JSON.stringify({device_code:'synthetic-device',user_code:'TEST-CODE',verification_url:'https://www.google.com/device',interval:5,expires_in:600}),200);
}
test('device login respects slow_down and stores only the persistent session after consent',()=>{
    const f=fixture(),events=[];begin(f,events);assert.equal(events[0].kind,'code');assert.equal(events[0].device_code,undefined);
    assert.equal(f.timers[0].ms,5000);f.timers[0].fn();
    f.requests.shift().cb('HTTP 400',JSON.stringify({error:'slow_down'}),400);assert.equal(f.timers[1].ms,10000);
    f.timers[1].fn();f.requests.shift().cb(null,JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600}),200);
    assert.equal(events[1].kind,'success');assert.equal(f.auth.signedIn(),true);
    assert.equal(JSON.parse(f.storage.get('omega-account')).refresh,'synthetic-refresh');
    assert.equal(f.storage.get('omega-account').includes('synthetic-access'),false);
});
test('cancelling a device login discards a late successful response',()=>{
    const f=fixture(),events=[];begin(f,events);f.timers[0].fn();const pending=f.requests.shift();f.auth.cancel();
    pending.cb(null,JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600}),200);
    assert.equal(events.length,1);assert.equal(f.auth.signedIn(),false);assert.equal(f.storage.size,0);
});
test('concurrent account requests share refresh, while cancelling QR does not interrupt it',()=>{
    const f=fixture({refresh:'synthetic-refresh',id:'synthetic-client',secret:'synthetic-public-identity'}),replies=[];
    f.auth.token((e,t)=>replies.push([e,t]));f.auth.token((e,t)=>replies.push([e,t]));assert.equal(f.requests.length,1);
    f.auth.cancel();f.requests.shift().cb(null,JSON.stringify({access_token:'synthetic-access',expires_in:3600}),200);
    assert.equal(replies.length,2);assert.equal(replies[0][1],'synthetic-access');
    f.auth.signOut();assert.equal(f.auth.signedIn(),false);assert.equal(f.storage.size,0);
});
test('signing out prevents an in-flight refresh from restoring the account',()=>{
    const f=fixture({refresh:'synthetic-refresh',id:'synthetic-client',secret:'synthetic-public-identity'}),replies=[];
    f.auth.token((e,t)=>replies.push([e,t]));const pending=f.requests.shift();f.auth.signOut();
    pending.cb(null,JSON.stringify({access_token:'synthetic-access',expires_in:3600}),200);
    assert.equal(replies.length,1);assert.ok(replies[0][0]);assert.equal(f.auth.signedIn(),false);assert.equal(f.storage.size,0);
});
test('saved accounts switch without leaking a pending refresh and reset removes all app data',()=>{
    const f=fixture({refresh:'synthetic-old-refresh',id:'synthetic-client',secret:'synthetic-public-identity'}),events=[];
    f.auth.profile({name:'Synthetic first',handle:'@first'});
    const oldKey=f.auth.accounts()[0].key;
    begin(f,events);f.timers[0].fn();f.requests.shift().cb(null,JSON.stringify({access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:3600}),200);
    f.auth.profile({name:'Synthetic second',handle:'@second'});
    assert.equal(f.auth.accounts().length,2);assert.equal(f.auth.accounts()[1].active,true);
    assert.equal(JSON.stringify(f.auth.accounts()).includes('refresh'),false);
    assert.equal(f.auth.select(oldKey),true);
    const replies=[];f.auth.token((e,t)=>replies.push([e,t]));const stale=f.requests.shift();
    assert.equal(new URLSearchParams(stale.options.body).get('refresh_token'),'synthetic-old-refresh');
    f.auth.select(f.auth.accounts()[1].key);assert.ok(replies[0][0]);
    stale.cb(null,JSON.stringify({access_token:'obsolete-access',expires_in:3600}),200);
    assert.equal(replies.length,1);assert.equal(JSON.parse(f.storage.get('omega-account')).refresh,'synthetic-new-refresh');
    f.auth.signOut();assert.equal(f.auth.accounts().length,1);assert.equal(f.auth.select(oldKey),true);
    for(const key of ['omega-settings','omega-resume','omega-decipher','ttl-diagnostics'])f.storage.set(key,'synthetic');
    f.auth.reset();assert.equal(f.storage.size,0);assert.equal(f.auth.signedIn(),false);
});
test('evicts decipher and diagnostics caches when localStorage throws QuotaExceededError',()=>{
    const requests=[],storage=new Map([['omega-account',JSON.stringify({refresh:'r',id:'i',secret:'s'})],['omega-decipher','huge'],['ttl-diagnostics','huge']]);let blocked=true;
    const c=vm.createContext({NativeNet:{request:(url,options,cb)=>requests.push({url,options,cb})},
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(blocked){const e=new Error('quota');e.name='QuotaExceededError';throw e;}storage.set(k,v);},removeItem:k=>{storage.delete(k);if(!storage.has('omega-decipher')&&!storage.has('ttl-diagnostics'))blocked=false;}},
        setTimeout:()=>1,clearTimeout(){}});
    vm.runInContext(fs.readFileSync('app/account.js','utf8'),c);
    c.Auth.profile({name:'Synthetic',handle:'@syn'});
    assert.equal(storage.has('omega-decipher'),false);assert.equal(storage.has('ttl-diagnostics'),false);
    assert.equal(c.Auth.accounts().length,1);
});
test('device login through NativeNet handles 428 authorization_pending and 403 slow_down until 200',()=>{
    const sent=[],timers=[],events=[],storage=new Map();
    const document={createElement:()=>{const a={};Object.defineProperty(a,'href',{set:url=>{const u=new URL(url);for(const k of ['protocol','hostname','pathname','search'])a[k]=u[k];}});return a;}};
    const c=vm.createContext({Uint8Array,document,playerSettings:{tls:'auto'},
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        setTimeout:(fn,ms)=>{timers.push({fn,ms,cancelled:false});return timers.length;},
        clearTimeout:id=>{if(timers[id-1])timers[id-1].cancelled=true;}});
    vm.runInContext(fs.readFileSync('app/network.js','utf8'),c);
    vm.runInContext(fs.readFileSync('app/account.js','utf8'),c);
    c.NativeNet.attach({postMessage:m=>sent.push({...m})});
    function respond(status,body){
        const req=sent.shift();assert.ok(req);
        c.NativeNet.receive({id:req.id,type:'headers',status});
        c.NativeNet.receive({id:req.id,type:'data',body:new TextEncoder().encode(body).buffer});
        c.NativeNet.receive({id:req.id,type:'done'});
    }
    function nextPollTimer(){
        const entry=timers.filter(t=>!t.cancelled&&t.ms!==45000).at(-1);
        assert.ok(entry);entry.cancelled=true;return entry;
    }
    c.Auth.start(e=>events.push(e));
    respond(200,'<script id="base-js" src="/synthetic.js"></script>');
    respond(200,'clientId:"synthetic-client",key:"synthetic-public-identity"');
    respond(200,JSON.stringify({device_code:'synthetic-device',user_code:'TEST-CODE',verification_url:'https://www.google.com/device',interval:5,expires_in:600}));
    assert.equal(events.length,1);assert.equal(events[0].kind,'code');assert.equal(events[0].userCode,'TEST-CODE');
    let poll=nextPollTimer();assert.equal(poll.ms,5000);poll.fn();
    respond(428,JSON.stringify({error:'authorization_pending'}));
    assert.equal(events.length,1);
    poll=nextPollTimer();assert.equal(poll.ms,5000);poll.fn();
    respond(403,JSON.stringify({error:'slow_down'}));
    assert.equal(events.length,1);
    poll=nextPollTimer();assert.equal(poll.ms,10000);poll.fn();
    respond(200,JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600}));
    assert.equal(events.length,2);assert.equal(events[1].kind,'success');assert.equal(c.Auth.signedIn(),true);
});
