const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('matching prepared metadata skips the player download and a bad cache rebuilds once',()=>{
    const requests=[],transforms=[];
    function XHR(){this.open=()=>{};this.send=()=>{this.responseText=fs.readFileSync('app/clients.json','utf8');this.onload();};}
    const c={XMLHttpRequest:XHR,NativeNet:{request:(url,options,cb)=>requests.push({url,options,cb})},Auth:{signedIn:()=>true,token:cb=>cb(null,'synthetic-access')},StreamDecipher:{timestamp:()=>12345,fix(formats,source,key,cb,stamp){transforms.push({source,stamp});if(!source){cb('Damaged cache');return;}formats[0].url='https://example.test/v?n=fixed';cb(null);}}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('app/youtube.js','utf8'),c);c.YouTube.init(e=>assert.equal(e,null));requests.shift().cb(null,'"VISITOR_DATA":"synthetic"',200);
    let result;c.YouTube.player('synthetic01',(error,info)=>{assert.equal(error,null);result=info;});
    requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'LOGIN_REQUIRED'}}),200);
    const tv='{"player_url":"/s/player/synthetic/player.js"}';requests.shift().cb(null,tv,200);
    const player=requests.shift();assert.match(player.url,/youtubei\/v1\/player/);assert.equal(JSON.parse(player.options.body).playbackContext.contentPlaybackContext.signatureTimestamp,12345);
    player.cb(null,JSON.stringify({playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[{url:'https://example.test/v?n=synthetic'}]},videoDetails:{lengthSeconds:'60'}}),200);
    assert.equal(transforms.length,1);assert.equal(transforms[0].source,'');assert.match(requests[0].url,/youtube\.com\/tv$/);
    requests.shift().cb(null,tv,200);assert.match(requests[0].url,/s\/player\/synthetic\/player\.js$/);requests.shift().cb(null,'signatureTimestamp:54321',200);
    assert.equal(transforms.length,2);assert.equal(transforms[1].stamp,54321);assert.equal(result.formats[0].url,'https://example.test/v?n=fixed');assert.equal(requests.length,0);
});
test('an explicitly requested account player uses signed streams and preserves public metadata',()=>{
    const requests=[];function XHR(){this.open=()=>{};this.send=()=>{this.responseText=fs.readFileSync('app/clients.json','utf8');this.onload();};}
    const config=JSON.parse(fs.readFileSync('app/clients.json','utf8'));
    const c={XMLHttpRequest:XHR,NativeNet:{request:(url,options,cb)=>requests.push({url,options,cb})},Auth:{signedIn:()=>true,token:cb=>cb(null,'synthetic-access')},StreamDecipher:{timestamp:()=>12345}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('app/youtube.js','utf8'),c);c.YouTube.init(e=>assert.equal(e,null));requests.shift().cb(null,'"VISITOR_DATA":"synthetic"',200);
    let result;c.YouTube.player('synthetic01',(error,info)=>{assert.equal(error,null);result=info;},null,null,true);
    assert.match(requests[0].url,/youtubei\/v1\/player/);requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'OK'},videoDetails:{title:'Synthetic title',lengthSeconds:'60'}}),200);
    assert.match(requests[0].url,/youtube\.com\/tv$/);requests.shift().cb(null,'{"player_url":"/s/player/synthetic/player.js"}',200);
    const request=requests.shift(),body=JSON.parse(request.options.body);assert.equal(body.context.client.clientName,config.history.clientName);assert.equal(body.context.client.clientVersion,config.history.clientVersion);
    request.cb(null,JSON.stringify({playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[]}}),200);
    assert.equal(result.userAgent,config.history.userAgent);assert.equal(result.accountPlayer,true);assert.equal(result.duration,60);assert.equal(result.title,'Synthetic title');assert.equal(requests.length,0);
});
