(function (root) {
    'use strict';
    function el(id) { return document.getElementById(id); }
    var appVersion=root.tizen?tizen.application.getAppInfo().version:'dev';
    el('boot-version').textContent=el('app-version').textContent='TizenTube-2.4-Native '+appVersion;
    el('brand-version').textContent=appVersion;
    var saved;
    try { saved = JSON.parse(localStorage.getItem('omega-settings') || '{}'); } catch (e) { saved = {}; }
    var resumeRecords=[],resumeDirty=false,lastResumeWrite=0;
    try{var storedPositions=JSON.parse(localStorage.getItem('omega-resume')||'[]');if(Array.isArray(storedPositions))resumeRecords=storedPositions.filter(function(r){return Array.isArray(r)&&/^[\w-]{11}$/.test(r[0])&&typeof r[1]==='number'&&isFinite(r[1])&&r[1]>=0;}).slice(0,100);}catch(e){}
    root.playerSettings = {codec:saved.codec === 'vp9' ? 'vp9' : 'h264', height:[720,1080,1440,2160].indexOf(saved.height) >= 0 ? saved.height : 1080,
        tls:['auto','1.2','1.3'].indexOf(saved.tls) >= 0 ? saved.tls : 'auto', sponsor:saved.sponsor !== false,pauseAfterSeek:saved.pauseAfterSeek===true};
    playerSettings.autoplay=saved.autoplay===true;playerSettings.recommendations=saved.recommendations!==false;
    playerSettings.language=saved.language==='en'?'en':'ru';playerSettings.pauseWatchHistory=saved.pauseWatchHistory===true;
    playerSettings.sponsorNotice=saved.sponsorNotice!==false;playerSettings.sponsorMarkers=saved.sponsorMarkers!==false;
    playerSettings.sponsorCategories=Array.isArray(saved.sponsorCategories)?saved.sponsorCategories.filter(function(c){return ['sponsor','selfpromo','interaction','intro','outro','preview','filler','music_offtopic'].indexOf(c)>=0;}):['sponsor','selfpromo','interaction'];
    root.saveSettings=function(){
        var raw=JSON.stringify(playerSettings);
        try{localStorage.setItem('omega-settings',raw);return true;}
        catch(e){
            try{localStorage.removeItem('omega-decipher');localStorage.removeItem('ttl-diagnostics');localStorage.setItem('omega-settings',raw);return true;}
            catch(retryError){toast('Не удалось сохранить настройки');return false;}
        }
    };
    var native, generation = 0, video = null, currentPair = null, excludedItags = {}, formatFallbacks = 0, streamRefreshes = 0, position = 0, duration = 0, playing = false, paused = false, seeking = false, resumeAt = null, resumePaused = false,selectedQuality=null;
    var nativeReady = false, moduleReady = false, nativePlayable = false, loading = false, hudTimer, toastTimer, seekTimer, seekTarget = null,seekOrigin=null,awaitSeekResume=false,hudHeld=false;
    var sb = new SponsorBlock(function (target) { if(playerSettings.sponsorNotice)toast('Спонсорский фрагмент пропущен'); seek(target); });
    root.omegaDiagnostics = {state:'loading',samples:[]};
    function flushResume(){if(!resumeDirty)return;lastResumeWrite=Date.now();try{localStorage.setItem('omega-resume',JSON.stringify(resumeRecords));resumeDirty=false;}catch(e){}}
    function rememberResume(){
        if(!playing||!video||video.isLive||!nativePlayable||seeking||resumeAt!==null)return;
        resumeRecords=resumeRecords.filter(function(r){return r[0]!==video.id;});resumeRecords.unshift([video.id,position]);resumeRecords=resumeRecords.slice(0,100);resumeDirty=true;
        if(Date.now()-lastResumeWrite>=10000)flushResume();
    }
    function resumePosition(info){if(info.isLive)return null;for(var i=0;i<resumeRecords.length;i++)if(resumeRecords[i][0]===info.id){var at=resumeRecords[i][1];return at>0&&at<info.duration-1?at:null;}return null;}
    function status(text, prepare) { var node = el('status'); node.textContent = text; node.className = prepare ? 'preparing' : ''; }
    function connect() {
        if (!moduleReady) { status('Загрузка нативного модуля…'); return; }
        if (loading) return; loading = true; status('Подключение к YouTube…');
        YouTube.init(function (error) { loading = false; nativeReady = !error; root.omegaDiagnostics.state = error ? 'api-error' : 'ready';
            el('boot-version').hidden=!error;
            status(error ? 'Не удалось подключиться. Нажмите «Найти», чтобы повторить, или смените TLS в настройках.' : ''); if(!error)Shell.ready(); });
    }
    function toast(text) { el('toast').textContent = text; el('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el('toast').hidden = true; },3000); }
    function clock(n) { n = Math.max(0,Math.floor(n)); return (n >= 3600 ? Math.floor(n/3600)+':' : '') + (n >= 3600 && Math.floor(n/60)%60<10 ? '0' : '') + Math.floor(n/60)%60 + ':' + ('0'+n%60).slice(-2); }
    function armHud(){clearTimeout(hudTimer);if(playing && !hudHeld)hudTimer=setTimeout(function(){hudHeld=false;PlaybackControls.dismiss();el('hud').hidden=true;},5000);}
    function showHud(hold) { if(arguments.length)hudHeld=!!hold; el('hud').hidden = false;armHud(); }
    function syncPause(){el('play-pause').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';el('play-pause').className=paused?'is-paused':'';el('pause-indicator').hidden=!(playing&&paused);}
    function togglePause(){paused=!paused;awaitSeekResume=false;command(paused?'pause':'resume');syncPause();showHud();}
    function segments(){var host=el('sponsor-segments');host.textContent='';if(!playerSettings.sponsor||!playerSettings.sponsorMarkers||!duration)return;sb.segments.forEach(function(s){var mark=document.createElement('span');if(s.color)mark.style.background=s.color;mark.style.left=(Math.min(duration,s.start)/duration*100)+'%';mark.style.width=(Math.max(0,Math.min(duration,s.end)-s.start)/duration*100)+'%';host.appendChild(mark);});}
    function command(name, fields) { var m = fields || {}; m.type = 'player'; m.command = name; m.session=generation; native.postMessage(m); }
    function clearSeekPreview(){seekOrigin=null;el('seek-preview').hidden=el('seek-change').hidden=el('seek-marker').hidden=true;}
    function previewSeek(target){
        if(seekOrigin===null)seekOrigin=position;
        var delta=Math.round(target-seekOrigin),change=el('seek-change');
        el('progress').style.width=(duration?seekOrigin/duration*100:0)+'%';
        change.style.left=(duration?Math.min(seekOrigin,target)/duration*100:0)+'%';
        change.style.width=(duration?Math.abs(target-seekOrigin)/duration*100:0)+'%';
        change.className=target>=seekOrigin?'forward':'backward';change.hidden=false;
        el('seek-marker').style.left=(duration?target/duration*100:0)+'%';el('seek-marker').hidden=false;
        el('seek-preview').textContent=clock(target)+' / '+clock(duration)+' · '+(delta>=0?'+':'−')+clock(Math.abs(delta));el('seek-preview').hidden=false;
    }
    function seek(target,manual) {
        if (!playing || seeking) return;
        if (video && video.isLive) { seekTarget=null;clearTimeout(seekTimer);clearSeekPreview();if(manual)toast('Перемотка недоступна в прямом эфире'); return; }
        if (!nativePlayable) { seekTarget=null;clearTimeout(seekTimer);clearSeekPreview();toast('Дождитесь загрузки видео'); return; }
        if(manual)el('seek-bar').focus();
        if(manual)sb.waiting=null;
        seeking = true; seekTarget = null; clearTimeout(seekTimer);
        if(manual && playerSettings.pauseAfterSeek){awaitSeekResume=true;if(!paused)command('pause');paused=true;syncPause();}
        if(manual)previewSeek(Math.max(0,Math.min(duration-0.1,target)));
        DebugLog.record('seek',{position:target,stage:manual?'manual':'automatic'});
        command('seek',{position:Math.max(0,Math.min(duration-0.1,target))}); if(el('hud').hidden)showHud();
    }
    function fail(error) { rememberResume();flushResume();DebugLog.active(false);WatchHistory.stop();loading = playing = paused = hudHeld = false; currentPair = null; generation++; resumeAt=null;awaitSeekResume=false;clearTimeout(hudTimer);clearTimeout(seekTimer);seekTarget=null;clearSeekPreview();PlaybackControls.stop();syncPause();sb.reset(); command('stop'); el('home').hidden = false; el('hud').hidden = true; status(error); Shell.restore(); }
    function start(info,pair) {
        currentPair = pair;
        selectedQuality={codec:YouTube.codec(pair[0]),height:parseInt(YouTube.qualityLabel(pair[0]),10)||pair[0].height};
        if(!el('home').hidden)Shell.remember(); video = info; position = 0; duration = info.isLive ? 0 : info.duration; playing = true; paused = seeking = nativePlayable = hudHeld = false;
        clearTimeout(seekTimer);seekTarget=null;awaitSeekResume=false;clearSeekPreview();
        syncPause();el('sponsor-segments').textContent='';
        el('home').hidden = true; el('title').textContent = info.title;
        el('format').textContent = YouTube.qualityLabel(pair[0])+' · '+pair[0].width+'×'+pair[0].height+' · '+(YouTube.codec(pair[0])==='h264'?'H.264':'VP9')+' + AAC';
        el('play-state').textContent = 'Буферизация…'; el('sb-status').textContent = info.isLive ? 'Прямой эфир' : playerSettings.sponsor ? 'SponsorBlock · загрузка' : 'SponsorBlock выключен'; showHud();
        command('open',{live:!!info.isLive,duration:duration,userAgent:info.userAgent,mode:playerSettings.tls,tracks:pair.map(function (f) { return {url:f.url+(f.url.indexOf('?')<0?'?':'&')+'cpn='+encodeURIComponent(info.cpn),length:Number(f.contentLength)||0,fps:f.fps||30}; })});
        var current = generation; sb.reset(); sb.enabled = playerSettings.sponsor && !info.isLive;
        sb.categories=playerSettings.sponsorCategories;
        if (sb.enabled) sb.load(info.id,current,function () { return generation; },function (error,count) { el('sb-status').textContent = error || 'SponsorBlock · '+count+' фрагм.';segments(); });
        loading = false;
    }
    function toggleSponsor(){playerSettings.sponsor=!playerSettings.sponsor;saveSettings();if(video&&video.isLive){sb.enabled=false;el('sb-status').textContent='Прямой эфир';segments();showHud();return;}sb.enabled=playerSettings.sponsor;sb.waiting=null;
        if(sb.enabled)sb.load(video.id,generation,function(){return generation;},function(error,count){el('sb-status').textContent=error||'SponsorBlock · '+count+' фрагм.';segments();});
        else {el('sb-status').textContent='SponsorBlock выключен';segments();}showHud();}
    function controls(info){PlaybackControls.start(info,{toast:toast,reveal:showHud,chapter:function(time){seek(time,true);},jump:function(delta){seek(position+delta,true);},pause:togglePause,sponsor:toggleSponsor,channel:function(id){back();Shell.channel(id);},quality:function(pair){DebugLog.record('quality');if(resumeAt===null && !info.isLive){resumeAt=position;resumePaused=paused;}generation++;command('stop');start(info,pair);toast('Смена качества…');}});}
    function tryFormatFallback(info, trackIndex, code) {
        var failed = currentPair && currentPair[trackIndex];
        if (!info || info.isLive || !failed || !failed.itag || formatFallbacks >= 3) return false;
        excludedItags[failed.itag] = true;
        var nextPair = YouTube.select(info, playerSettings, excludedItags);
        if (!nextPair || nextPair[trackIndex].itag === failed.itag) return false;
        formatFallbacks++;
        DebugLog.record('metadata', {state: trackIndex ? 'audio-format-fallback' : 'video-format-fallback', code: code || 0});
        if (resumeAt === null && position > 0 && !info.isLive) { resumeAt = position; resumePaused = paused; }
        status('');
        if (!playing) { controls(info); DebugLog.active(true); WatchHistory.start(info); }
        generation++; command('stop'); start(info, nextPair); toast('Пробую другой поток…');
        return true;
    }
    function open(id, fallbackTitle,preferAccount,isRefresh) {
        var keepPlayback = !!preferAccount || !!isRefresh;
        var keepPosition=resumeAt!==null?resumeAt:position,keepPaused=paused,keepQuality=selectedQuality;
        var fallbackInfo=preferAccount&&video&&video.id===id?video:null;
        if (!keepPlayback) { excludedItags = {}; formatFallbacks = 0; streamRefreshes = 0; }
        if (loading || !nativeReady) return;rememberResume();flushResume(); loading = true; var current = ++generation; command('stop'); playing = false; sb.reset(); status('Получение потоков…');
        YouTube.player(id,function (error,info) {
            if (current !== generation) return;
            if (error) { if(keepPlayback){if(fallbackInfo&&tryFormatFallback(fallbackInfo,1,503))return;fail(error);}else{loading=false;status(error);}return; }
            if (fallbackTitle && (!info.title || info.title === info.id)) info.title = fallbackTitle;
            var pair = YouTube.select(info,keepPlayback&&keepQuality?keepQuality:playerSettings);
            DebugLog.record('formats',{total:info.formats.length,direct:info.formats.filter(function(f){return !!f.url;}).length,sized:info.formats.filter(function(f){return !!f.url && Number(f.contentLength)>0;}).length,video:info.formats.filter(function(f){return /^video\//.test(f.mimeType||'');}).length,audio:info.formats.filter(function(f){return /^audio\//.test(f.mimeType||'');}).length,ok:!!pair});
            if (!pair) {if(keepPlayback&&fallbackInfo&&tryFormatFallback(fallbackInfo,1,503))return;var missing=info.formats.some(function(f){return f.url;}) && !info.formats.some(function(f){return f.url && Number(f.contentLength)>0;})?'Потоки без указанного размера пока не поддерживаются.':'Нет подходящих прямых потоков. Попробуйте другой кодек или ролик.';if(keepPlayback)fail(missing);else{loading=false;status(missing);}return;}
            if (keepPlayback) { excludedItags = {}; formatFallbacks = 0; }
            status('');
            resumeAt=keepPlayback&&!info.isLive?(keepPosition>0?keepPosition:null):resumePosition(info);resumePaused=keepPlayback&&keepPaused;controls(info);DebugLog.record('open');DebugLog.active(true);WatchHistory.start(info);start(info,pair);
            if(keepPlayback&&keepPaused&&resumeAt===null){paused=true;command('pause');syncPause();}
        },function(){return current===generation;},function(stage){if(current!==generation)return;var label=stage==='prepare'?'Подготовка видео… Первый запуск может занять больше времени. Назад — отменить.':stage==='account'?'Получение данных видео из аккаунта…':'Получение потоков…';if(keepPlayback){el('play-state').textContent=label;showHud();}else status(label,stage==='prepare');},preferAccount);
    }
    function back(finished) {
        if(loading && nativeReady && !playing){if(el('home').hidden){StreamDecipher.cancel();fail('');return;}generation++;loading=false;StreamDecipher.cancel();status('');return;}
        if (playing) {if(finished){resumeRecords=resumeRecords.filter(function(r){return r[0]!==video.id;});resumeDirty=true;}else rememberResume();flushResume(); generation++;DebugLog.record('stop');DebugLog.active(false);WatchHistory.stop();resumeAt=null;awaitSeekResume=false;hudHeld=false;PlaybackControls.stop();command('stop'); playing = paused = loading = false; syncPause(); sb.reset(); clearTimeout(hudTimer);clearTimeout(seekTimer); seekTarget = null;clearSeekPreview(); el('home').hidden = false; el('hud').hidden = true; status(''); Shell.restore(); }
        else if(Shell.back()) return;
        else if (root.tizen) tizen.application.getCurrentApplication().exit();
    }
    function ended(){var id=video.id;back(true);if(!playerSettings.autoplay)return;var current=generation;loading=true;status('Получение следующего видео…');
        YouTube.next(id,function(error,next){if(current!==generation)return;loading=false;if(error){status(error);return;}open(next);});}
    function draw(items) {
        Shell.results(items);status(items.length ? '' : 'Видео не найдены');
    }
    var suggestSerial=0,suggestTimer;
    function leaveSearchInput(){var available=el('search-suggestions');(!available.hidden && available.children.length?available.children[available.children.length-1]:el('search')).focus();}
    el('query').addEventListener('input',function(){var query=el('query').value.replace(/^\s+|\s+$/g,''),current=++suggestSerial;clearTimeout(suggestTimer);el('search-suggestions').hidden=true;
        if(!query || /^[\w-]{11}$/.test(query) || /youtube\.com|youtu\.be/.test(query))return;
        suggestTimer=setTimeout(function(){NativeNet.request('https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q='+encodeURIComponent(query),{headers:{}},function(error,body){
            if(current!==suggestSerial || error || el('search-form').hidden)return;var data;try{data=JSON.parse(body);}catch(e){return;}
            var host=el('search-suggestions');host.textContent='';if(!Array.isArray(data[1]))return;data[1].slice(0,6).forEach(function(value){if(typeof value!=='string')return;var button=document.createElement('button');button.type='button';button.textContent=value;button.onclick=function(){el('query').value=value;host.hidden=true;++suggestSerial;el('search-form').onsubmit({preventDefault:function(){}});};host.appendChild(button);});host.hidden=!host.children.length;
        });},350);
    });
    el('search-form').onsubmit = function (e) {
        e.preventDefault(); if (!nativeReady) { connect(); return; }
        if(root.SearchKeyboard){SearchKeyboard.hide();el('search').focus();}
        ++suggestSerial;el('search-suggestions').hidden=true;
        var query = el('query').value.replace(/^\s+|\s+$/g,''); if (!query || loading) return;
        Shell.searching();
        var id = /^[\w-]{11}$/.test(query) ? query : (/[?&]v=([\w-]{11})/.exec(query)||/youtu\.be\/([\w-]{11})/.exec(query)||[])[1];
        if (id) { open(id); return; }
        if (Shell.search) { Shell.search(query); return; }
        loading = true; var current = ++generation,searchScreen=Shell.searchGeneration?Shell.searchGeneration():null; status('Поиск…');
        YouTube.search(query,function (error,items) { if (current !== generation) return; loading = false;if(Shell.searchGeneration && Shell.searchGeneration()!==searchScreen)return; if (error) status(error); else draw(items); });
    };
    if(root.SearchKeyboard)SearchKeyboard.mount({leave:leaveSearchInput,submit:function(){el('search-form').onsubmit({preventDefault:function(){}});}});
    el('settings-button').onclick = function () { Shell.select('settings'); };
    if(root.SettingsUI)SettingsUI.mount();
    document.addEventListener('keydown',function (e) {
        var k = e.keyCode, target, cards, index, next;
        if(playing && !el('hud').hidden)armHud();
        if(playing && awaitSeekResume && k===13 && (el('hud').hidden || document.activeElement===el('seek-bar'))){e.preventDefault();if(!seeking){togglePause();el('seek-bar').focus();}return;}
        if(playing && PlaybackControls.key(k)){e.preventDefault();return;}
        if(!playing && root.SearchKeyboard && SearchKeyboard.key(k)){e.preventDefault();return;}
        if(!playing && !el('search-form').hidden && document.activeElement===el('query') && (k===38||k===65385)){
            leaveSearchInput();
            if(k===38)e.preventDefault();return;
        }
        if(!playing && !el('search-form').hidden && !el('search-suggestions').hidden){var suggestions=el('search-suggestions').children,selectedSuggestion=Array.prototype.indexOf.call(suggestions,document.activeElement);
            if(k===40 && document.activeElement===el('query') && suggestions.length){suggestions[0].focus();e.preventDefault();return;}
            if(selectedSuggestion>=0 && (k===38||k===40)){(k===38 && selectedSuggestion===0||k===40 && selectedSuggestion===suggestions.length-1?el('query'):suggestions[selectedSuggestion+(k===38?-1:1)]).focus();e.preventDefault();return;}
            if(selectedSuggestion>=0 && (k===10009||k===27)){el('query').focus();e.preventDefault();return;}
            if(selectedSuggestion>=0 && k===13){suggestions[selectedSuggestion].click();e.preventDefault();return;}
        }
        if(!playing && root.SettingsUI && SettingsUI.key(k)){e.preventDefault();return;}
        if (k===10009 || k===27) { e.preventDefault(); back(); return; }
        if (playing) {
            e.preventDefault();
            if (k===10252 || k===19 || k===415) { if(k===19)paused=false;if(k===415)paused=true;togglePause(); }
            else if (k===37 || k===39 || k===412 || k===417) {
                if (video && video.isLive) { toast('Перемотка недоступна в прямом эфире'); showHud(); return; }
                if (seeking) return; seekTarget = Math.max(0,Math.min(duration-0.1,(seekTarget===null ? position : seekTarget)+(k===37 || k===412 ? -10 : 10)));
                if (nativePlayable) previewSeek(seekTarget);
                showHud(); clearTimeout(seekTimer); seekTimer = setTimeout(function () { seek(seekTarget,true); },650);
            } else showHud();
            return;
        }
        if(Shell.key(e))return;
        if (k<37 || k>40) return;
        target = document.activeElement; cards = el('results').querySelectorAll('button'); index = Array.prototype.indexOf.call(cards,target);
        if (index>=0) { next = index+(k===37 ? -1 : k===39 ? 1 : k===38 ? -4 : 4); if (next<0) el('query').focus(); else if (next<cards.length) cards[next].focus(); e.preventDefault(); }
        else if (k===40 && cards.length) { cards[0].focus(); e.preventDefault(); }
        else if (k===40 && target===el('query')) { el('search').focus(); e.preventDefault(); }
        else if (k===38 && target===el('query')) { el('settings-button').focus(); e.preventDefault(); }
        else if (k===37 && target===el('search')) { el('query').focus(); e.preventDefault(); }
        else if (k===39 && target===el('search')) { el('top-search').focus(); e.preventDefault(); }
        else if (k===37 && target===el('settings-button')) { el('search').focus(); e.preventDefault(); }
    });
    function receive(m) {
        if (!m || !m.type) return;
        if(root.HlsProxy && HlsProxy.receive(m))return;
        if (m.type!=='player' && m.type!=='ready') { NativeNet.receive(m); return; }
        if (m.type==='ready') {
            if (!m.ok || !m.nativePlayer || !m.elementaryStreams) { status('Нативный плеер недоступен'); return; }
            moduleReady = true;
            connect();
        } else {
            if(m.session!==generation)return;
            root.omegaDiagnostics.state = m.state; root.omegaDiagnostics.samples.push(m); if (root.omegaDiagnostics.samples.length>120) root.omegaDiagnostics.samples.shift();
            DebugLog.player(m);
            if (!playing) return;
            position = m.position; duration = m.duration; nativePlayable = m.ready === true;
            PlaybackControls.tick(position);
            el('media-tls').textContent=' · Видео: '+(m.video&&m.video.tls||'TLS…')+' / Аудио: '+(m.audio&&m.audio.tls||'TLS…');
            WatchHistory.tick(position,m.state==='playing' && !paused && !seeking && resumeAt===null && seekTarget===null);
            if(nativePlayable && resumeAt!==null){var targetPosition=resumeAt;resumeAt=null;if(resumePaused){paused=true;syncPause();command('pause');}seek(targetPosition);}
            if (!el('hud').hidden && seekTarget===null && !seeking) { el('time').textContent = video && video.isLive ? clock(position)+' · Прямой эфир' : clock(position)+' / '+clock(duration); el('progress').style.width = (video && video.isLive ? 100 : duration ? Math.min(100,position/duration*100) : 0)+'%'; }
            if(((m.state==='audio-error'&&m.code===503)||(m.state==='reconnecting'&&m.audio&&m.audio.http===503&&m.audio.serverRetries>=1))&&video&&!video.isLive&&!video.accountPlayer&&Auth.signedIn()){DebugLog.record('metadata',{state:'audio-client-fallback',code:503});open(video.id,video.title,true);return;}
            if((m.state==='video-error'||m.state==='audio-error')&&(!nativePlayable||m.code===503)&&video&&!video.isLive){
                var bothDeadHost=!nativePlayable&&m.code===0&&m.video&&m.audio&&!m.video.tls&&!m.audio.tls&&!m.video.http&&!m.audio.http;
                if(!bothDeadHost&&tryFormatFallback(video,m.state==='audio-error'?1:0,m.code))return;
                if(!video.accountPlayer&&Auth.signedIn()){DebugLog.record('metadata',{state:m.state==='audio-error'?'audio-client-fallback':'video-client-fallback',code:m.code||0});open(video.id,video.title,true);return;}
                if(bothDeadHost&&tryFormatFallback(video,m.state==='audio-error'?1:0,m.code))return;
            }
            if (m.code === -12 && (m.state === 'video-append-error' || m.state === 'audio-append-error') &&
                tryFormatFallback(video, m.state === 'audio-append-error' ? 1 : 0, m.code)) return;
            if ((m.state === 'video-error' || m.state === 'audio-error') && nativePlayable && m.code === 0 && video && !video.isLive && streamRefreshes < 2) {
                streamRefreshes++;
                DebugLog.record('metadata', {state: m.state === 'audio-error' ? 'audio-stream-refresh' : 'video-stream-refresh', code: 0});
                toast('Переподключение потока…');
                open(video.id, video.title, !!video.accountPlayer, true);
                return;
            }
            if (m.state.indexOf('error')>=0 || m.state==='invalid-url' || m.state==='unavailable' || m.state.indexOf('unsupported')===0) { fail('Плеер: '+m.state+' ('+m.code+')'); return; }
            if (m.state==='seeking') seeking = true;
            if (m.state==='seek-complete') { seeking = false;clearSeekPreview();el('time').textContent=video&&video.isLive?clock(position)+' · Прямой эфир':clock(position)+' / '+clock(duration);el('progress').style.width=(video&&video.isLive?100:duration?Math.min(100,position/duration*100):0)+'%'; }
            if (m.state==='ended') { ended(); return; }
            rememberResume();
            el('play-state').textContent = seeking ? 'Перемотка…' : paused ? awaitSeekResume?'Пауза · OK — продолжить':'Пауза' : m.state==='playing' ? '' : 'Буферизация…';
            if (m.state==='playing' && (!video || !video.isLive) && seekTarget===null && resumeAt===null) sb.tick(position,duration,seeking);
        }
    }
    el('native-container').addEventListener('message',function (e) { receive(e.data); },true);
    el('native-container').addEventListener('error',function () { DebugLog.record('module-error');if(playing)fail('Нативный модуль завершился. Диагностика сохранена.');else status('Не удалось загрузить нативный модуль'); },true);
    el('native-container').addEventListener('crash',function(){DebugLog.record('module-error');if(playing)fail('Сбой нативного модуля. Диагностика сохранена.');},true);
    native = document.createElement('embed'); native.id = 'native'; native.type = 'application/x-nacl'; native.width = 1920; native.height = 1080;
    NativeNet.attach(native); native.src = 'player.nmf'; el('native-container').appendChild(native);
    try { ['MediaPlayPause','MediaPlay','MediaPause','MediaRewind','MediaFastForward'].forEach(function (key) { tizen.tvinputdevice.registerKey(key); }); } catch (e) { /* Desktop has no TV API. */ }
    root.omegaOpen = open;
}(this));
