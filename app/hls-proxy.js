(function(root){
    'use strict';
    var native,serial=0,port=0,secret='',paths={},reverse={},order=[],readyCallback=null,userAgent='';
    function resolve(base,value){
        var origin=/^(https:\/\/[^/]+)\//.exec(base),url;
        if(!origin)return '';
        if(/^https:\/\//.test(value))url=value;else if(/^\/\//.test(value))url='https:'+value;else if(value.charAt(0)==='/')url=origin[1]+value;else url=base.replace(/[?#].*$/,'').replace(/[^/]*$/,'')+value;
        var a=document.createElement('a');a.href=url;
        return a.protocol==='https:' && /(^|\.)googlevideo\.com$/i.test(a.hostname) ? a.href : '';
    }
    function local(url,kind){
        var entry=url+'|'+kind;
        if(!reverse[entry]){var key=String(++serial)+(kind.indexOf('playlist')>=0?'.m3u8':kind==='audio'?'.aac':'.ts');paths[key]={url:url,kind:kind,entry:entry};reverse[entry]=key;order.push(key);if(order.length>2048){var old=order.shift();delete reverse[paths[old].entry];delete paths[old];}}
        return 'http://127.0.0.1:'+port+'/'+secret+'/'+reverse[entry];
    }
    function playlist(body,base,kind){
        var lines=body.split(/\r?\n/),out=[];
        var master=/#EXT-X-STREAM-INF:/.test(body);
        if(root.omegaHlsPlaylistTrace){var tags=[],count=0,variants=[];lines.forEach(function(line){var m=/^#(EXT[^: ]+)/.exec(line);if(m&&tags.indexOf(m[1])<0)tags.push(m[1]);if(line && line.charAt(0)!=='#')count++;if(/^#EXT-X-STREAM-INF/.test(line)){var codec=/CODECS="([^"]+)"/.exec(line),res=/RESOLUTION=(\d+x\d+)/.exec(line);variants.push({codecs:codec?codec[1]:'',resolution:res?res[1]:'',audioGroup:/AUDIO=/.test(line)});}});root.omegaHlsPlaylistTrace({tags:tags,entries:count,variants:variants});}
        var segments=[];lines.forEach(function(line,index){if(line.trim() && line.charAt(0)!=='#')segments.push(index);});
        if(segments.length>24 && /#EXT-X-MEDIA-SEQUENCE:\d+/.test(body) && !/#EXT-X-ENDLIST|#EXT-X-KEY|#EXT-X-MAP/.test(body)){
            var removed=segments.length-12,first=segments[0],cut=segments[removed-1]+1;
            var header=lines.slice(0,first).filter(function(line){return /^#EXTM3U|^#EXT-X-VERSION:|^#EXT-X-TARGETDURATION:|^#EXT-X-MEDIA-SEQUENCE:/.test(line);});
            header=header.map(function(line){return line.replace(/^(#EXT-X-MEDIA-SEQUENCE:)(\d+)/,function(all,prefix,n){return prefix+(Number(n)+removed);});});
            lines=header.concat(lines.slice(cut));
        }
        lines.forEach(function(line){
            if(/^#EXT-X-(INDEPENDENT-SEGMENTS|DATERANGE|CUEPOINT)(:|\s*$)/.test(line))return;
            if(line.charAt(0)==='#')line=line.replace(/URI="([^"]+)"/g,function(all,url){var target=resolve(base,url);if(!target)throw Error('invalid URI');return 'URI="'+local(target,master?'audio-playlist':kind)+'"';});
            else if(line.trim()){var target=resolve(base,line.trim());if(!target)throw Error('invalid URI');line=local(target,master?'video-playlist':kind==='audio-playlist'?'audio':'video');}
            out.push(line);
        });return out.join('\n');
    }
    function encode(value){var s=unescape(encodeURIComponent(value)),b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}
    function decode(buffer){var b=new Uint8Array(buffer),parts=[];for(var i=0;i<b.length;i+=8192)parts.push(String.fromCharCode.apply(null,b.subarray(i,i+8192)));return parts.join('');}
    function fetch(url,remaining,cb){NativeNet.request(url,{headers:{'User-Agent':userAgent},binary:true},function(error,body,status,headers){
        if(status>=300 && status<400 && remaining){var match=/(?:^|\r\n)location:\s*([^\r\n]+)/i.exec(headers||''),target=match&&resolve(url,match[1]);if(target){fetch(target,remaining-1,cb);return;}}
        cb(error,body,status,url,headers);
    });}
    root.HlsProxy={
        start:function(element,url,ua,cb){this.stop();native=element;userAgent=ua;readyCallback={url:url,cb:cb};native.postMessage({type:'hls-start'});},
        stop:function(){if(native)native.postMessage({type:'hls-stop'});native=null;readyCallback=null;port=0;secret='';paths={};reverse={};order=[];},
        receive:function(m){
            if(m.type==='hls-ready'){if(!readyCallback)return true;var job=readyCallback;readyCallback=null;if(m.code!==0||!m.port||!m.secret){job.cb('Локальный HLS недоступен');return true;}port=m.port;secret=m.secret;var url=resolve(job.url,job.url);job.cb(url?null:'Неизвестный источник HLS',url?local(url,'master-playlist'):'');return true;}
            if(m.type!=='hls-request')return false;
            var active=native,entry=paths[m.path],url=entry&&entry.url,id=m.id;if(!active)return true;if(!url){active.postMessage({type:'hls-response',id:id,status:502,playlist:false,body:new ArrayBuffer(0)});return true;}
            fetch(url,5,function(error,body,status,finalUrl,headers){if(native!==active)return;var isPlaylist=false;
                if(!error && body){var bytes=new Uint8Array(body);isPlaylist=bytes.length>=7 && decode(body.slice(0,7))==='#EXTM3U';if(isPlaylist){try{body=encode(playlist(decode(body),finalUrl,entry.kind));}catch(e){error='invalid playlist';}}}
                var contentType=/(?:^|\r\n)content-type:\s*([^;\r\n ]+)/i.exec(headers||'');contentType=contentType?contentType[1].toLowerCase():'';
                if(entry.kind==='audio')contentType='audio/aac';
                if(root.omegaHlsTrace){var raw=body?new Uint8Array(body):[];root.omegaHlsTrace({status:status,error:!!error,playlist:isPlaylist,bytes:body?body.byteLength:0,transportStream:!isPlaylist&&raw[0]===71,magic:!isPlaylist&&raw.length>=4?[raw[0],raw[1],raw[2],raw[3]]:[],contentType:contentType});}
                active.postMessage({type:'hls-response',id:id,status:error?502:status,playlist:isPlaylist,contentType:contentType,body:error?new ArrayBuffer(0):body});
            });return true;
        }
    };
}(this));
