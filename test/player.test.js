'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function load(file, extra = {}) {
    const context = vm.createContext({...extra});
    vm.runInContext(fs.readFileSync(file,'utf8'),context);
    return context;
}
test('HLS proxy answers an expired path instead of occupying a native connection slot',()=>{
    const messages=[];
    const c=load('app/hls-proxy.js',{ArrayBuffer,NativeNet:{request:()=>assert.fail('unexpected fetch')},document:{createElement:()=>{const a={};Object.defineProperty(a,'href',{get:()=>a.url,set:value=>{const u=new URL(value);a.url=u.href;a.protocol=u.protocol;a.hostname=u.hostname;}});return a;}}});
    c.HlsProxy.start({postMessage:m=>messages.push(m)},'https://manifest.googlevideo.com/index.m3u8','synthetic',()=>{});
    c.HlsProxy.receive({type:'hls-ready',code:0,port:1234,secret:'synthetic'});
    c.HlsProxy.receive({type:'hls-request',id:7,path:'expired'});
    assert.equal(messages.at(-1).type,'hls-response');assert.equal(messages.at(-1).id,7);assert.equal(messages.at(-1).status,502);
});
test('SponsorBlock merges overlaps and waits for the native seek to complete',()=>{
    let reply, seeks=[];
    const c=load('app/sponsorblock.js',{NativeNet:{request:(url,opts,cb)=>{reply=cb;}}});
    const sb=new c.SponsorBlock(t=>seeks.push(t));
    sb.load('synthetic01',1,()=>1,()=>{});
    reply(null,JSON.stringify([
        {actionType:'skip',segment:[5,10]}, {actionType:'skip',segment:[8,15]},
        {actionType:'skip',segment:[-1,20]}, {actionType:'skip',segment:[30,29]}
    ]),200);
    sb.tick(5.2,60,false); sb.tick(5.7,60,false); sb.tick(15,60,true); sb.tick(15,60,false);
    assert.deepEqual(seeks,[15]);
    sb.tick(6,60,false); assert.deepEqual(seeks,[15,15]); // revisiting the sponsorship skips it again
});
test('SponsorBlock ignores an obsolete video response and handles missing segments',()=>{
    let reply, calls=0;
    const c=load('app/sponsorblock.js',{NativeNet:{request:(u,o,cb)=>reply=cb}});
    const sb=new c.SponsorBlock(()=>calls++);
    sb.load('synthetic01',1,()=>2,()=>{throw Error('obsolete response');});
    reply(null,'[]',200); assert.equal(sb.segments.length,0);
    sb.load('synthetic02',2,()=>2,(error,count)=>{assert.equal(error,null);assert.equal(count,0);});
    reply('HTTP 404','',404); sb.tick(1,20,false);assert.equal(calls,0);
});
test('SponsorBlock requests only selected categories and avoids requests when none are enabled',()=>{
    const requests=[],seeks=[];
    const c=load('app/sponsorblock.js',{NativeNet:{request:(url,options,cb)=>requests.push({url,cb})}});
    const sb=new c.SponsorBlock(t=>seeks.push(t));sb.categories=['intro'];
    sb.load('synthetic01',1,()=>1,()=>{});
    assert.deepEqual(JSON.parse(new URL(requests[0].url).searchParams.get('categories')),['intro']);
    requests[0].cb(null,JSON.stringify([{category:'sponsor',actionType:'skip',segment:[2,8]},{category:'intro',actionType:'skip',segment:[10,20]}]),200);
    sb.tick(3,100,false);assert.equal(seeks.length,0);sb.tick(11,100,false);assert.deepEqual(seeks,[20]);
    sb.categories=[];sb.load('synthetic02',2,()=>2,(e,n)=>assert.equal(n,0));assert.equal(requests.length,1);assert.equal(sb.segments.length,0);
});
test('format selection uses supported direct video and the default AAC language',()=>{
    const c=load('app/youtube.js');
    const formats=[
        {itag:1,mimeType:'video/mp4; codecs="avc1.640028"',url:'https://example.test/a',contentLength:'100',height:1080,fps:30,bitrate:200},
        {itag:2,mimeType:'video/webm; codecs="vp09.00.50.08"',url:'https://example.test/b',contentLength:'100',height:2160,fps:60,bitrate:600},
        {itag:3,mimeType:'video/webm; codecs="vp09.02.50.10"',url:'https://example.test/c',contentLength:'100',height:2160,fps:60,bitrate:900},
        {itag:6,mimeType:'video/webm; codecs="vp9.2"',url:'https://example.test/hdr',contentLength:'100',height:2160,fps:60,bitrate:1200},
        {itag:4,mimeType:'audio/mp4; codecs="mp4a.40.2"',url:'https://example.test/d',contentLength:'100',bitrate:128,audioTrack:{audioIsDefault:true}},
        {itag:5,mimeType:'audio/mp4; codecs="mp4a.40.2"',url:'https://example.test/e',contentLength:'100',bitrate:256,audioTrack:{audioIsDefault:false}}
    ];
    let pair=c.YouTube.select({formats},{codec:'h264',height:1080});assert.equal(pair[0].itag,1);assert.equal(pair[1].itag,4);
    pair=c.YouTube.select({formats},{codec:'vp9',height:2160});assert.equal(pair[0].itag,2);
    pair=c.YouTube.select({formats:formats.filter(f=>f.itag!==2)},{codec:'vp9',height:2160});assert.equal(pair[0].itag,1);assert.equal(pair[1].itag,4);
    assert.equal(c.YouTube.select({formats},{codec:'h264',height:720}),null);
    formats.push({itag:7,mimeType:'audio/mp4; codecs="mp4a.40.2"',url:'https://example.test/surround',contentLength:'100',bitrate:512,audioChannels:6});
    assert.equal(c.YouTube.select({formats},{codec:'h264',height:1080})[1].itag,4);
});
test('network retries a safe pre-request failure once and completes the API response',()=>{
    let sent=[],results=[],timers=[];
    const c=load('app/network.js',{
        Uint8Array, playerSettings:{tls:'auto'}, setTimeout:(cb,ms)=>{timers.push({cb,ms});return timers.length;},clearTimeout:()=>{},
        document:{createElement:()=>{const a={};Object.defineProperty(a,'href',{set:url=>{let u=new URL(url);for(const k of ['protocol','hostname','pathname','search'])a[k]=u[k];}});return a;}}
    });
    c.NativeNet.attach({postMessage:m=>sent.push({...m})});
    c.NativeNet.request('https://example.test/api',{method:'POST',headers:{},body:'{}'},(...args)=>results.push(args));
    c.NativeNet.receive({id:1,type:'error',retryable:true,error:'TCP: -2'});
    assert.equal(sent.length,1);timers.find(t=>t.ms===300).cb();
    assert.equal(sent.length,2);assert.equal(sent[1].freshConnection,true);assert.equal(sent[1].id,2);
    c.NativeNet.receive({id:2,type:'headers',status:200});
    c.NativeNet.receive({id:2,type:'data',body:new TextEncoder().encode('{"ok":true}').buffer});
    c.NativeNet.receive({id:2,type:'done'});
    assert.equal(results.length,1);assert.equal(results[0][0],null);assert.equal(results[0][1],'{"ok":true}');
    c.NativeNet.request('https://example.test/api',{method:'POST',headers:{},body:'{}'},(...args)=>results.push(args));
    c.NativeNet.receive({id:3,type:'error',retryable:false,error:'TCP write: -2'});
    assert.equal(sent.length,3);assert.equal(results.length,2);assert.match(results[1][0],/Ошибка сети/);
    vm.runInContext('var decodeCalls=0,convert=String.fromCharCode;String.fromCharCode=function(){decodeCalls++;return convert.apply(null,arguments);};',c);
    c.NativeNet.request('https://example.test/api',{headers:{}},(...args)=>results.push(args));
    c.NativeNet.receive({id:4,type:'headers',status:200});
    c.NativeNet.receive({id:4,type:'data',body:new Uint8Array(256*1024).fill(65).buffer});
    c.NativeNet.receive({id:4,type:'error',error:'TCP read: -2'});
    assert.equal(c.decodeCalls,0);assert.equal(results[2][1],undefined);assert.equal(results[2][2],200);
    c.NativeNet.request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false',{method:'POST',body:'{}'},(...args)=>results.push(args));
    c.NativeNet.receive({id:5,type:'error',retryable:false,error:'TCP read: -2'});
    timers.filter(t=>t.ms===300).at(-1).cb();
    assert.equal(sent.at(-1).id,6);assert.equal(sent.at(-1).freshConnection,true);
    c.NativeNet.receive({id:6,type:'error',retryable:false,error:'TCP read: -2'});
    assert.equal(results.length,4);assert.match(results[3][0],/TCP read: -2/);
    c.NativeNet.request('https://www.youtube.com/youtubei/v1/player',{method:'POST',body:'{}'},(...args)=>results.push(args));
    for (const id of [7,8,9]) {
        c.NativeNet.receive({id,type:'error',retryable:true,error:'TCP read: -2',stage:'tls',sent:0});
        if(id<9)timers.filter(t=>t.ms===(id===7?300:900)).at(-1).cb();
    }
    assert.equal(sent.at(-1).id,9);assert.equal(results.length,5);assert.match(results[4][0],/TCP read: -2/);
    c.NativeNet.request('https://www.youtube.com/youtubei/v1/search',{method:'POST',body:'{"query":"synthetic"}'},(...args)=>results.push(args));
    for (const [id, delay] of [[10,300],[11,900],[12,1500],[13,2500]]) {
        c.NativeNet.receive({id,type:'error',retryable:true,error:'TCP read: -2',stage:'tls',sent:0});
        timers.filter(t=>t.ms===delay).at(-1).cb();
        assert.equal(sent.at(-1).id,id+1);
        assert.equal(sent.at(-1).freshConnection,true);
    }
    c.NativeNet.receive({id:14,type:'headers',status:200});
    c.NativeNet.receive({id:14,type:'data',body:new TextEncoder().encode('{"results":[]}').buffer});
    c.NativeNet.receive({id:14,type:'done'});
    assert.equal(results.length,6);assert.equal(results[5][1],'{"results":[]}');
});

test('ultrawide quality uses YouTube labels and exposes higher VP9 tiers without AV1',()=>{
    const c=load('app/youtube.js');
    const base={url:'https://example.test/media',contentLength:'100',fps:25,bitrate:100};
    const info={formats:[
        {...base,itag:137,width:1920,height:810,qualityLabel:'1080p',mimeType:'video/mp4; codecs="avc1.640028"'},
        {...base,itag:271,width:2560,height:1080,qualityLabel:'1440p',mimeType:'video/webm; codecs="vp9"'},
        {...base,itag:313,width:3840,height:1620,qualityLabel:'2160p',mimeType:'video/webm; codecs="vp9"'},
        {...base,itag:401,width:3840,height:1620,qualityLabel:'2160p',mimeType:'video/mp4; codecs="av01.0.12M.08"'},
        {...base,itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"'}
    ]};
    const choices=c.YouTube.qualities(info,'h264');assert.deepEqual(Array.from(choices,p=>p[0].itag),[313,271,137]);
    assert.equal(c.YouTube.qualityLabel(choices[2][0]),'1080p');
    assert.equal(c.YouTube.select(info,{codec:'vp9',height:1080})[0].itag,137);
    assert.equal(c.YouTube.codec(choices[0][0]),'vp9');
});
test('account feeds parse TV tiles and view-model texts with Bearer authentication',()=>{
    const requests=[];
    const config={history:{clientName:'TVHTML5',clientVersion:'5',clientNameId:7,userAgent:'synthetic'},player:{context:{},clientName:'VISIONOS',clientVersion:'1',clientNameId:101,userAgent:'synthetic'},search:{clientName:'WEB',clientVersion:'1',clientNameId:1,userAgent:'synthetic'},browse:{context:{},clientName:'TVHTML5',clientVersion:'1',clientNameId:7,userAgent:'synthetic'}};
    function XHR(){this.open=()=>{};this.send=()=>{this.responseText=JSON.stringify(config);this.onload();};}
    let deciphered=false;
    const c=load('app/youtube.js',{StreamDecipher:{fix:(formats,source,key,cb)=>{assert.equal(source,'signatureTimestamp:12345');assert.equal(key,'https://www.youtube.com/s/player/synthetic/player.js');formats[0].url='https://media.example.test/v?n=processed';deciphered=true;cb(null,formats);}},XMLHttpRequest:XHR,NativeNet:{request:(url,options,cb)=>requests.push({url,options,cb})},Auth:{signedIn:()=>true,token:cb=>cb(null,'synthetic-access')}});
    c.YouTube.init(error=>assert.equal(error,null));requests.shift().cb(null,'"VISITOR_DATA":"synthetic-visitor"',200);
    let page;c.YouTube.feed('FEsubscriptions','',(error,result)=>{assert.equal(error,null);page=result;});
    const request=requests.shift();assert.equal(request.options.headers.Authorization,'Bearer synthetic-access');assert.equal(JSON.parse(request.options.body).browseId,'FEsubscriptions');
    request.cb(null,JSON.stringify({contents:[{shelfRenderer:{headerRenderer:{title:{simpleText:'Ranked picks'}},content:{items:[
        {videoRenderer:{videoId:'synthetic02',title:{simpleText:'Ranked duplicate'}}},
        {continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'wrong-ranked-continuation'}}}}
    ]}}},{shelfRenderer:{content:{items:[
        {tileRenderer:{onSelectCommand:{watchEndpoint:{videoId:'synthetic01'}},metadata:{tileMetadataRenderer:{title:{simpleText:'Synthetic title'},lines:[]}},header:{tileHeaderRenderer:{}}}},
        {lockupViewModel:{contentType:'LOCKUP_CONTENT_TYPE_VIDEO',contentId:'synthetic02',metadata:{lockupMetadataViewModel:{title:{content:'View-model title'}}}}},
        {continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'synthetic-continuation'}}}}
    ]}}}]}),200);
    assert.equal(page.items.length,2);assert.equal(page.items[0].id,'synthetic01');assert.equal(page.items[1].title,'View-model title');assert.equal(page.continuation,'synthetic-continuation');
    c.YouTube.feed('FEsubscriptions',page.continuation,(error,result)=>{assert.equal(error,null);assert.equal(result.items[0].id,'synthetic03');assert.equal(result.continuation,'next-page');});
    const nextPage=requests.shift();assert.equal(JSON.parse(nextPage.options.body).continuation,'synthetic-continuation');
    nextPage.cb(null,JSON.stringify({contents:[{videoRenderer:{videoId:'synthetic03',title:{simpleText:'Older upload'}}},{continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'next-page'}}}}]}),200);
    c.YouTube.feed('FEwhat_to_watch','',(error,result)=>{assert.equal(error,null);assert.equal(result.items.length,1);assert.equal(result.shelves.length,1);assert.equal(result.continuation,'home-page');assert.equal(result.shelves[0].continuation,'row-page');});
    requests.shift().cb(null,JSON.stringify({contents:[{shelfRenderer:{headerRenderer:{title:{simpleText:'Home recommendations'}},content:{items:[{videoRenderer:{videoId:'synthetic04',title:{simpleText:'Home video'}}}],continuations:[{nextContinuationData:{continuation:'row-page'}}]}}}],continuations:[{nextContinuationData:{continuation:'home-page'}}]}),200);
    c.YouTube.rating('synthetic01',(error,value)=>{assert.equal(error,null);assert.equal(value,true);});
    const rating=requests.shift();assert.match(rating.url,/\/next\?/);assert.equal(rating.options.headers.Authorization,'Bearer synthetic-access');rating.cb(null,JSON.stringify({contents:{likeButtonRenderer:{target:{videoId:'synthetic01'},likeStatus:'LIKE'}}}),200);
    c.YouTube.rating('synthetic01',(error,value)=>{assert.equal(error,null);assert.equal(value,null);});requests.shift().cb(null,'{}',200);
    c.YouTube.rating('synthetic01',(error,value)=>{assert.equal(error,null);assert.equal(value,false);});requests.shift().cb(null,JSON.stringify({recommendations:{likeButtonRenderer:{target:{videoId:'synthetic02'},likeStatus:'LIKE'}},contents:{likeButtonRenderer:{target:{videoId:'synthetic01'},likeStatus:'INDIFFERENT'}}}),200);
    c.YouTube.rating('synthetic01',(error,value)=>{assert.equal(error,null);assert.equal(value,null);});requests.shift().cb(null,JSON.stringify({likeButtonRenderer:{target:{videoId:'synthetic02'},likeStatus:'LIKE'}}),200);
    let account;c.YouTube.account((error,value)=>{assert.equal(error,null);account=value;});
    requests.shift().cb(null,JSON.stringify({contents:[{accountItem:{accountName:{simpleText:'Other synthetic account'}}},{accountItem:{isSelected:true,accountName:{content:'Selected synthetic account'},channelHandle:{simpleText:'@synthetic'}}}]}),200);
    assert.equal(account.name,'Selected synthetic account');assert.equal(account.handle,'@synthetic');
    c.YouTube.historyInfo({id:'synthetic01',cpn:'synthetic-cpn'},(error,tracking)=>{assert.equal(error,null);assert.ok(tracking.videostatsPlaybackUrl);});
    requests.shift().cb(null,'{"player_url":"/s/player/synthetic/player.js"}',200);
    requests.shift().cb(null,'signatureTimestamp:12345',200);
    const signed=requests.shift(),payload=JSON.parse(signed.options.body);
    assert.equal(signed.options.headers.Authorization,'Bearer synthetic-access');assert.equal(payload.context.client.clientVersion,'5');
    assert.equal(payload.context.client.visitorData,undefined);assert.equal(payload.playbackContext.contentPlaybackContext.signatureTimestamp,12345);
    signed.cb(null,JSON.stringify({playbackTracking:{videostatsPlaybackUrl:{baseUrl:'https://www.youtube.com/api/stats/playback?ei=synthetic'},videostatsWatchtimeUrl:{baseUrl:'https://www.youtube.com/api/stats/watchtime?ei=synthetic'}}}),200);
    let playable;c.YouTube.player('synthetic01',(error,info)=>{assert.equal(error,null);playable=info;});
    const publicPlayer=requests.shift();assert.equal(publicPlayer.options.headers.Authorization,undefined);
    publicPlayer.cb(null,JSON.stringify({playabilityStatus:{status:'UNPLAYABLE',reason:'Unavailable in public client'}}),200);
    const accountPlayer=requests.shift();assert.equal(accountPlayer.options.headers.Authorization,'Bearer synthetic-access');
    assert.equal(JSON.parse(accountPlayer.options.body).playbackContext.contentPlaybackContext.signatureTimestamp,12345);
    accountPlayer.cb(null,JSON.stringify({playabilityStatus:{status:'OK'},videoDetails:{lengthSeconds:'100'},streamingData:{adaptiveFormats:[{url:'https://media.example.test/v?n=synthetic'}]}}),200);assert.equal(playable.duration,100);assert.equal(deciphered,true);assert.equal(playable.formats[0].url,'https://media.example.test/v?n=processed');
    c.YouTube.historyPing('https://s.youtube.com/api/stats/playback?cpn=old&c=old',{cpn:'synthetic-cpn'},error=>assert.equal(error,null));
    const ping=requests.shift(),url=new URL(ping.url);assert.equal(url.hostname,'www.youtube.com');assert.deepEqual(url.searchParams.getAll('cpn'),['synthetic-cpn']);assert.equal(url.searchParams.get('c'),'old');ping.cb(null,'',204);
    c.YouTube.historyPing('https://example.test/api/stats/playback?x=1',{},error=>assert.ok(error));assert.equal(requests.length,0);
    let active=true;
    c.YouTube.player('synthetic01',()=>assert.fail('cancelled player completed'),()=>active);
    active=false;requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'UNPLAYABLE'}}),200);
    assert.equal(requests.length,0);
    active=true;c.YouTube.player('synthetic01',()=>assert.fail('cancelled fallback completed'),()=>active);
    requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'UNPLAYABLE'}}),200);
    active=false;deciphered=false;
    requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[{url:'https://media.example.test/v?n=synthetic'}]}}),200);
    assert.equal(deciphered,false);
    c.YouTube.next('synthetic01',(e,id)=>{assert.equal(e,null);assert.equal(id,'synthetic02');});
    requests.shift().cb(null,JSON.stringify({autoplay:{autoplayVideo:{watchEndpoint:{videoId:'synthetic02'}}}}),200);
});
test('live stream format selection allows missing contentLength and prefers H.264',()=>{
    const c=load('app/youtube.js');
    const liveInfo={isLive:true,formats:[
        {itag:137,mimeType:'video/mp4; codecs="avc1.640028"',url:'https://example.test/v1080',height:1080,fps:30,bitrate:2500000},
        {itag:248,mimeType:'video/webm; codecs="vp9"',url:'https://example.test/vp9',height:1080,fps:30,bitrate:1800000},
        {itag:136,mimeType:'video/mp4; codecs="avc1.4d401f"',url:'https://example.test/v720',height:720,fps:30,bitrate:1200000},
        {itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"',url:'https://example.test/a',bitrate:128000}
    ]};
    const pair=c.YouTube.select(liveInfo,{codec:'vp9',height:1080});
    assert.equal(pair[0].itag,137);assert.equal(pair[1].itag,140);
    const qualities=c.YouTube.qualities(liveInfo,'vp9');
    assert.deepEqual(Array.from(qualities,p=>p[0].itag),[137,136]);
});
test('searchPage supports continuations and signed player falls back when VISIONOS has no usable formats',()=>{
    const requests=[];
    const config={history:{clientName:'TVHTML5',clientVersion:'5',clientNameId:7,userAgent:'synthetic'},player:{context:{},clientName:'VISIONOS',clientVersion:'1',clientNameId:101,userAgent:'synthetic'},search:{clientName:'WEB',clientVersion:'1',clientNameId:1,userAgent:'synthetic'},browse:{context:{},clientName:'TVHTML5',clientVersion:'1',clientNameId:7,userAgent:'synthetic'}};
    function XHR(){this.open=()=>{};this.send=()=>{this.responseText=JSON.stringify(config);this.onload();};}
    const c=load('app/youtube.js',{encodeURIComponent,XMLHttpRequest:XHR,Auth:{signedIn:()=>true,token:cb=>cb(null,'synthetic-access')},NativeNet:{request:(url,options,cb)=>requests.push({url,options,cb})},StreamDecipher:{fix:(formats,source,key,cb)=>cb(null,formats)}});
    c.YouTube.init(e=>assert.equal(e,null));requests.shift().cb(null,'"VISITOR_DATA":"synthetic-visitor"',200);
    let page;c.YouTube.searchPage('synthetic','',(error,result)=>{assert.equal(error,null);page=result;});
    const r1=requests.shift();assert.match(r1.url,/\/search\?/);
    r1.cb(null,JSON.stringify({contents:{twoColumnSearchResultsRenderer:{primaryContents:{sectionListRenderer:{contents:[
        {itemSectionRenderer:{contents:[{videoRenderer:{videoId:'synthetic01',title:{simpleText:'First match'}}}]}},
        {continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:'search-next'}}}}
    ]}}}}}),200);
    assert.equal(page.items.length,1);assert.equal(page.items[0].id,'synthetic01');assert.equal(page.continuation,'search-next');
    let nextPage;c.YouTube.searchPage('synthetic',page.continuation,(error,result)=>{assert.equal(error,null);nextPage=result;});
    const r2=requests.shift();assert.equal(JSON.parse(r2.options.body).continuation,'search-next');
    r2.cb(null,JSON.stringify({contents:[{videoRenderer:{videoId:'synthetic02',title:{simpleText:'Second match'}}}]}),200);
    assert.equal(nextPage.items.length,1);assert.equal(nextPage.items[0].id,'synthetic02');
    let playable;c.YouTube.player('syntheticAv1',(error,info)=>{assert.equal(error,null);playable=info;});
    const publicReq=requests.shift();assert.equal(publicReq.options.headers.Authorization,undefined);
    publicReq.cb(null,JSON.stringify({playabilityStatus:{status:'OK'},videoDetails:{lengthSeconds:'60'},streamingData:{adaptiveFormats:[{mimeType:'video/av01; codecs="av01.0.05M.08"',url:'https://example.test/av1',height:1080}]}}),200);
    const iframeReq=requests.shift();iframeReq.cb(null,'{"player_url":"/s/player/synthetic/player.js"}',200);
    const jsReq=requests.shift();jsReq.cb(null,'signatureTimestamp:12345',200);
    const signedReq=requests.shift();assert.equal(signedReq.options.headers.Authorization,'Bearer synthetic-access');
    signedReq.cb(null,JSON.stringify({playabilityStatus:{status:'OK'},videoDetails:{lengthSeconds:'60'},streamingData:{adaptiveFormats:[{mimeType:'video/mp4; codecs="avc1.640028"',url:'https://example.test/h264',height:1080,contentLength:'100'}]}}),200);
    assert.equal(playable.formats.length,1);assert.equal(playable.formats[0].url,'https://example.test/h264');
    let kidsPlayable;c.YouTube.player('syntheticKids',(error,info)=>{assert.equal(error,null);kidsPlayable=info;});
    requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'UNPLAYABLE'},videoDetails:{title:'Synthetic Kids Show',channelId:'UCkids',lengthSeconds:'3422'}}),200);
    requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'OK'},streamingData:{adaptiveFormats:[{mimeType:'video/mp4; codecs="avc1.640028"',url:'https://example.test/kids',height:720,contentLength:'100'}]}}),200);
    assert.equal(kidsPlayable.title,'Synthetic Kids Show');assert.equal(kidsPlayable.channelId,'UCkids');assert.equal(kidsPlayable.duration,3422);
    let microPlayable;c.YouTube.player('syntheticMicro',(error,info)=>{assert.equal(error,null);microPlayable=info;});
    requests.shift().cb(null,JSON.stringify({playabilityStatus:{status:'OK'},videoDetails:{author:'Synthetic Author'},microformat:{playerMicroformatRenderer:{title:{simpleText:'Micro Title'},publishDate:'2024-05-12'}},streamingData:{adaptiveFormats:[{mimeType:'video/mp4; codecs="avc1.640028"',url:'https://example.test/micro',height:720,contentLength:'100'}]}}),200);
    assert.equal(microPlayable.title,'Micro Title');assert.equal(microPlayable.author,'Synthetic Author');assert.equal(microPlayable.published,'2024-05-12');
    let nextChapters,nextMeta;c.YouTube.chapters('syntheticMicro',(error,items,meta)=>{assert.equal(error,null);nextChapters=items;nextMeta=meta;});
    requests.shift().cb(null,JSON.stringify({contents:{videoPrimaryInfoRenderer:{dateText:{simpleText:'12 мая 2024\u202fг.'},relativeDateText:{simpleText:'2 года назад'}}}}),200);
    assert.equal(nextChapters.length,0);assert.equal(nextMeta.date,'12 мая 2024 г.');assert.equal(nextMeta.relativeDate,'2 года назад');
    const fbInfo={formats:[
        {itag:248,mimeType:'video/webm; codecs="vp9"',url:'https://example.test/v248',height:1080,fps:30,bitrate:1800000,contentLength:'100'},
        {itag:137,mimeType:'video/mp4; codecs="avc1.640028"',url:'https://example.test/v137',height:1080,fps:30,bitrate:2500000,contentLength:'100'},
        {itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"',url:'https://example.test/a140',bitrate:128000,contentLength:'100'},
        {itag:139,mimeType:'audio/mp4; codecs="mp4a.40.5"',url:'https://example.test/a139',bitrate:48000,contentLength:'100'}
    ]};
    assert.equal(c.YouTube.select(fbInfo,{codec:'vp9',height:1080},{248:true})[0].itag,137);
    assert.equal(c.YouTube.select(fbInfo,{codec:'vp9',height:1080},{140:true})[1].itag,139);
});
