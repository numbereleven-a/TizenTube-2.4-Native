const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('history records actual playback, ignores seek jumps and stops reporting after leaving',()=>{
    const pings=[],logs=[];
    const c={Auth:{signedIn:()=>true},DebugLog:{record:(event,data)=>logs.push({event,data})},YouTube:{historyInfo:(info,cb)=>cb(null,info.tracking),historyPing:(url,params,cb)=>{pings.push({url,params});cb(null);}}};vm.createContext(c);vm.runInContext(fs.readFileSync('app/watch-history.js','utf8'),c);
    c.WatchHistory.start({cpn:'synthetic-nonce1',duration:200,tracking:{videostatsPlaybackUrl:{baseUrl:'synthetic-playback'},videostatsWatchtimeUrl:{baseUrl:'synthetic-watchtime'}}});
    c.WatchHistory.tick(0,true);c.WatchHistory.tick(100,true);assert.equal(pings.length,0);
    for(let i=101;i<=106;i++)c.WatchHistory.tick(i,true);assert.equal(pings.length,2);assert.equal(pings[0].params.cpn.length,16);
    assert.equal(pings[1].params.st,'100.000');assert.equal(pings[1].params.et,'105.000');
    c.WatchHistory.tick(106,false);c.WatchHistory.tick(106,false);assert.equal(pings.length,2);
    for(let i=107;i<=140;i++)c.WatchHistory.tick(i,true);assert.equal(pings[1].url,'synthetic-watchtime');
    c.WatchHistory.stop();assert.equal(pings.at(-1).params.final,'1');let count=pings.length;c.WatchHistory.tick(150,true);assert.equal(pings.length,count);
    let late;c.YouTube.historyInfo=(info,cb)=>late=cb;
    c.WatchHistory.start({id:'synthetic02',cpn:'synthetic-nonce2',duration:200});for(let i=0;i<=6;i++)c.WatchHistory.tick(i,true);c.WatchHistory.stop();
    late(null,{videostatsPlaybackUrl:{baseUrl:'obsolete'},videostatsWatchtimeUrl:{baseUrl:'obsolete'}});assert.equal(pings.length,count);
    c.playerSettings={pauseWatchHistory:true};c.WatchHistory.start({id:'synthetic03'});
    for(let i=0;i<40;i++)c.WatchHistory.tick(i,true);c.WatchHistory.stop();assert.equal(pings.length,count);
});
test('diagnostics survives restart, bounds storage and accepts only safe typed fields',()=>{
    let stored='',writes=0;const storage={getItem:()=>stored,setItem:(k,v)=>{stored=v;writes++;}};
    function load(){const c={localStorage:storage,window:{addEventListener(){}}};vm.createContext(c);vm.runInContext(fs.readFileSync('app/diagnostics.js','utf8'),c);return c.DebugLog;}
    let log=load();log.record('player',{state:'audio-error',code:302,url:'https://secret.test/?token=synthetic',title:'Private title',position:2});
    assert.doesNotMatch(stored,/Private|secret|token/);log.active(true);log=load();assert.equal(log.read().some(r=>r.event==='unclean-exit'),true);
    for(let i=0;i<200;i++)log.record('seek',{position:i});assert.equal(log.read().length,160);
    writes=0;log.player({state:'playing',video:{http:200},audio:{http:200}});
    assert.equal(writes,1);assert.deepEqual(JSON.parse(stored).entries.slice(-3).map(r=>r.event),['player','network','network']);
});
