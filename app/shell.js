(function(root){
    'use strict';
    function el(id){return document.getElementById(id);}
    var sections=[
        {id:'search',title:'Поиск',icon:'search'}, {id:'home',title:'Главная',icon:'home',feed:'FEwhat_to_watch'},
        {id:'subscriptions',title:'Подписки',icon:'subscriptions',feed:'FEsubscriptions'},
        {id:'library',title:'Библиотека',icon:'view_list',feed:'FElibrary'},
        {id:'history',title:'История',icon:'history',feed:'FEhistory'},
        {id:'later',title:'Смотреть позже',icon:'repeat',feed:'VLWL'},
        {id:'likes',title:'Понравившиеся',icon:'thumb_up',feed:'VLLL'},
        {id:'music',title:'Музыка',icon:'music',query:'музыка'},
        {id:'gaming',title:'Видеоигры',icon:'gaming',query:'видеоигры'},
        {id:'account',title:'Аккаунт',icon:'person'}, {id:'settings',title:'Настройки',icon:'settings'}
    ];
    var active='home',selected=1,railFocus=false,ready=false,serial=0,lastFocus=null,continuation='',busy=false,autoFailed=false,deferredItems=[],searchQuery='',emptyRetry=false;
    var thumbTimer=null;
    var channelSection=null, channelBack=null;
    var profileSerial=0;
    function profile(){
        var request=++profileSerial;el('profile-label').textContent=root.I18n?I18n.text(Auth.signedIn()?'Ваш аккаунт':'Аккаунт'):Auth.signedIn()?'Ваш аккаунт':'Аккаунт';
        if(!Auth.signedIn())return;
        YouTube.account(function(error,value){if(request!==profileSerial || !Auth.signedIn())return;if(!error){if(Auth.profile)Auth.profile(value);el('profile-label').textContent=value.name||value.handle||'Ваш аккаунт';}});
    }
    function thumbnails(){
        if(el('home').hidden)return;
        var images=el('results').querySelectorAll('img'),changes=[];
        for(var i=0;i<images.length;i++){var image=images[i],rect=image.getBoundingClientRect(),near=rect.bottom>-400 && rect.top<1480 && rect.right>-200 && rect.left<2320;
            if(near && !image.getAttribute('src'))changes.push({image:image,src:image.getAttribute('data-src')});
            else if(!near && image.getAttribute('src'))changes.push({image:image,src:null});}
        changes.forEach(function(change){if(change.src)change.image.src=change.src;else change.image.removeAttribute('src');});
    }
    function current(){return active==='channel'?channelSection:active==='channels'?{title:'Мои каналы',feed:'FEchannels'}:sections.filter(function(s){return s.id===active;})[0];}
    function status(s){var node=el('status');node.className='';node.textContent=s;}
    function focus(node){if(!node)return;node.focus();if(node.className.indexOf('card')>=0){var row=node.parentNode;if(row.className==='video-row'){var left=node.offsetLeft-row.offsetLeft;if(left<row.scrollLeft || left+node.offsetWidth>row.scrollLeft+row.clientWidth)row.scrollLeft=Math.max(0,left-40);}if(node.scrollIntoViewIfNeeded)node.scrollIntoViewIfNeeded(false);paginate(node);}thumbnails();}
    function rail(value){railFocus=value;el('rail').className=value?'expanded':'';if(value)focus(el('nav-'+sections[selected].id));}
    function reset(){serial++;busy=false;autoFailed=false;emptyRetry=false;continuation='';deferredItems=[];el('results').textContent='';el('more').hidden=true;el('feed-loading').hidden=true;el('empty-login').textContent='Аккаунт';}
    function pagedGrid(){return (active==='search'&&!!searchQuery)||(active!=='home'&&!!current().feed);}
    function panels(){
        el('search-form').hidden=active!=='search';el('settings').hidden=active!=='settings';el('account-panel').hidden=active!=='account';
        if(active!=='search')el('search-suggestions').hidden=true;
        if(active!=='search'&&root.SearchKeyboard)SearchKeyboard.hide();
        el('categories').hidden=active!=='home';el('results').hidden=active==='account'||active==='settings';el('empty').hidden=true;
        el('my-channels').hidden=active!=='subscriptions'||!Auth.signedIn();
        el('section-title').textContent=current().title;
        sections.forEach(function(s,i){el('nav-'+s.id).className='nav-item'+(s.id===active?' active':'');if(s.id===active)selected=i;});
        el('content').scrollTop=0;
    }
    function card(item){
        var b=document.createElement('button'),image=document.createElement('img'),info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small');
        b.className=item.isChannel?'card channel-card':'card';b.type='button';image.setAttribute('data-src',item.isChannel?(item.avatar||'icons/person.png'):'https://i.ytimg.com/vi/'+item.id+'/mqdefault.jpg');image.alt='';
        if(item.isChannel&&item.avatar)image.onerror=function(){image.onerror=null;image.setAttribute('data-src','icons/person.png');image.src='icons/person.png';};
        title.textContent=item.title;meta.textContent=(item.channel||'')+(item.date?' · '+item.date:'')+(item.duration?' · '+item.duration:'');info.className='card-info';info.appendChild(title);info.appendChild(meta);b.appendChild(image);b.appendChild(info);
        b.onclick=function(){lastFocus=b;if(item.isChannel)root.Shell.channel(item.id,item.title);else root.omegaOpen(item.id,item.title,false,false,item.date);};return b;
    }
    function render(items,append){
        var host=el('results');if(!append)host.textContent='';host.className='video-grid';
        items.forEach(function(item){host.appendChild(card(item));});
        thumbnails();
        el('empty').hidden=host.children.length>0;if(!host.children.length)el('empty-text').textContent='Здесь пока нет видео';
    }
    function renderPage(page,append){
        if(active==='home' && page.shelves && (page.shelves.length||append&&el('results').className==='shelves')){
            var host=el('results');if(!append)host.textContent='';host.className='shelves';
            page.shelves.forEach(function(s){var section=document.createElement('section'),title=document.createElement('h2'),row=document.createElement('div');
                title.textContent=s.title||'Рекомендуем';row.className='video-row';row.nextPage=s.continuation||'';s.items.forEach(function(item){row.appendChild(card(item));});section.appendChild(title);section.appendChild(row);host.appendChild(section);});
            continuation=page.continuation||'';
        }else{var items=deferredItems.concat(page.items);deferredItems=[];continuation=page.continuation||'';
            if(pagedGrid()&&continuation&&items.length%4)deferredItems=items.splice(items.length-items.length%4);
            render(items,append);}
        el('more').hidden=true;el('feed-loading').hidden=true;status('');thumbnails();
    }
    function load(append,automatic){
        if(active==='home' && root.playerSettings && playerSettings.recommendations===false){busy=false;status('Рекомендации отключены на этом устройстве');return;}
        if(!ready || busy)return;var section=current(),request=++serial,previousCount=el('results').querySelectorAll('.card').length;busy=true;if(!automatic)autoFailed=false;el('more').hidden=true;el('feed-loading').hidden=!append;status('Загрузка…');
        if(!append)el('empty').hidden=true;
        function done(error,page){if(request!==serial)return;busy=false;el('feed-loading').hidden=true;if(error){status(error);if(append){autoFailed=true;el('more').textContent='Повторить загрузку';el('more').hidden=false;return;}el('empty').hidden=false;emptyRetry=Auth.signedIn()||active==='search';el('empty-text').textContent=emptyRetry?'Не удалось загрузить видео':'Войдите, чтобы видеть рекомендации и видео ваших подписок';el('empty-login').textContent=emptyRetry?'Повторить загрузку':'Аккаунт';if(!railFocus)focus(el('empty-login'));return;}emptyRetry=false;el('empty-login').textContent='Аккаунт';renderPage(page,append);var cards=el('results').querySelectorAll('.card');if(deferredItems.length&&!cards.length&&continuation){load(true,true);return;}if(!railFocus&&(!automatic||previousCount===0||document.activeElement===el('more'))){focus(cards[append?previousCount:0]||(append?cards[cards.length-1]:null)||el('empty-login'));}}
        if(active==='channel')YouTube.channel(section.feed,append?continuation:'',done);
        else if(active==='channels')YouTube.subscribedChannels(append?continuation:'',done);
        else if(active==='search' && searchQuery){if(YouTube.searchPage)YouTube.searchPage(searchQuery,append?continuation:'',done);else YouTube.search(searchQuery,function(error,items){done(error,{items:items||[],shelves:[]});});}
        else if(section.query)YouTube.search(section.query,function(error,items){done(error,{items:items||[],shelves:[]});});
        else if(section.feed)YouTube.feed(section.feed,append?continuation:'',done);
    }
    function loadRow(row){
        if(!row.nextPage||row.loading)return;row.loading=true;
        YouTube.feed('FEwhat_to_watch',row.nextPage,function(error,page){
            if(active!=='home'||!el('results').contains(row))return;row.loading=false;
            if(error){status(error);return;}
            page.items.forEach(function(item){row.appendChild(card(item));});row.nextPage=page.continuation||'';thumbnails();
        });
    }
    function paginate(node){
        var row=node.parentNode,items=row.querySelectorAll('.card'),index=Array.prototype.indexOf.call(items,node);
        if(active==='home'&&row.className==='video-row'){
            if(index>=items.length-2)loadRow(row);
            if(row.parentNode!==el('results').lastChild)return;
        }else if(pagedGrid()){
            if(index<Math.max(0,(Math.ceil(items.length/4)-2)*4))return;
        }else return;
        if(continuation&&!busy&&!autoFailed)load(true,true);
    }
    function account(){
        var signed=Auth.signedIn(),request=++serial;el('signed-out').hidden=signed;el('signed-in').hidden=!signed;el('qr-view').hidden=true;el('login-start').hidden=false;
        if(!signed){el('account-name').textContent='';el('account-handle').textContent='';}
        el('account-status').textContent=signed?'Вход выполнен':'Войдите в свой аккаунт YouTube';
        if(signed)YouTube.account(function(error,profile){if(active!=='account'||request!==serial||!Auth.signedIn())return;if(!error&&Auth.profile)Auth.profile(profile);el('account-name').textContent=error?'Ваш аккаунт YouTube':profile.name;el('account-handle').textContent=error?'':profile.handle;});
    }
    function select(id,keepFocus,force){
        if(!force && id===active && el('results').children.length && id!=='account' && id!=='settings' && id!=='search'){rail(false);focus(el('results').querySelector('.card'));return;}
        if(id!==active && active==='account'){Auth.cancel();clearLogin();}searchQuery='';active=id;reset();panels();
        if(!keepFocus)rail(false);
        if(id==='account')account();else if(id==='settings')status('Параметры воспроизведения');else if(id==='search')status('Что хотите посмотреть?');else load(false);
        if(id==='settings' && root.SettingsUI)SettingsUI.open();
        if(!keepFocus){rail(false);if(id==='search')focus(el('query'));else if(id==='account')focus(Auth.signedIn()?el('account-subscriptions'):el('login-start'));else if(id==='settings'&&root.SettingsUI)SettingsUI.focus();}
    }
    function startLogin(){
        el('signed-out').hidden=false;el('signed-in').hidden=true;
        el('login-start').hidden=true;el('qr-view').hidden=true;el('account-status').textContent='Получение кода…';
        Auth.start(function(event){
            if(active!=='account')return;
            if(event.kind==='code'){
                el('qr-view').hidden=false;el('login-url').textContent=event.url.replace(/^https:\/\//,'');el('login-code').textContent=event.userCode;
                var qr=qrcode(0,'M');qr.addData(event.complete);qr.make();
                var canvas=el('qr'),context=canvas.getContext('2d'),count=qr.getModuleCount(),scale=Math.floor(400/(count+8)),offset=Math.floor((400-count*scale)/2);
                canvas.width=canvas.height=400;context.fillStyle='#fff';context.fillRect(0,0,400,400);context.fillStyle='#000';
                for(var y=0;y<count;y++)for(var x=0;x<count;x++)if(qr.isDark(y,x))context.fillRect(offset+x*scale,offset+y*scale,scale,scale);
                el('account-status').textContent='Отсканируйте QR-код и подтвердите вход на телефоне';focus(el('login-cancel'));
            }else if(event.kind==='success'){el('login-code').textContent='';el('qr-view').hidden=true;account();status(event.message||'Вы вошли в аккаунт');}
            else{el('qr-view').hidden=true;el('login-code').textContent='';el('login-start').hidden=false;el('account-status').textContent=event.message;focus(el('login-start'));}
        });
    }
    function clearLogin(){el('qr-view').hidden=true;el('login-code').textContent='';var canvas=el('qr');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}
    sections.forEach(function(section){
        var button=document.createElement('button'),icon=document.createElement('img'),label=document.createElement('span');
        button.id='nav-'+section.id;button.type='button';button.className='nav-item';button.setAttribute('aria-label',section.title);icon.src='icons/'+section.icon+'.png';icon.alt='';label.textContent=section.title;
        button.appendChild(icon);button.appendChild(label);button.onclick=function(){select(section.id);};el('nav-items').appendChild(button);
    });
    el('login-start').onclick=startLogin;el('login-cancel').onclick=function(){Auth.cancel();clearLogin();account();focus(el('login-start'));};
    el('logout').onclick=function(){Auth.signOut();};el('account-subscriptions').onclick=function(){select('subscriptions');};
    el('my-channels').onclick=function(){select('channels');};
    el('empty-login').onclick=function(){if(emptyRetry)load(false);else select('account');};el('more').onclick=function(){load(true);};
    el('top-search').onclick=function(){select('search');};el('top-account').onclick=function(){select('account');};
    el('content').onscroll=function(){clearTimeout(thumbTimer);thumbTimer=setTimeout(thumbnails,80);};
    ['Все','Музыка','Видеоигры','Новости','Наука и технологии','Документальные фильмы'].forEach(function(title,index){var b=document.createElement('button');b.textContent=title;b.type='button';b.className='chip'+(!index?' chosen':'');
        b.onclick=function(){if(!index){select('home',false,true);}else{reset();var request=serial,query=root.I18n?I18n.text(title):title;busy=true;status('Загрузка…');YouTube.search(query,function(error,items){if(request!==serial)return;busy=false;status(error||'');if(!error)render(items,false);});}var buttons=el('categories').children;for(var i=0;i<buttons.length;i++)buttons[i].className='chip';b.className='chip chosen';};el('categories').appendChild(b);});
    Auth.onchange=function(){clearLogin();profile();el('top-account').className=Auth.signedIn()?'signed':'';if(el('home').hidden)return;if(active==='account')account();else select('home',true);};
    root.Shell={
        ready:function(){ready=true;profile();el('top-account').className=Auth.signedIn()?'signed':'';select(active,true);rail(true);},
        select:select,
        channel:function(id,title){if(active!=='channel')channelBack={id:active,query:searchQuery};channelSection={id:'channel',title:title||'Канал',feed:id};active='channel';reset();panels();rail(false);load(false);},
        searchGeneration:function(){return active==='search'?serial:null;},
        addAccount:function(){select('account');startLogin();},
        search:function(query){active='search';reset();panels();searchQuery=query;rail(false);load(false);},
        searching:function(){searchQuery='';active='search';reset();panels();},
        results:function(items){render(items,false);focus(el('results').querySelector('button'));},
        remember:function(){lastFocus=document.activeElement;var images=el('results').querySelectorAll('img');for(var i=0;i<images.length;i++)images[i].removeAttribute('src');},
        restore:function(){if(lastFocus && document.documentElement.contains(lastFocus))focus(lastFocus);else rail(true);},
        back:function(){if(active==='channel'){var previous=channelBack;channelBack=null;if(previous&&previous.query)root.Shell.search(previous.query);else select(previous?previous.id:'home');return true;}if(active==='channels'){select('subscriptions');focus(el('my-channels'));return true;}if(!railFocus){if(active==='account'){Auth.cancel();clearLogin();account();}rail(true);return true;}return false;},
        key:function(e){
            var key=e.keyCode,target=document.activeElement,index,next,items,row;
            if(railFocus){
                if(key===38 || key===40){selected=Math.max(0,Math.min(sections.length-1,selected+(key===38?-1:1)));focus(el('nav-'+sections[selected].id));e.preventDefault();return true;}
                if(key===39 || key===13){select(sections[selected].id);var first=el('results').querySelector('button');if(first)focus(first);e.preventDefault();return true;}
                return false;
            }
            if(key<37 || key>40)return false;
            if(target===el('my-channels')){if(key===40)focus(el('results').querySelector('.card'));else if(key===38)focus(el('top-search'));else if(key===37)rail(true);e.preventDefault();return true;}
            if(target===el('more') && key===38){var last=el('results').querySelectorAll('.card');focus(last[last.length-1]);e.preventDefault();return true;}
            if(target===el('search')){
                if(key===37)focus(el('query'));
                else if(key===38||key===39)focus(el('top-search'));
                else{var firstSearch=el('results').querySelector('.card');if(firstSearch)focus(firstSearch);else if(!el('empty').hidden)focus(el('empty-login'));}
                e.preventDefault();return true;
            }
            var top=[el('top-search'),el('top-account'),el('settings-button')],topIndex=top.indexOf(target);
            if(topIndex>=0){
                if(key===37 && topIndex===0)rail(true);
                else if(key===37||key===39)focus(top[Math.max(0,Math.min(top.length-1,topIndex+(key===37?-1:1)))]);
                else if(key===40){if(active==='settings'&&root.SettingsUI)SettingsUI.focus();else focus(active==='account'?(Auth.signedIn()?el('account-subscriptions'):el('login-start')):active==='search'?el('query'):active==='home'?el('categories').firstChild:active==='subscriptions'&&!el('my-channels').hidden?el('my-channels'):el('results').querySelector('.card')||(!el('empty').hidden?el('empty-login'):null));}
                e.preventDefault();return true;
            }
            if(active==='account'){
                items=Array.prototype.slice.call(el('account-panel').querySelectorAll('button')).filter(function(b){return b.offsetWidth>0;});index=items.indexOf(target);
                if(index>=0){next=index+(key===37 || key===38?-1:1);if(next<0)rail(true);else if(next<items.length)focus(items[next]);e.preventDefault();return true;}
            }
            if(target.className.indexOf('chip')>=0){items=Array.prototype.slice.call(el('categories').children);index=items.indexOf(target);if(key===37 && index===0)rail(true);else if(key===37 || key===39)focus(items[Math.max(0,Math.min(items.length-1,index+(key===37?-1:1)))]);else if(key===40)focus(el('results').querySelector('.card')||(!el('empty').hidden?el('empty-login'):null));else focus(el('top-search'));e.preventDefault();return true;}
            if(target.className.indexOf('card')>=0){
                row=target.parentNode;items=Array.prototype.slice.call(row.querySelectorAll('.card'));index=items.indexOf(target);
                if(row.className==='video-row'){
                    if(key===37 && index===0){rail(true);}
                    else if(key===37 || key===39){focus(items[Math.max(0,Math.min(items.length-1,index+(key===37?-1:1)))]);}
                    else{var shelves=Array.prototype.slice.call(el('results').children),s=shelves.indexOf(row.parentNode)+(key===38?-1:1);if(s<0)focus(el('categories').firstChild);else if(s<shelves.length){var cards=shelves[s].querySelectorAll('.card');focus(cards[Math.min(index,cards.length-1)]);}else if(!el('more').hidden)focus(el('more'));}
                }else{
                    if(key===37 && index%4===0)rail(true);
                    else{next=index+(key===37?-1:key===39?1:key===38?-4:4);if(next<0)focus(active==='search'?el('query'):active==='home'?el('categories').firstChild:active==='subscriptions'&&!el('my-channels').hidden?el('my-channels'):el('top-search'));else if(next<items.length)focus(items[next]);else if(!el('more').hidden)focus(el('more'));}
                }
                e.preventDefault();return true;
            }
            if(key===37 && target!==el('query')){rail(true);e.preventDefault();return true;}
            if(key===40){var firstCard=el('results').querySelector('.card');if(firstCard && target!==el('login-start') && active!=='account' && active!=='settings'){focus(firstCard);e.preventDefault();return true;}}
            return false;
        }
    };
    panels();
}(this));
