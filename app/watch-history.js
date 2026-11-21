(function(root){
    'use strict';
    var current=null;
    function report(s,final){if(!s.tracking || !s.registered || !s.ranges.length)return;var ranges=s.ranges;s.ranges=[];
        YouTube.historyPing(s.tracking.watchtime,{cpn:s.cpn,st:ranges.map(function(r){return r.start.toFixed(3);}).join(','),et:ranges.map(function(r){return r.end.toFixed(3);}).join(','),cmt:s.position.toFixed(3),final:final?'1':'0'},function(error){DebugLog.record('history',{state:'watchtime',ok:!error});});s.lastReport=s.played;
    }
    root.WatchHistory={
        start:function(info){this.stop();current=Auth.signedIn() && !(root.playerSettings && playerSettings.pauseWatchHistory)?{info:info,tracking:null,cpn:info.cpn,position:0,previous:null,played:0,ranges:[],requested:false,registered:false,lastReport:0}:null;},
        tick:function(position,playing){var s=current;if(!s)return;
            var previous=s.previous,delta=previous===null?0:position-previous;s.previous=playing?position:null;s.position=position;
            if(playing && delta>0 && delta<3){s.played+=delta;var last=s.ranges[s.ranges.length-1];if(last && last.end===previous)last.end=position;else s.ranges.push({start:previous,end:position});}
            if(s.played>=5 && !s.requested){s.requested=true;
                YouTube.historyInfo(s.info,function(error,tracking){if(s!==current)return;DebugLog.record('history',{state:'metadata',ok:!error});if(error)return;s.tracking={playback:tracking.videostatsPlaybackUrl.baseUrl,watchtime:tracking.videostatsWatchtimeUrl.baseUrl};
                    YouTube.historyPing(s.tracking.playback,{cpn:s.cpn,cmt:s.ranges.length?s.ranges[0].start:0,len:s.info.duration},function(error){if(s!==current)return;DebugLog.record('history',{state:'playback',ok:!error});s.registered=!error;if(s.registered)report(s,false);});});}
            if(s.registered && s.played-s.lastReport>=30)report(s,false);
        },
        stop:function(){if(current){report(current,true);current=null;}}
    };
}(this));
