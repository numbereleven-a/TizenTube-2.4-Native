(function(root){
    'use strict';
    var current=null,MAX_ATTEMPTS=3,RETRY_STEP=15;
    function accountKey(){
        if(!Auth.signedIn())return null;
        if(typeof Auth.accounts==='function'){
            var list=Auth.accounts();
            for(var i=0;i<list.length;i++)if(list[i]&&list[i].active)return list[i].key;
        }
        return 'signed-in';
    }
    function active(s){return !!s && s===current && accountKey()===s.account && !(root.playerSettings && playerSettings.pauseWatchHistory);}
    function scheduleRetry(s){
        s.requested=false;s.attempts++;
        if(s.attempts<MAX_ATTEMPTS)s.nextAttempt=s.played+RETRY_STEP*s.attempts;
    }
    function report(s,final){
        if(!active(s) || !s.tracking || !s.registered || !s.ranges.length)return;
        var ranges=s.ranges;s.ranges=[];
        YouTube.historyPing(s.tracking.watchtime,{cpn:s.cpn,st:ranges.map(function(r){return r.start.toFixed(3);}).join(','),et:ranges.map(function(r){return r.end.toFixed(3);}).join(','),cmt:s.position.toFixed(3),final:final?'1':'0'},function(error){DebugLog.record('history',{state:'watchtime',ok:!error});});
        s.lastReport=s.played;
    }
    function pingPlayback(s){
        YouTube.historyPing(s.tracking.playback,{cpn:s.cpn,cmt:s.ranges.length?s.ranges[0].start:0,len:s.info.duration},function(error){
            if(!active(s))return;
            DebugLog.record('history',{state:'playback',ok:!error});
            if(error){scheduleRetry(s);return;}
            s.registered=true;report(s,false);
        });
    }
    function register(s){
        s.requested=true;
        if(s.tracking){pingPlayback(s);return;}
        YouTube.historyInfo(s.info,function(error,tracking){
            if(!active(s))return;
            DebugLog.record('history',{state:'metadata',ok:!error});
            if(error){scheduleRetry(s);return;}
            s.tracking={playback:tracking.videostatsPlaybackUrl.baseUrl,watchtime:tracking.videostatsWatchtimeUrl.baseUrl};
            pingPlayback(s);
        });
    }
    root.WatchHistory={
        start:function(info){
            this.stop();
            var account=accountKey();
            current=account && !(root.playerSettings && playerSettings.pauseWatchHistory)?{info:info,account:account,tracking:null,cpn:info.cpn,position:0,previous:null,played:0,ranges:[],requested:false,registered:false,attempts:0,nextAttempt:5,lastReport:0}:null;
        },
        tick:function(position,playing){
            var s=current;if(!s)return;
            if(!active(s)){current=null;return;}
            var previous=s.previous,delta=previous===null?0:position-previous;s.previous=playing?position:null;s.position=position;
            if(playing && delta>0 && delta<3){s.played+=delta;var last=s.ranges[s.ranges.length-1];if(last && last.end===previous)last.end=position;else s.ranges.push({start:previous,end:position});}
            if(!s.registered && !s.requested && s.attempts<MAX_ATTEMPTS && s.played>=s.nextAttempt)register(s);
            if(s.registered && s.played-s.lastReport>=30)report(s,false);
        },
        stop:function(){if(current){report(current,true);current=null;}}
    };
}(this));
