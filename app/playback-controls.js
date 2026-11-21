(function(root){
    'use strict';
    var info, hooks, serial=0, captionSerial=0, cues=[], chosen=-1, pending=false, liked=null,likeRevision=0,chapters=[],chaptersState='loading';
    function el(id){return document.getElementById(id);}
    function button(label,action){var b=document.createElement('button');b.textContent=label;b.onclick=action;el('play-options').appendChild(b);return b;}
    function close(){el('play-options').hidden=true;if(hooks.reveal)hooks.reveal(false);el('seek-bar').focus();}
    function renderLike(){el('play-like').className=liked===true?'is-liked':'';el('play-like').setAttribute('aria-pressed',liked===null?'mixed':String(liked));el('play-like-label').textContent=liked===true?'✓ Лайк':'Лайк';}
    function interact(action){if(pending)return;pending=true;var request=serial,rating=action==='like'||action==='removelike';
        if(rating){likeRevision++;el('play-like').setAttribute('aria-busy','true');el('play-like-label').textContent='Отправка…';}
        YouTube.interact(action,action==='subscribe'||action==='unsubscribe'?info.channelId:info.id,function(error){if(request!==serial)return;pending=false;
            if(rating){if(!error)liked=action==='like';renderLike();el('play-like').setAttribute('aria-busy','false');}
            hooks.toast(error||(rating?(liked?'Лайк поставлен':'Лайк снят'):'Действие выполнено'));
        });}
    function captions(index){
        chosen=index;cues=[];el('captions').textContent='';var request=++captionSerial;
        if(index<0){hooks.toast('Субтитры выключены');return;}
        hooks.toast('Загрузка субтитров…');
        var url=info.captions[index].baseUrl.replace(/([?&])fmt=[^&]*&?/g,'$1').replace(/[?&]$/,'');
        NativeNet.request(url+(url.indexOf('?')<0?'?':'&')+'fmt=json3',{headers:{}},function(error,body){
            if(request!==captionSerial)return;
            try{if(error)throw Error(error);var data=JSON.parse(body);cues=(data.events||[]).filter(function(e){return e.segs && e.dDurationMs>0;}).map(function(e){return {start:e.tStartMs/1000,end:(e.tStartMs+e.dDurationMs)/1000,text:e.segs.map(function(s){return s.utf8||'';}).join('')};});if(!cues.length)throw Error('empty');hooks.toast('Субтитры включены');}
            catch(e){chosen=-1;hooks.toast('Не удалось загрузить субтитры');}
        });
    }
    function show(category){
        var host=el('play-options');host.textContent='';host.hidden=false;
        if(hooks.reveal)hooks.reveal(true);
        button('Закрыть меню',close);
        if(category==='jump'){
            button(chaptersState==='loading'?'Главы загружаются…':chapters.length?'Главы автора':'Главы недоступны',function(){show('chapters');});
            button('В начало видео',function(){close();hooks.chapter(0);});
            [1,5,10,30,45,-1,-5,-10,-30,-45].forEach(function(minutes){button((minutes>0?'+':'−')+Math.abs(minutes)+' мин',function(){close();hooks.jump(minutes*60);});});
        }
        if(category==='chapters'){
            if(!chapters.length)button(chaptersState==='loading'?'Загрузка…':'У ролика нет доступных глав',function(){show('jump');});
            chapters.forEach(function(chapter){var seconds=Math.floor(chapter.time),label=Math.floor(seconds/60)+':'+('0'+seconds%60).slice(-2);button(label+' · '+chapter.title,function(){close();hooks.chapter(chapter.time);});});
        }
        if(category==='quality'){
        YouTube.qualities(info,playerSettings.codec).forEach(function(pair){
            button('Качество: '+YouTube.qualityLabel(pair[0]),function(){close();hooks.quality(pair);});});
        }
        if(category==='captions'){
        button('Субтитры: выключить',function(){captions(-1);close();});
        (info.captions||[]).forEach(function(track,index){var name=track.name||{},label=name.simpleText||(name.runs||[]).map(function(r){return r.text;}).join('')||track.languageCode;
            button('Субтитры: '+label+(chosen===index?' ✓':''),function(){captions(index);close();});});
        if(!info.captions.length)button('У ролика нет доступных субтитров',close);
        }
        if(category==='more'){
            button('Убрать оценку',function(){interact('removelike');});
            button('Отписаться от канала',function(){interact('unsubscribe');});
        }
        host.firstChild.focus();
    }
    root.PlaybackControls={
        start:function(value,callbacks){serial++;captionSerial++;info=value;info.captions=info.captions||[];hooks=callbacks;cues=[];chosen=-1;pending=false;liked=null;likeRevision=0;renderLike();el('play-like').setAttribute('aria-busy','false');el('captions').textContent='';el('play-options').hidden=true;
            var request=serial,revision=likeRevision;
            YouTube.rating(value.id,function(error,state){if(request!==serial||revision!==likeRevision||error)return;liked=state;renderLike();});
            chapters=[];chaptersState='loading';
            if(YouTube.chapters)YouTube.chapters(value.id,function(error,items){if(info!==value)return;chapters=items||[];chaptersState=error?'error':'ready';});
            el('play-pause').onclick=function(){hooks.pause();};
            el('play-quality').onclick=function(){show('quality');};
            el('play-like').onclick=function(){interact(liked===true?'removelike':'like');};
            el('play-subscribe').onclick=function(){interact('subscribe');};
            el('play-channel').hidden=!/^UC[\w-]{22}$/.test(value.channelId||'');
            el('play-channel').onclick=function(){if(!el('play-channel').hidden)hooks.channel(value.channelId);};
            el('play-captions').onclick=function(){show('captions');};
            el('play-sponsor').textContent='SponsorBlock: '+(playerSettings.sponsor?'вкл.':'выкл.');
            el('play-sponsor').onclick=function(){hooks.sponsor();el('play-sponsor').textContent='SponsorBlock: '+(playerSettings.sponsor?'вкл.':'выкл.');};
            el('play-more').onclick=function(){show('more');};
        },
        dismiss:function(){el('play-options').hidden=true;},
        stop:function(){serial++;captionSerial++;cues=[];el('play-options').hidden=true;el('captions').textContent='';el('seek-preview').hidden=true;},
        tick:function(position){var lines=[];for(var i=0;i<cues.length;i++)if(position>=cues[i].start && position<cues[i].end)lines.push(cues[i].text);var text=lines.join('\n');if(el('captions').textContent!==text)el('captions').textContent=text;},
        key:function(k){if(k===10252||k===19||k===415)return false;
            if(el('play-options').hidden){
                var toolbar=Array.prototype.filter.call(el('play-actions').children,function(b){return !b.hidden;}),target=document.activeElement,index=toolbar.indexOf(target);
                if(el('hud').hidden){if(k===13||k===38||k===40){hooks.reveal();el('seek-bar').focus();return true;}return false;}
                if(index>=0){if(k===13){target.click();return true;}if(k===37||k===39){toolbar[Math.max(0,Math.min(toolbar.length-1,index+(k===37?-1:1)))].focus();return true;}if(k===38||k===40){hooks.reveal();el('seek-bar').focus();return true;}}
                if(k===38){if(!info.isLive)show('jump');return true;}
                if(k===40){hooks.reveal(false);toolbar[0].focus();return true;}
                if(k===13){if(target===el('seek-bar'))hooks.pause();else{hooks.reveal();el('seek-bar').focus();}return true;}
                if(k===27||k===10009){el('hud').hidden=true;return true;}
                return false;
            }
            if(k===10009||k===27){close();return true;}
            var buttons=el('play-options').children,index=Array.prototype.indexOf.call(buttons,document.activeElement);
            if(k===13){if(index>=0)buttons[index].click();}
            else if(k>=37 && k<=40){index=Math.max(0,Math.min(buttons.length-1,index+(k===37||k===38?-1:1)));buttons[index].focus();if(buttons[index].scrollIntoViewIfNeeded)buttons[index].scrollIntoViewIfNeeded(false);}
            return true;
        }
    };
}(this));
