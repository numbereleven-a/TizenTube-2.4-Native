(function (root) {
    'use strict';
    function SponsorBlock(seek) { this.seek = seek; this.reset(); }
    SponsorBlock.prototype.reset = function () { this.segments = []; this.waiting = null; this.enabled = true; };
    SponsorBlock.prototype.load = function (id, generation, current, cb) {
        var self = this, categories = this.categories || ['sponsor','selfpromo','interaction'];
        if(!categories.length){self.segments=[];cb(null,0);return;}
        NativeNet.request('https://sponsor.ajay.app/api/skipSegments?videoID=' + encodeURIComponent(id) + '&categories=' + encodeURIComponent(JSON.stringify(categories)), {headers:{}}, function (error, body, status) {
            if (generation !== current()) return;
            if (status === 404) { cb(null, 0); return; }
            if (error) { cb('SponsorBlock недоступен'); return; }
            try {
                self.segments = JSON.parse(body).filter(function (s) {
                    return s.actionType === 'skip' && s.segment && s.segment.length === 2 &&
                        typeof s.segment[0] === 'number' && isFinite(s.segment[0]) && s.segment[0] >= 0 &&
                        typeof s.segment[1] === 'number' && isFinite(s.segment[1]) && s.segment[1] > s.segment[0];
                }).filter(function(s){return !s.category || categories.indexOf(s.category)>=0;}).map(function (s) { return {start:s.segment[0],end:s.segment[1],color:({sponsor:'#00d400',selfpromo:'#ffff00',interaction:'#cc00ff',intro:'#00ffff',outro:'#5555ff',preview:'#008fd6',filler:'#7300ff',music_offtopic:'#ff9900'})[s.category]}; });
                self.segments.sort(function (a,b) { return a.start-b.start; });
                // Merge overlaps so adjacent sponsorships need only one seek.
                var merged = [], i, last;
                for (i = 0; i < self.segments.length; i++) {
                    last = merged[merged.length-1];
                    if (last && self.segments[i].start <= last.end) last.end = Math.max(last.end, self.segments[i].end);
                    else merged.push(self.segments[i]);
                }
                self.segments = merged; cb(null, merged.length);
            } catch (e) { cb('Неверный ответ SponsorBlock'); }
        });
    };
    SponsorBlock.prototype.tick = function (position, duration, seeking) {
        if (!this.enabled || seeking) return;
        if (this.waiting !== null) {
            if (position < this.waiting - 0.75) return;
            this.waiting = null;
        }
        for (var i = 0; i < this.segments.length; i++) {
            var s = this.segments[i];
            if (position >= s.start && position < s.end - 0.15) {
                this.waiting = Math.min(s.end, duration - 0.1); this.seek(this.waiting); return;
            }
        }
    };
    root.SponsorBlock = SponsorBlock;
}(this));
