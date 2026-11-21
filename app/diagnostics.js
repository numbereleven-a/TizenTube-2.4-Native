(function(root){
    'use strict';
    var entries=[],start=Date.now(),lastState='',lastWrite=0,active=false,batching=false;
    try{var old=JSON.parse(localStorage.getItem('ttl-diagnostics')||'{}');entries=(old.entries||[]).slice(-120);active=old.active===true;}catch(e){}
    function persist(){try{localStorage.setItem('ttl-diagnostics',JSON.stringify({entries:entries,active:active}));}catch(e){entries=entries.slice(-60);try{localStorage.setItem('ttl-diagnostics',JSON.stringify({entries:entries,active:active}));}catch(ignore){}}}
    function record(event,fields){
        var allowed=['boot','unclean-exit','open','stop','quality','seek','player','network','module-error','script-error','history','decipher','formats','metadata'],values=['code','position','duration','videoAhead','audioAhead','http','redirects','retries','httpRetries','serverRetries','offset','reused','queued','inputBytes','line','ok','state','stage','endpoint','total','direct','sized','video','audio'];
        if(allowed.indexOf(event)<0)return;
        var row={ms:Date.now()-start,event:event};fields=fields||{};
        values.forEach(function(key){var value=fields[key];if(typeof value==='number' && isFinite(value)||typeof value==='boolean')row[key]=value;else if(['state','stage','endpoint'].indexOf(key)>=0 && typeof value==='string' && /^[a-z-]{1,40}$/.test(value))row[key]=value;});
        entries.push(row);if(entries.length>160)entries.shift();if(!batching)persist();
    }
    root.DebugLog={record:record,read:function(){return entries.slice();},active:function(value){active=value;persist();},player:function(m){
        if(m.state===lastState && Date.now()-lastWrite<10000)return;lastState=m.state;lastWrite=Date.now();
        batching=true;record('player',m);['video','audio'].forEach(function(key,index){var t=m[key];if(t){var fields={code:index};['http','redirects','retries','httpRetries','serverRetries','offset','reused','queued','inputBytes'].forEach(function(k){fields[k]=t[k];});record('network',fields);}});batching=false;persist();
    }};
    record('boot');if(active)record('unclean-exit');active=false;persist();
    window.addEventListener('error',function(e){record('script-error',{line:e.lineno});});
}(this));
