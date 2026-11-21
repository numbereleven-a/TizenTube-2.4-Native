(function(root){
    'use strict';
    function el(id){return document.getElementById(id);}
    function t(value){return root.I18n?I18n.text(value):value;}
    var page='main',rows=[],selected=0,host,heading,description,notice,choiceBack;
    function focus(index){selected=Math.max(0,Math.min(rows.length-1,index));var b=host.children[selected];if(b){b.focus();if(b.scrollIntoViewIfNeeded)b.scrollIntoViewIfNeeded(false);description.textContent=t(rows[selected].description||'');}}
    function row(label,action,description){rows.push({label:label,action:action,description:description});}
    function render(title){heading.textContent=t(title);host.textContent='';description.textContent='';rows.forEach(function(r,index){var b=document.createElement('button');b.type='button';b.textContent=t(r.label);b.onclick=function(){r.action();};b.onfocus=function(){selected=index;description.textContent=t(r.description||'');};host.appendChild(b);});focus(0);}
    function label(value){return value?'Включено':'Отключено';}
    function goBack(){if(page==='choice')choiceBack();else if(page==='history'||page==='qr')privacy();else main();}
    function choose(title,key,options,help){if(page!=='choice')choiceBack=page==='playback'?playback:page==='interface'?interfaceSettings:page==='sponsor'?sponsor:page==='privacy'?privacy:main;page='choice';rows=[];row('Назад',choiceBack);options.forEach(function(o){row((playerSettings[key]===o[0]?'✓ ':'')+o[1],function(){var old=playerSettings[key];playerSettings[key]=o[0];if(!saveSettings()){playerSettings[key]=old;return;}if(key==='language'){location.reload();return;}choose(title,key,options,help);focus(options.indexOf(o)+1);},help);});render(title);description.textContent=t(help||'');}
    function toggle(title,key,help){choose(title,key,[[true,'Включено'],[false,'Отключено']],help);}
    function confirmation(title,help,action){page='confirm';rows=[];row('Отмена',main);row('Подтвердить',action,help);render(title);description.textContent=t(help);}
    function accountHistory(title,help){page='history';rows=[];row('Назад',privacy);row('Открыть настройки Google по QR-коду',function(){qr('https://myactivity.google.com/product/youtube',title,help);},help);render(title);description.textContent=t(help);}
    function qr(url,title,help){page='qr';rows=[];row('Назад',privacy);render(title);description.textContent=t(help);notice.textContent=url;notice.hidden=false;
        var code=qrcode(0,'M');code.addData(url);code.make();var canvas=el('settings-qr'),ctx=canvas.getContext('2d'),count=code.getModuleCount(),scale=Math.floor(360/(count+8)),offset=Math.floor((360-count*scale)/2);
        canvas.hidden=false;canvas.width=canvas.height=360;ctx.fillStyle='#fff';ctx.fillRect(0,0,360,360);ctx.fillStyle='#000';for(var y=0;y<count;y++)for(var x=0;x<count;x++)if(code.isDark(y,x))ctx.fillRect(offset+x*scale,offset+y*scale,scale,scale);
    }
    function clean(){rows=[];notice.hidden=true;el('settings-qr').hidden=true;}
    function privacy(){clean();page='privacy';row('Назад',main);
        row('Не записывать историю просмотра · '+label(playerSettings.pauseWatchHistory),function(){toggle('Не записывать историю просмотра','pauseWatchHistory','Не отправлять новые просмотры из этого приложения в историю YouTube. На других устройствах настройка не меняется.');});
        row('Не записывать историю поиска · Включено',function(){accountHistory('История поиска','Поиск в TizenTube-2.4-Native выполняется без авторизации и не добавляется в историю аккаунта. Историей на остальных устройствах можно управлять в Google.');});
        row('Очистить историю просмотра',function(){accountHistory('Очистить историю просмотра','Отсканируйте QR-код, выберите нужный аккаунт Google и удалите историю YouTube. Удаление затронет аккаунт на всех устройствах. Локальные позиции продолжения здесь не удаляются.');});
        row('Очистить историю поиска',function(){accountHistory('Очистить историю поиска','Отсканируйте QR-код и удалите поисковые запросы в настройках истории YouTube. Проверьте выбранный аккаунт Google перед удалением.');});
        row('История аккаунта на всех устройствах',function(){qr('https://myactivity.google.com/activitycontrols/youtube','История аккаунта','Отсканируйте QR-код для изменения записи истории просмотра и поиска в аккаунте Google на всех устройствах.');});render('История и конфиденциальность');
    }
    function sponsor(){clean();page='sponsor';row('Назад',main);
        row('SponsorBlock · '+label(playerSettings.sponsor),function(){toggle('SponsorBlock','sponsor','Автоматически пропускать выбранные категории фрагментов.');});
        var categories=[['sponsor','Рекламные интеграции'],['selfpromo','Самореклама'],['interaction','Просьбы подписаться и поставить лайк'],['intro','Заставки'],['outro','Концовки'],['preview','Повторы и анонсы'],['filler','Отступления от темы'],['music_offtopic','Немузыкальные части клипов']];
        categories.forEach(function(c){var checked=playerSettings.sponsorCategories.indexOf(c[0])>=0;row((checked?'✓ ':'○ ')+c[1],function(){var before=playerSettings.sponsorCategories.slice(),at=playerSettings.sponsorCategories.indexOf(c[0]);if(at<0)playerSettings.sponsorCategories.push(c[0]);else playerSettings.sponsorCategories.splice(at,1);if(!saveSettings())playerSettings.sponsorCategories=before;sponsor();focus(categories.indexOf(c)+2);},'Выбранные категории будут пропускаться автоматически.');});
        row('Метки на шкале · '+label(playerSettings.sponsorMarkers),function(){toggle('Метки на шкале','sponsorMarkers','Показывать цветные фрагменты SponsorBlock на шкале перемотки.');});
        row('Уведомление о пропуске · '+label(playerSettings.sponsorNotice),function(){toggle('Уведомление о пропуске','sponsorNotice','Показывать сообщение при автоматическом пропуске.');});render('Настройки SponsorBlock');
    }
    function accounts(){clean();page='accounts';row('Назад',main);Auth.accounts().forEach(function(a,index){row((a.active?'✓ ':'')+(a.name||a.handle||t('Аккаунт')+' '+(index+1)),function(){Auth.select(a.key);Shell.select('account');},a.handle);});row('Добавить аккаунт по QR-коду',function(){Shell.addAccount();});if(Auth.signedIn())row('Выйти из текущего аккаунта',function(){confirmation('Выйти из текущего аккаунта','Другие сохранённые аккаунты останутся на телевизоре.',function(){Auth.signOut();Shell.select('account');});});render('Аккаунты');}
    function playback(){clean();page='playback';row('Назад',main);
        row('Автовоспроизведение следующего видео · '+label(playerSettings.autoplay),function(){toggle('Автовоспроизведение следующего видео','autoplay','Сразу после окончания ролика воспроизводить следующее видео, предложенное YouTube.');});
        row('Кодек · '+(playerSettings.codec==='vp9'?'VP9':'H.264'),function(){choose('Кодек','codec',[['h264','H.264'],['vp9','VP9']],'Предпочтительный аппаратный видеокодек. VP9 позволяет смотреть 1440p и 4K.');});
        row('Качество · '+playerSettings.height+'p',function(){choose('Качество','height',[[720,'720p'],[1080,'1080p'],[1440,'1440p'],[2160,'2160p · 4K']],'Максимальное разрешение при открытии видео.');});
        row('Соединение TLS · '+playerSettings.tls,function(){choose('Соединение TLS','tls',[['auto','1.3 / 1.2 автоматически'],['1.3','TLS 1.3'],['1.2','TLS 1.2']],'Используется для API и нативных медиапотоков.');});
        row('После перемотки — пауза до OK · '+label(playerSettings.pauseAfterSeek),function(){toggle('После перемотки — пауза до OK','pauseAfterSeek','После ручной перемотки продолжать только по кнопке OK.');});
        render('Воспроизведение и сеть');
    }
    function interfaceSettings(){clean();page='interface';row('Назад',main);
        row('Рекомендации на этом устройстве · '+label(playerSettings.recommendations),function(){toggle('Рекомендации на этом устройстве','recommendations','Показывать рекомендованный контент на главной странице TizenTube-2.4-Native. Подписки и поиск останутся доступны.');});
        row('Язык · '+(playerSettings.language==='en'?'English':'Русский'),function(){choose('Язык','language',[['ru','Русский'],['en','English']],'Кнопки и текст приложения. После изменения приложение перезагрузится.');});
        render('Интерфейс');
    }
    function main(){clean();page='main';
        row('Воспроизведение и сеть',playback);row('Интерфейс',interfaceSettings);
        row('Аккаунты',accounts);row('История и конфиденциальность',privacy);row('Настройки SponsorBlock',sponsor);
        row('Диагностика',function(){clean();page='diagnostics';row('Назад',main);render('Диагностика');notice.hidden=false;notice.textContent=JSON.stringify(DebugLog.read(),null,2);description.textContent=t('Локальный журнал без адресов потоков, токенов и названий просмотренных видео.');});
        row('Сброс настроек',function(){confirmation('Сброс настроек','Будут удалены настройки приложения, все сохранённые аккаунты, позиции продолжения и локальная диагностика. История аккаунтов Google не удаляется.',function(){try{Auth.reset();location.reload();}catch(e){description.textContent=t('Не удалось выполнить сброс настроек');}});});
        render('Настройки');
    }
    root.SettingsUI={mount:function(){host=el('settings-options');heading=el('settings-heading');description=el('settings-description');notice=el('settings-notice');},open:main,accounts:accounts,focus:function(){focus(0);},key:function(key){
        if(!host||el('home').hidden||el('settings').hidden)return false;
        if(key===10009||key===27){if(page==='main')return false;goBack();return true;}
        if(!host.contains(document.activeElement))return false;
        if(key===13){if(rows[selected])rows[selected].action();return true;}
        if(key===38||key===40){if(key===38&&selected===0){el('settings-button').focus();return true;}focus(selected+(key===38?-1:1));return true;}
        if(key===37){if(page==='main')return false;goBack();return true;}
        if(key===39){if(rows[selected])rows[selected].action();return true;}return false;
    }};
}(this));
