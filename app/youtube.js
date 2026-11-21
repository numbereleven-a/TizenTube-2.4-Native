(function (root) {
    'use strict';
    var config, visitor = '', ready = false, historyStamp=0, historySource='', historyPlayerUrl='';
    function historyTimestamp(cb,force){
        if(force){historyStamp=0;historySource='';}
        if(historyStamp&&!force){cb(null,historyStamp);return;}
        var headers={'User-Agent':config.history.userAgent};
        NativeNet.request('https://www.youtube.com/tv',{headers:headers},function(error,body){
            if(error){cb(error);return;}
            var match=/"player_url":"([^"]+)"/.exec(body),url;
            try{url=match?JSON.parse('"'+match[1]+'"'):'';}catch(e){url='';}
            if(url.charAt(0)==='/')url='https://www.youtube.com'+url;
            if(!/^https:\/\/www\.youtube\.com\/s\/player\//.test(url)){cb('Не найдены параметры истории');return;}
            var storedStamp=!force&&StreamDecipher.timestamp?StreamDecipher.timestamp(url):0;
            if(storedStamp){historyStamp=storedStamp;historySource='';historyPlayerUrl=url;cb(null,historyStamp);return;}
            NativeNet.request(url,{headers:headers},function(error,script){if(error){cb(error);return;}var stamp=/signatureTimestamp:(\d+)/.exec(script);if(!stamp){cb('Не найдена версия плеера истории');return;}historyStamp=Number(stamp[1]);historySource=script;historyPlayerUrl=url;cb(null,historyStamp);});
        });
    }
    function json(url, options, cb) {
        NativeNet.request(url, options, function (error, body, status) {
            if (error) { cb(error, null, status); return; }
            try { body = JSON.parse(body); } catch (e) { cb('Неверный ответ сервера'); return; }
            cb(null, body, status);
        });
    }
    function post(role, endpoint, data, cb) {
        var c = config[role], client = {}, k, session = role === 'browse'||role==='history' ? '' : visitor;
        for (k in c.context) if (c.context.hasOwnProperty(k)) client[k] = c.context[k];
        client.clientName = c.clientName; client.clientVersion = c.clientVersion;
        client.hl = root.I18n?I18n.language:'ru'; client.gl = 'US'; if(session) client.visitorData = session;
        data.context = {client:client};
        var headers = {'Content-Type':'application/json', 'User-Agent':c.userAgent,
                'X-YouTube-Client-Name':String(c.clientNameId), 'X-YouTube-Client-Version':c.clientVersion,
                Origin:'https://www.youtube.com'};
        if(session)headers['X-Goog-Visitor-Id']=session;
        function send(){json('https://www.youtube.com/youtubei/v1/'+endpoint+'?prettyPrint=false',{method:'POST',body:JSON.stringify(data),headers:headers},cb);}
        if(role==='browse'||role==='history')Auth.token(function(error,token){if(error){cb(error);return;}headers.Authorization='Bearer '+token;send();});
        else send();
    }
    function text(value) { return typeof value==='string' ? value : value ? value.simpleText || value.content || (value.runs || []).map(function (r) { return r.text; }).join('') : ''; }
    function qualityLevel(format){return parseInt(format.qualityLabel,10)||format.height;}
    function codec(format){return /avc1/.test(format.mimeType)?'h264':/vp09|vp9/.test(format.mimeType) && !/vp09\.(?!00)|vp9\.[1-3]/.test(format.mimeType)?'vp9':'';}
    function qualityLabel(format){return format.qualityLabel||format.height+'p'+((format.fps||0)>30?format.fps:'');}
    function collect(value, out, seen, subscriptions) {
        var i, k, v, item, meta, header, command, parts;
        if (!value || typeof value !== 'object') return;
        if(subscriptions && value.shelfRenderer && (value.shelfRenderer.headerRenderer || value.shelfRenderer.tvhtml5ShelfRendererType==='TVHTML5_SHELF_RENDERER_TYPE_SHORTS'))return;
        if (value.videoRenderer) {
            v = value.videoRenderer;
            if (/^[a-zA-Z0-9_-]{11}$/.test(v.videoId) && !seen[v.videoId]) {
                seen[v.videoId] = true;
                item = {id:v.videoId, title:text(v.title), channel:text(v.ownerText || v.shortBylineText), duration:text(v.lengthText),date:text(v.publishedTimeText)};
                out.push(item);
            }
            return;
        }
        if(value.compactVideoRenderer || value.playlistVideoRenderer || value.gridVideoRenderer){collect({videoRenderer:value.compactVideoRenderer||value.playlistVideoRenderer||value.gridVideoRenderer},out,seen,subscriptions);return;}
        if(value.tileRenderer){
            v=value.tileRenderer;command=v.onSelectCommand||{};
            if(!command.watchEndpoint || v.contentType==='TILE_CONTENT_TYPE_PLAYLIST')return;
            meta=(v.metadata||{}).tileMetadataRenderer||{};header=(v.header||{}).tileHeaderRenderer||{};
            item={id:command.watchEndpoint.videoId,title:text(meta.title),channel:'',duration:''};parts=[];
            (meta.lines||[]).forEach(function(line){((line.lineRenderer||{}).items||[]).forEach(function(row){var s=text((row.lineItemRenderer||{}).text);if(s && s!=='•' && s!==' • ')parts.push(s);});});
            item.channel=parts[0]||'';
            item.date=parts.filter(function(s){return /назад|сегодня|вчера|\b20\d\d\b|\bago\b/i.test(s);})[0]||'';
            (header.thumbnailOverlays||[]).forEach(function(o){if(o.thumbnailOverlayTimeStatusRenderer)item.duration=text(o.thumbnailOverlayTimeStatusRenderer.text);});
            if(/^[\w-]{11}$/.test(item.id) && item.title && !seen[item.id]){seen[item.id]=true;out.push(item);}return;
        }
        if(value.lockupViewModel){
            v=value.lockupViewModel;if(v.contentType!=='LOCKUP_CONTENT_TYPE_VIDEO')return;
            meta=(v.metadata||{}).lockupMetadataViewModel||{};parts=[];
            (((meta.metadata||{}).contentMetadataViewModel||{}).metadataRows||[]).forEach(function(row){(row.metadataParts||[]).forEach(function(p){parts.push(text(p.text));});});
            item={id:v.contentId,title:text(meta.title),channel:parts[0]||'',duration:''};
            item.date=parts.filter(function(s){return /назад|сегодня|вчера|\b20\d\d\b|\bago\b/i.test(s);})[0]||'';
            var badge=find(v.contentImage,'thumbnailBadgeViewModel');if(badge)item.duration=text(badge.text);
            if(/^[\w-]{11}$/.test(item.id) && item.title && !seen[item.id]){seen[item.id]=true;out.push(item);}return;
        }
        if (Object.prototype.toString.call(value) === '[object Array]') {
            for (i = 0; i < value.length; i++) collect(value[i], out, seen,subscriptions);
        } else for (k in value) if (value.hasOwnProperty(k) && k !== 'adSlotRenderer' && k !== 'promotedSparklesWebRenderer' && k !== 'reelShelfRenderer' && k !== 'shortsLockupViewModel') collect(value[k], out, seen,subscriptions);
    }
    function find(value,key,subscriptions){
        if(!value || typeof value!=='object')return null;
        if(subscriptions && value.shelfRenderer && (value.shelfRenderer.headerRenderer || value.shelfRenderer.tvhtml5ShelfRendererType==='TVHTML5_SHELF_RENDERER_TYPE_SHORTS'))return null;
        if(value[key])return value[key];
        for(var k in value)if(value.hasOwnProperty(k)){var result=find(value[k],key,subscriptions);if(result)return result;}
        return null;
    }
    function nextToken(value,skipShelves){
        if(!value||typeof value!=='object'||skipShelves&&value.shelfRenderer)return '';
        var next=value.nextContinuationData||value.continuationCommand;if(next)return next.continuation||next.token||'';
        for(var key in value)if(value.hasOwnProperty(key)){var token=nextToken(value[key],skipShelves);if(token)return token;}return '';
    }
    function page(data,subscriptions,home){
        // TV subscriptions place a ranked, titled shelf before the chronological
        // untitled rows. Its cards and continuation belong to a different feed.
        var out={items:[],shelves:[],continuation:''};collect(data,out.items,{},subscriptions);
        function shelves(value){
            if(!value || typeof value!=='object')return;
            if(value.shelfRenderer){var shelf=value.shelfRenderer,items=[];if(shelf.tvhtml5ShelfRendererType==='TVHTML5_SHELF_RENDERER_TYPE_SHORTS')return;
                collect(shelf.content,items,{});if(items.length)out.shelves.push({title:text(find(shelf.headerRenderer,'title'))||text(shelf.title),items:items,continuation:nextToken(shelf.content,false)});return;}
            for(var k in value)if(value.hasOwnProperty(k))shelves(value[k]);
        }
        if(!subscriptions)shelves(data);
        if(home)out.continuation=nextToken(data,true);
        else{var next=find(data,'nextContinuationData',subscriptions), command=find(data,'continuationCommand',subscriptions);out.continuation=next && next.continuation || command && command.token || '';}
        return out;
    }
    root.YouTube = {
        init: function (cb) {
            var x = new XMLHttpRequest(); x.open('GET', 'clients.json', true);
            x.onload = function () {
                try { config = JSON.parse(x.responseText); } catch (e) { cb('Не удалось прочитать параметры клиента'); return; }
                NativeNet.request('https://www.youtube.com/', {headers:{'User-Agent':config.search.userAgent, 'Accept-Language':'en-US'}}, function (error, body) {
                    if (error) { cb(error); return; }
                    var match = /"VISITOR_DATA"\s*:\s*"([^"]+)"/.exec(body), version = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/.exec(body);
                    if (!match) { cb('YouTube не вернул параметры сессии'); return; }
                    visitor = match[1]; if (version) config.search.clientVersion = version[1]; ready = true; cb(null);
                });
            };
            x.onerror = function () { cb('Не удалось прочитать параметры клиента'); }; x.send();
        },
        chapters:function(id,cb){post('search','next',{videoId:id},function(error,data){if(error){cb(error);return;}var chapters=[],seen={};
            function walk(v){if(!v||typeof v!=='object')return;var item=v.chapterRenderer||v.macroMarkersListItemRenderer;
                if(item){var tap=item.onTap||{},endpoint=tap.innertubeCommand||tap;var time=item.timeRangeStartMillis!==undefined?Number(item.timeRangeStartMillis)/1000:Number((endpoint.watchEndpoint||{}).startTimeSeconds);
                    if(isFinite(time)&&time>=0&&!seen[time]){seen[time]=true;chapters.push({time:time,title:text(item.title)});}}
                for(var key in v)if(v.hasOwnProperty(key))walk(v[key]);}
            walk(data);chapters.sort(function(a,b){return a.time-b.time;});cb(null,chapters);
        });},
        search: function (query, cb) {
            if (!ready) { cb('Клиент ещё загружается'); return; }
            post('search', 'search', {query:query}, function (error, data) {
                if (error) { cb(error); return; } var out = []; collect(data, out, {}); cb(null, out.slice(0, 24));
            });
        },
        searchPage: function (query, continuation, cb) {
            if (!ready) { cb('Клиент ещё загружается'); return; }
            var body = continuation ? {continuation:continuation} : {query:query};
            post('search', 'search', body, function (error, data) {
                if (error) { cb(error); return; } var out = []; collect(data, out, {}); cb(null, {items:out, continuation:nextToken(data, false)});
            });
        },
        feed: function (id, continuation, cb) {
            if(!ready){cb('Клиент ещё загружается');return;}
            if(!Auth.signedIn()){cb('Войдите в аккаунт, чтобы открыть этот раздел');return;}
            var body=continuation ? {continuation:continuation} : {browseId:id};
            post('browse','browse',body,function(error,data){if(error){cb(error);return;}cb(null,page(data,id==='FEsubscriptions',id==='FEwhat_to_watch'));});
        },
        channel: function (id, continuation, cb) {
            if (!/^UC[\w-]{22}$/.test(id)) { cb('Канал недоступен'); return; }
            function received(error,data,followed){
                if(error){cb(error);return;}
                var items=[];
                var tabs=find(data,'tabs')||[],videos=tabs.map(function(tab){return tab.tabRenderer;}).filter(function(tab){
                    var endpoint=tab&&tab.endpoint||{},web=(endpoint.commandMetadata||{}).webCommandMetadata||{};
                    return /\/videos(?:[?#]|$)/.test(web.url||'')||/^EgZ2aWRlb3/.test((endpoint.browseEndpoint||{}).params||'');
                })[0];
                if(!continuation&&videos&&!videos.selected&&!followed){
                    var endpoint=videos.endpoint.browseEndpoint;
                    if(endpoint&&endpoint.browseId===id&&endpoint.params){post('search','browse',{browseId:id,params:endpoint.params},function(e,result){received(e,result,true);});return;}
                }
                if(!continuation&&(!videos||!videos.selected)){cb('Канал недоступен');return;}
                var list=continuation?data:videos.content;
                collect(list,items,{});
                var grid=find(list,'richGridRenderer')||find(list,'richGridContinuation');
                var rows=grid&&grid.contents||find(list,'continuationItems')||[];
                var more='';
                for(var i=rows.length-1;i>=0&&!more;i--)if(rows[i].continuationItemRenderer)more=nextToken(rows[i].continuationItemRenderer,false);
                if(root.omegaChannelTrace)root.omegaChannelTrace(data,!!continuation,rows.length,!!more);
                cb(null,{items:items,continuation:more||nextToken(find(list,'continuationItemRenderer')||list,false)});
            }
            post('search','browse',continuation?{continuation:continuation}:{browseId:id,params:'EgZ2aWRlb3PyBgQKAjoA'},received);
        },
        subscribedChannels: function (continuation, cb) {
            if(!Auth.signedIn()){cb('Войдите в аккаунт, чтобы открыть этот раздел');return;}
            post('browse','browse',continuation?{continuation:continuation}:{browseId:'FEchannels'},function(error,data){
                if(error){cb(error);return;}
                var items=[],seen={};
                function walk(value){
                    if(!value||typeof value!=='object')return;
                    var renderer=value.channelRenderer||value.gridChannelRenderer||value.tileRenderer||value.lockupViewModel;
                    if(renderer){
                        var endpoint=find(renderer,'browseEndpoint'),id=renderer.channelId||renderer.contentId||(endpoint&&endpoint.browseId);
                        var title=text(renderer.title)||text(find(renderer,'title'));
                        if(/^UC[\w-]{22}$/.test(id||'')&&title&&!seen[id]){
                            var images=find(renderer,'thumbnails')||find(renderer,'sources')||[],avatar='',width=0;
                            images.forEach(function(img){
                                var url=String(img.url||'').replace(/^\/\//,'https://');
                                if(/^https:\/\/yt3\.(?:ggpht\.com|googleusercontent\.com)\//.test(url)&&(!avatar||(img.width||0)>=width)){
                                    avatar=url;width=img.width||0;
                                }
                            });
                            seen[id]=true;items.push({id:id,title:title,isChannel:true,avatar:avatar});
                        }
                        return;
                    }
                    for(var k in value)if(value.hasOwnProperty(k))walk(value[k]);
                }
                walk(data);cb(null,{items:items,continuation:nextToken(data,false)});
            });
        },
        account: function (cb) {
            post('browse','account/accounts_list',{},function(error,data){
                if(error){cb(error);return;}
                var entries=[];
                function walk(value){if(!value || typeof value!=='object')return;for(var key in value)if(value.hasOwnProperty(key)){if(key==='accountItem'||key==='accountItemRenderer')entries.push(value[key]);else walk(value[key]);}}
                walk(data);var item=entries[0];entries.forEach(function(entry){if(entry.isSelected)item=entry;});
                if(!item){cb('Профиль пока недоступен');return;}cb(null,{name:text(item.accountName),handle:text(item.channelHandle)});
            });
        },
        player: function (id, cb, isCurrent,onProgress,preferAccount) {
            if (!ready) { cb('Клиент ещё загружается'); return; }
            var cpn=(Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)).slice(0,16), meta = {};
            function progress(state){if(isCurrent&&!isCurrent())return;if(root.DebugLog)DebugLog.record('metadata',{state:state});if(onProgress)onProgress(state);}
            progress('request');
            function signedFallback(){progress('account');historyTimestamp(function(error,stamp){if(isCurrent && !isCurrent())return;if(error){cb(error);return;}post('history','player',{videoId:id,cpn:cpn,contentCheckOk:true,racyCheckOk:true,playbackContext:{contentPlaybackContext:{html5Preference:'HTML5_PREF_WANTS',signatureTimestamp:stamp}}},function(error,data){response(error,data,'history');});});}
            function response(error,data,role){
                if(isCurrent && !isCurrent())return;
                if (error) { cb(error); return; }
                var details = data.videoDetails || {}, micro = (data.microformat || {}).playerMicroformatRenderer || {};
                var title = details.title || text(micro.title);
                if (title && !meta.title) meta.title = title;
                if (details.channelId && !meta.channelId) meta.channelId = details.channelId;
                if (Number(details.lengthSeconds) && !meta.duration) meta.duration = Number(details.lengthSeconds);
                if (details.isLive === true) meta.isLive = true;
                if (details.isLiveContent === true) meta.isLiveContent = true;
                if(role==='player'&&preferAccount&&Auth.signedIn()){signedFallback();return;}
                if (!data.playabilityStatus || data.playabilityStatus.status !== 'OK') {
                    if(role==='player' && Auth.signedIn()){signedFallback();return;}
                    cb(data.playabilityStatus && data.playabilityStatus.reason || 'Видео недоступно');return;
                }
                var formats = (data.streamingData || {}).adaptiveFormats || [];
                if(role==='player' && Auth.signedIn() && !formats.some(function(f){return f.url && (codec(f) || /audio\/mp4.*mp4a/.test(f.mimeType||''));})){signedFallback();return;}
                var lengthSec = Number(details.lengthSeconds) || meta.duration || 0;
                var isLive = details.isLive===true || meta.isLive===true || ((details.isLiveContent===true || meta.isLiveContent===true) && !lengthSec && !formats.some(function(f){return Number(f.contentLength)>0;}));
                function done(error){if(error){cb(error);return;}cb(null, {id:id,cpn:cpn, title:title || meta.title || id, accountPlayer:role==='history', channelId:details.channelId || meta.channelId, tracking:data.playbackTracking, captions:((data.captions||{}).playerCaptionsTracklistRenderer||{}).captionTracks||[], duration:lengthSec, isLive:isLive,isLiveContent:details.isLiveContent===true || meta.isLiveContent===true,hasHls:!!(data.streamingData||{}).hlsManifestUrl,hasDash:!!(data.streamingData||{}).dashManifestUrl,hlsUrl:(data.streamingData||{}).hlsManifestUrl||'',formats:formats, userAgent:config[role].userAgent});}
                if(role==='history' && formats.some(function(f){return /[?&]n=/.test(f.url||'');})){progress('prepare');StreamDecipher.fix(formats,historySource,historyPlayerUrl,function(error){
                    if(error&&!historySource){progress('account');historyTimestamp(function(loadError){if(isCurrent&&!isCurrent())return;if(loadError){done(loadError);return;}progress('prepare');StreamDecipher.fix(formats,historySource,historyPlayerUrl,done,historyStamp);},true);}
                    else done(error);
                },historyStamp);return;}
                done(null);
            }
            post('player', 'player', {videoId:id,cpn:cpn, contentCheckOk:true, racyCheckOk:true},function(error,data){response(error,data,'player');});
        },
        historyInfo:function(info,cb){historyTimestamp(function(error,stamp){if(error){cb(error);return;}post('history','player',{videoId:info.id,cpn:info.cpn,contentCheckOk:true,racyCheckOk:true,playbackContext:{contentPlaybackContext:{html5Preference:'HTML5_PREF_WANTS',signatureTimestamp:stamp}}},function(error,data){if(error){cb(error);return;}var tracking=data.playbackTracking;if(!tracking || !tracking.videostatsPlaybackUrl || !tracking.videostatsWatchtimeUrl){cb('YouTube не вернул данные истории аккаунта');return;}cb(null,tracking,{status:(data.playabilityStatus||{}).status,direct:((data.streamingData||{}).adaptiveFormats||[]).filter(function(f){return !!f.url;}).length});});});},
        historyPing:function(url,params,cb){
            if(!/^https:\/\/(www\.|s\.)?youtube\.com\/api\/stats\/(playback|watchtime)\?/.test(url||'')){cb('Нет адреса истории');return;}
            url=url.replace(/^https:\/\/(?:s\.)?youtube\.com\//,'https://www.youtube.com/');
            params.ver=2;
            var parts=url.split('?'),query=parts[1].split('&').filter(function(part){return !params.hasOwnProperty(part.split('=')[0]);});
            for(var key in params)if(params.hasOwnProperty(key))query.push(encodeURIComponent(key)+'='+encodeURIComponent(params[key]));
            url=parts[0]+'?'+query.join('&');
            Auth.token(function(error,token){if(error){cb(error);return;}NativeNet.request(url,{headers:{Authorization:'Bearer '+token,'User-Agent':config.history.userAgent,Origin:'https://www.youtube.com'}},function(error){cb(error);});});
        },
        next:function(id,cb){post(Auth.signedIn()?'browse':'search','next',{videoId:id},function(error,data){
            if(error){cb(error);return;}
            var automatic=find(data,'autoplayVideo')||find(data,'autoplayUpNextRenderer')||find(data,'nextVideoRenderer'),watch=find(automatic,'watchEndpoint');
            if(watch && /^[\w-]{11}$/.test(watch.videoId) && watch.videoId!==id){cb(null,watch.videoId);return;}
            var items=[];collect(data.contents,items,{});var next=items.filter(function(item){return item.id!==id;})[0];
            cb(next?null:'Следующее видео недоступно',next?next.id:null);
        });},
        rating:function(id,cb){
            if(!Auth.signedIn()){cb(null,null);return;}
            post('browse','next',{videoId:id},function(error,data){if(error){cb(error);return;}var rating=null;
                function walk(value){if(!value||typeof value!=='object')return;
                    var button=value.likeButtonRenderer,target=button&&button.target;
                    if(button&&target&&target.videoId===id){var state=button.likeStatus;if(state==='LIKE')rating=true;else if(state==='DISLIKE'||state==='INDIFFERENT')rating=false;}
                    var toggle=value.toggleButtonRenderer,endpoint=toggle&&toggle.defaultServiceEndpoint&&toggle.defaultServiceEndpoint.likeEndpoint;
                    if(endpoint&&endpoint.target&&endpoint.target.videoId===id&&endpoint.status==='LIKE'&&typeof toggle.isToggled==='boolean')rating=toggle.isToggled;
                    for(var key in value)if(value.hasOwnProperty(key))walk(value[key]);
                }walk(data);cb(null,rating);
            });
        },
        interact: function (action, id, cb) {
            if(!Auth.signedIn()){cb('Войдите в аккаунт');return;}
            var subscribe=action==='subscribe'||action==='unsubscribe';
            if(['like','removelike','subscribe','unsubscribe'].indexOf(action)<0 || !(subscribe ? /^UC[\w-]+$/ : /^[\w-]{11}$/).test(id||'')){cb('Действие недоступно');return;}
            post('browse',(subscribe?'subscription/':'like/')+action,subscribe?{channelIds:[id],params:action==='subscribe'?'EgIIAhgA':'CgIIAhgA'}:{target:{videoId:id}},function(error,data){cb(error || (data && data.error ? 'Сервер отклонил действие' : null));});
        },
        select: function (info, settings, excluded) {
            var video = [], audio = [], i, f, kind, live = !!info.isLive;
            for (i = 0; i < info.formats.length; i++) {
                f = info.formats[i];
                if (!f.url || (!live && !Number(f.contentLength))) continue;
                if (excluded && excluded[f.itag]) continue;
                if(f.drmTrackType || f.drmFamilies && f.drmFamilies.length)continue;
                if (/audio\/mp4.*mp4a/.test(f.mimeType) && (!f.audioChannels || f.audioChannels<=2) && (!f.audioTrack || f.audioTrack.audioIsDefault)) audio.push(f);
                kind = codec(f);
                if (kind && (!live || kind === 'h264') && qualityLevel(f) <= settings.height) video.push(f);
            }
            video.sort(function (a,b) { return Number(codec(b)===settings.codec)-Number(codec(a)===settings.codec) || qualityLevel(b)-qualityLevel(a) || (b.fps || 0)-(a.fps || 0) || b.bitrate-a.bitrate; });
            audio.sort(function (a,b) { return b.bitrate-a.bitrate; });
            if (!video.length || !audio.length) return null;
            return [video[0],audio[0]];
        },
        codec:codec,
        qualityLabel:qualityLabel,
        qualities:function(info,preferred){
            var levels=[],live=!!info.isLive,order=live?['h264']:preferred==='vp9'?['vp9','h264']:['h264','vp9'];
            info.formats.forEach(function(f){var level=qualityLevel(f),kind=codec(f);if(f.height && f.url && (live || Number(f.contentLength)) && kind && (!live || kind==='h264') && levels.indexOf(level)<0)levels.push(level);});
            return levels.sort(function(a,b){return b-a;}).map(function(level){for(var i=0;i<order.length;i++){var pair=root.YouTube.select(info,{codec:order[i],height:level});if(pair && qualityLevel(pair[0])===level)return pair;}return null;}).filter(function(pair){return !!pair;});
        }
    };
}(this));
