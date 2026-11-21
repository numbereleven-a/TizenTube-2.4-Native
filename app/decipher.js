(function(root){
    'use strict';
    var worker=null,serial=0,pending=null,loaded='',memo=null,cacheRead=false;
    function cached(key){
        if(!cacheRead){cacheRead=true;try{memo=JSON.parse(localStorage.getItem('omega-decipher')||'null');}catch(e){}}
        return memo&&memo.key===key&&typeof memo.source==='string'&&memo.source.length<=4194304&&typeof memo.size==='number'&&memo.size>0&&memo.size<=8388608?memo:null;
    }
    function stop(){if(worker)worker.terminate();worker=null;loaded='';}
    function finish(error,values,code){var job=pending;if(!job)return;pending=null;clearTimeout(job.timer);if(error){if(job.cached){memo=null;try{localStorage.removeItem('omega-decipher');}catch(e){}}stop();}job.cb(error,values,code);}
    root.StreamDecipher={timestamp:function(key){var value=cached(key);return value&&typeof value.timestamp==='number'&&isFinite(value.timestamp)&&value.timestamp>0?value.timestamp:0;},cancel:function(){if(!pending)return;clearTimeout(pending.timer);pending=null;stop();},fix:function(formats,player,key,cb,timestamp){
        var challenges=[];
        try{formats.forEach(function(f){var m=/[?&]n=([^&]+)/.exec(f.url||'');if(m){var n=decodeURIComponent(m[1]);if(challenges.indexOf(n)<0)challenges.push(n);}});}catch(e){cb('Неверный адрес потока YouTube');return;}
        if(!challenges.length){cb(null,formats);return;}
        if(pending){cb('Обработка предыдущего потока ещё не завершена');return;}
        var started=Date.now(),id=++serial,prepared='';
        if(!worker){var cache=cached(key);if(cache){prepared={source:cache.source,size:cache.size};if(timestamp&&cache.timestamp!==timestamp){cache.timestamp=timestamp;try{localStorage.setItem('omega-decipher',JSON.stringify(cache));}catch(e){}}}}
        if(root.DebugLog)DebugLog.record('decipher',{state:loaded===key?'ready':prepared?'cached':'prepare',inputBytes:prepared?prepared.source.length:0});
        try{
            if(!worker){worker=new Worker('decipher-worker.js');var created=worker;worker.onmessage=function(e){if(!pending||e.data.id!==pending.id)return;if(e.data.ok){loaded=pending.key;if(root.DebugLog)DebugLog.record('decipher',{state:'derived',inputBytes:e.data.sourceBytes||0});if(e.data.prepared&&e.data.prepared.source.length<=4194304){try{memo={key:loaded,source:e.data.prepared.source,size:e.data.prepared.size,timestamp:pending.timestamp};localStorage.setItem('omega-decipher',JSON.stringify(memo));if(root.DebugLog)DebugLog.record('decipher',{state:'saved'});}catch(ignore){if(root.DebugLog)DebugLog.record('decipher',{state:'cache-full'});}}finish(null,e.data.values);}else {if(root.DebugLog)DebugLog.record('decipher',{code:e.data.code,inputBytes:e.data.inputBytes,state:e.data.state});finish('Не удалось обработать адрес потока YouTube',null,e.data.code);}};worker.onerror=function(){if(worker===created)finish('Ошибка обработчика потоков YouTube');};}
            pending={id:id,key:key,cached:!!prepared,timestamp:timestamp||0,timer:setTimeout(function(){finish('Обработка потока YouTube превысила время ожидания');},90000),cb:function(error,values){
                if(root.DebugLog)DebugLog.record('decipher',{ok:!error,duration:(Date.now()-started)/1000,code:arguments[2],reused:!!prepared});
                if(error){cb(error);return;}
                formats.forEach(function(f){if(f.url)f.url=f.url.replace(/([?&]n=)([^&]+)/,function(all,prefix,value){return prefix+encodeURIComponent(values[challenges.indexOf(decodeURIComponent(value))]);});});cb(null,formats);
            }};
            worker.postMessage({id:id,key:key,player:loaded===key?'':player,challenges:challenges,prepared:prepared});
        }catch(error){if(pending)finish('Не удалось запустить обработчик потоков YouTube');else{stop();cb('Не удалось запустить обработчик потоков YouTube');}}
    }};
}(this));
