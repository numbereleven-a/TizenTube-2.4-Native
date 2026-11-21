#include "player.h"
#include "media/demuxer.h"
#include "media_redirect.h"
#include "ppapi/c/pp_errors.h"
#include "ppapi/cpp/core.h"
#include "ppapi/cpp/module.h"
#include "ppapi/cpp/var_array.h"
#include "ppapi/cpp/samsung/elementary_stream_listener_samsung.h"
#include <pthread.h>
#include <deque>
#include <cstring>
#include <algorithm>
#include <cstdio>
#include <exception>
#include <cmath>

using namespace omega::media;
namespace {
const size_t kRange = 512 * 1024;
const size_t kInputLimit = 1024 * 1024;
const size_t kQueueLimit = 8 * 1024 * 1024;
// Old TV implementations can complete a media operation synchronously.
// MayForce schedules that result without losing its completion callback.
std::string Number(uint64_t n) { char b[32]; snprintf(b, sizeof b, "%llu", (unsigned long long)n); return b; }
bool HeaderValue(const std::string& headers, const char* name, std::string& value) {
    size_t len = strlen(name), at = 0;
    while (at < headers.size()) {
        size_t end = headers.find("\r\n", at);
        size_t line_end = end == std::string::npos ? headers.size() : end;
        if (line_end - at >= len + 2 && headers.compare(at, len, name) == 0 && headers[at + len] == ':' && headers[at + len + 1] == ' ') {
            value = headers.substr(at + len + 2, line_end - at - len - 2);
            return true;
        }
        if (end == std::string::npos) break;
        at = end + 2;
    }
    return false;
}
bool ParseUnsigned(const std::string& s, uint64_t& value) {
    if (s.empty()) return false;
    uint64_t n = 0;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
        uint64_t d = static_cast<uint64_t>(c - '0');
        if (n > (UINT64_MAX - d) / 10) return false;
        n = n * 10 + d;
    }
    value = n;
    return true;
}
struct MutexLock {
    pthread_mutex_t* mutex;
    bool held = false;
    explicit MutexLock(pthread_mutex_t* value) : mutex(value) { lock(); }
    ~MutexLock() { if (held) unlock(); }
    void lock() { pthread_mutex_lock(mutex); held = true; }
    void unlock() { held = false; pthread_mutex_unlock(mutex); }
};
}

struct NativePlayer::Track : public pp::ElementaryStreamListener_Samsung {
    NativePlayer* owner;
    int index, request = 0, status = 0, retries = 0, http_retries = 0, server_retries = 0;
    std::string url, host, path, base_host, base_path, error, redirect, tls;
    int redirects = 0;
    uint64_t offset = 0, length = 0, range_received = 0, segment_received = 0, segment_expected = 0;
    bool busy = false, complete = false, ended = false, configured = false, initializing = false, range_valid = false, retry_fresh = false, reused = false, header_range = false;
    bool append_pending = false, appending = false, need = true, header = false, cancelled = false, live = false, head_resolved = false, redirected = false;
    int64_t seq = -1, probed_head = -1;
    double retry_at = 0;
    double last_data_at = 0;
    int fps = 30;
    pthread_mutex_t mutex;
    pthread_cond_t changed;
    pthread_t thread;
    bool thread_started = false;
    std::deque<std::vector<uint8_t>> input;
    size_t input_at = 0, input_bytes = 0, queued_bytes = 0;
    std::deque<Sample> queue;
    Sample pending;
    TrackInfo info;
    std::vector<Segment> segments;
    std::unique_ptr<Demuxer> demuxer;
    std::unique_ptr<pp::ElementaryStream_Samsung> stream;
    double submitted = 0;
    int packets = 0;
    int seek_generation = 0, worker_generation = 0;
    int pending_generation = 0;
    bool seek_pending = false;
    int64_t discard_before_ms = 0;
    Segment seek_segment{};
    Track(NativePlayer* p, int i) : owner(p), index(i) { pthread_mutex_init(&mutex, 0); pthread_cond_init(&changed, 0); }
    ~Track() {
        pthread_mutex_lock(&mutex); cancelled = true; pthread_cond_broadcast(&changed); pthread_mutex_unlock(&mutex);
        if (thread_started) pthread_join(thread, 0);
        pthread_cond_destroy(&changed); pthread_mutex_destroy(&mutex);
    }
    void OnNeedData(int32_t) override { need = true; }
    void OnEnoughData() override { need = false; }
    void OnSeekData(PP_TimeTicks time) override {
        // AttachDataSource requests the initial position as well. No packets
        // have been consumed yet, so the existing input is already at zero.
        if (live || (time == 0 && packets == 0 && seek_generation == 0 && !owner->seeking_)) { need = true; return; }
        pthread_mutex_lock(&mutex);
        if (segments.empty()) { error = "Stream has no seek index"; pthread_cond_broadcast(&changed); pthread_mutex_unlock(&mutex); return; }
        Segment s = segments.front();
        for (const auto& candidate : segments) { if (candidate.start_ms > time * 1000) break; s = candidate; }
        seek_segment = s; ++seek_generation; seek_pending = true;
        discard_before_ms = static_cast<int64_t>(time * 1000);
        input.clear(); input_at = input_bytes = 0; queue.clear(); queued_bytes = 0;
        ended = complete = false; error.clear();
        pthread_cond_broadcast(&changed); pthread_mutex_unlock(&mutex);
        need = true;
    }
    size_t Read(void* dst, size_t size) {
        size_t read = 0;
        pthread_mutex_lock(&mutex);
        while (read < size) {
            while (input.empty() && !cancelled && !complete && error.empty() && seek_generation == worker_generation)
                pthread_cond_wait(&changed, &mutex);
            if (cancelled || !error.empty() || seek_generation != worker_generation || input.empty()) break;
            size_t n = std::min(size - read, input.front().size() - input_at);
            memcpy(static_cast<char*>(dst) + read, input.front().data() + input_at, n);
            read += n; input_at += n; input_bytes -= n;
            if (input_at == input.front().size()) { input.pop_front(); input_at = 0; }
        }
        pthread_mutex_unlock(&mutex); return read;
    }
    static void* Run(void* p) {
        Track* t = static_cast<Track*>(p);
        try { t->Decode(); }
        catch (const std::exception&) {
            MutexLock lock(&t->mutex); t->error = "Demux failed"; pthread_cond_broadcast(&t->changed);
        }
        return 0;
    }
    void Decode() {
        auto read = [this](void* p, size_t n) { return Read(p, n); };
        demuxer = open_demuxer(read);
        bool ok = demuxer->read_header();
        MutexLock lock(&mutex);
        if (ok) { info = demuxer->track(); segments = demuxer->segments(); header = true; }
        else if (!cancelled && error.empty()) error = demuxer->error().empty() ? "Cannot read media header" : demuxer->error();
        lock.unlock();
        if (!ok) return;
        while (true) {
            lock.lock();
            while (!cancelled && error.empty() && seek_generation == worker_generation &&
                   (queued_bytes >= kQueueLimit || (!queue.empty() && queue.back().pts_ms - queue.front().pts_ms >= 20000)))
                pthread_cond_wait(&changed, &mutex);
            bool stop = cancelled || !error.empty();
            if (seek_generation != worker_generation) {
                worker_generation = seek_generation;
                demuxer = resume_demuxer(read, info, seek_segment);
            }
            int generation = worker_generation;
            lock.unlock();
            if (stop) return;
            std::deque<Sample> samples;
            ok = demuxer->read_fragment(samples);
            if (live && index == 0 && owner->live_base_ms_.load() < 0) {
                if (ok && !samples.empty()) {
                    int64_t base = samples.front().dts_ms;
                    for (const auto& s : samples) base = std::min(base, std::min(s.pts_ms, s.dts_ms));
                    owner->live_base_ms_.store(base);
                } else if (!ok) {
                    owner->live_base_ms_.store(0);
                }
                if (owner->live_base_ms_.load() >= 0 && owner->tracks_[1]) {
                    MutexLock audio_lock(&owner->tracks_[1]->mutex);
                    pthread_cond_broadcast(&owner->tracks_[1]->changed);
                }
            }
            lock.lock();
            if (live && ok && !samples.empty() && index == 1) {
                while (owner->live_base_ms_.load() < 0 && !cancelled && error.empty() && generation == seek_generation)
                    pthread_cond_wait(&changed, &mutex);
            }
            if (generation == seek_generation && !cancelled && error.empty()) {
                if (!ok) {
                    if (!demuxer->error().empty() && error.empty()) error = demuxer->error();
                    ended = true;
                    while (!cancelled && error.empty() && generation == seek_generation)
                        pthread_cond_wait(&changed, &mutex);
                } else {
                    int64_t base = live ? std::max<int64_t>(0, owner->live_base_ms_.load()) : 0;
                    for (auto& sample : samples) {
                        if (live) {
                            sample.pts_ms -= base;
                            sample.dts_ms -= base;
                        }
                        // AAC frames are independent. Video still starts at the
                        // preceding keyframe so inter-frame decoding stays valid.
                        if (index == 1 && sample.pts_ms < discard_before_ms) continue;
                        if (live) {
                            sample.pts_ms = std::max<int64_t>(0, sample.pts_ms);
                            sample.dts_ms = std::max<int64_t>(0, sample.dts_ms);
                        }
                        queued_bytes += sample.data.size(); queue.push_back(std::move(sample));
                    }
                }
            }
            lock.unlock();
        }
    }
};

NativePlayer::NativePlayer(pp::Instance* instance, Sender send)
    : instance_(instance), send_(send), callbacks_(this), live_base_ms_(-1) {}
NativePlayer::~NativePlayer() { Stop(); }
void NativePlayer::Status(const char* state, int code) {
    pp::VarDictionary m; m.Set("type", "player"); m.Set("state", state); m.Set("code", code);
    m.Set("ready", started_ && active_); m.Set("session", session_);
    m.Set("position", position_); m.Set("duration", duration_);
    if (tracks_[0] && tracks_[1]) {
        m.Set("videoPackets", tracks_[0]->packets); m.Set("audioPackets", tracks_[1]->packets);
        m.Set("videoAhead", tracks_[0]->submitted - position_); m.Set("audioAhead", tracks_[1]->submitted - position_);
        for (int i = 0; i < 2; ++i) {
            Track& t = *tracks_[i]; pthread_mutex_lock(&t.mutex);
            if (i == 0) { m.Set("width", static_cast<int>(t.info.width)); m.Set("height", static_cast<int>(t.info.height)); m.Set("fps", t.fps); m.Set("codec", codec_name(t.info.codec)); }
            pp::VarDictionary d; d.Set("queued", static_cast<int>(t.queue.size())); d.Set("inputBytes", static_cast<int>(t.input_bytes));
            d.Set("need", t.need); d.Set("pending", t.append_pending); d.Set("ended", t.ended); d.Set("offset", static_cast<double>(t.offset)); d.Set("seeks", t.seek_generation);
            if (t.live) d.Set("seq", static_cast<double>(t.seq));
            d.Set("http", t.status); d.Set("redirects", t.redirects); d.Set("retries", t.retries);
            d.Set("httpRetries",t.http_retries);d.Set("serverRetries",t.server_retries);d.Set("reused",t.reused);
            d.Set("tls", t.tls);
            if (!t.error.empty()) d.Set("reason", t.error);
            pthread_mutex_unlock(&t.mutex); m.Set(i == 0 ? "video" : "audio", d);
        }
    }
    instance_->PostMessage(m);
}
void NativePlayer::Stop() {
    active_ = false; callbacks_.CancelAll();
    for (auto& t : tracks_) if (t) {
        int id = t->request; t->request = 0;
        if (id) { pp::VarDictionary m; m.Set("type", "abort"); m.Set("id", id); send_(m); }
        pthread_mutex_lock(&t->mutex); t->cancelled = true; pthread_cond_broadcast(&t->changed); pthread_mutex_unlock(&t->mutex);
    }
    pp::MediaEventsListener_Samsung::AttachTo(nullptr);
    pp::BufferingListener_Samsung::AttachTo(nullptr);
    player_ = pp::MediaPlayer_Samsung();
    source_.reset();
    for (auto& t : tracks_) t.reset();
    attached_ = started_ = paused_ = eos_ = seeking_ = live_ = false; initialized_ = 0; live_base_ms_.store(-1);
}
void NativePlayer::Command(const pp::VarDictionary& m) {
    std::string command = m.Get("command").AsString();
#ifdef TTL_TEST_HTTP_FAILURES
    if(command=="test-http-error"){
        test_http_track_=m.Get("track").AsInt()==0?0:1;
        test_http_count_=std::max(0,std::min(10,m.Get("count").AsInt()));
        test_http_status_=m.Get("status").AsInt();return;
    }
#endif
    if (command == "open") {
        pending_open_ = m; wants_open_ = true;
        if (closing_) return;
        if (player_.is_null()) { wants_open_ = false; Open(m); } else Close();
        return;
    }
    if (command == "stop") { wants_open_ = false; if (!closing_) Close(); return; }
    if (!active_) return;
    if (m.Get("session").is_int() && m.Get("session").AsInt() != session_) return;
    if (command == "pause") { paused_ = true; if (started_) { auto cb = callbacks_.NewCallback(&NativePlayer::Operation); cb.MayForce(player_.Pause(cb)); } Status("paused"); }
    if (command == "resume") { paused_ = false; if (started_) { auto cb = callbacks_.NewCallback(&NativePlayer::Operation); cb.MayForce(player_.Play(cb)); } Status(started_ ? "playing" : "buffering"); }
    if (command == "seek") {
        double target = m.Get("position").AsDouble();
        if (live_ || !std::isfinite(target) || target < 0 || target >= duration_) { Status("seek-complete"); return; }
        position_ = target; seeking_ = true;
        auto cb = callbacks_.NewCallback(&NativePlayer::SeekDone); cb.MayForce(player_.Seek(target, cb)); Status("seeking");
    }
}
void NativePlayer::Close() {
    if (player_.is_null()) { Stop(); Status("stopped"); return; }
    closing_ = true; active_ = false; callbacks_.CancelAll();
    for (auto& t : tracks_) if (t) {
        int id = t->request; t->request = 0;
        if (id) { pp::VarDictionary m; m.Set("type", "abort"); m.Set("id", id); send_(m); }
        pthread_mutex_lock(&t->mutex); t->cancelled = true; pthread_cond_broadcast(&t->changed); pthread_mutex_unlock(&t->mutex);
    }
    auto cb = callbacks_.NewCallback(&NativePlayer::Closed); cb.MayForce(player_.Stop(cb));
}
void NativePlayer::Closed(int32_t) {
    Stop(); closing_ = false; Status("stopped");
    if (wants_open_) { pp::VarDictionary m = pending_open_; pending_open_ = pp::VarDictionary(); wants_open_ = false; Open(m); }
}
void NativePlayer::Open(const pp::VarDictionary& m) {
    Stop(); session_ = m.Get("session").is_int() ? m.Get("session").AsInt() : 0; duration_ = m.Get("duration").AsDouble(); position_ = 0;
    live_ = m.Get("live").is_bool() && m.Get("live").AsBool(); live_base_ms_.store(-1);
    user_agent_ = m.Get("userAgent").AsString(); mode_ = m.Get("mode").is_string() ? m.Get("mode").AsString() : "auto";
    player_ = pp::MediaPlayer_Samsung(instance_); source_.reset(new pp::ESDataSource_Samsung(instance_));
    if (player_.is_null() || source_->is_null()) { Status("unavailable", PP_ERROR_NOINTERFACE); Stop(); return; }
    pp::MediaEventsListener_Samsung::AttachTo(&player_);
    pp::BufferingListener_Samsung::AttachTo(&player_);
    if (!m.Get("tracks").is_array()) { Status("invalid-url"); Stop(); return; }
    pp::VarArray list(m.Get("tracks"));
    if (list.GetLength() < 2) { Status("invalid-url"); Stop(); return; }
    for (int i = 0; i < 2; ++i) {
        pp::VarDictionary format(list.Get(i));
        std::unique_ptr<Track> t(new Track(this, i));
        t->url = format.Get("url").AsString();
        // YouTube signed URLs are HTTPS. Parse the authority without changing
        // the signed query; the existing TLS transport validates host names.
        if (t->url.compare(0, 8, "https://") != 0) { Status("invalid-url"); Stop(); return; }
        size_t slash = t->url.find('/', 8);
        if (slash == std::string::npos || slash == 8) { Status("invalid-url"); Stop(); return; }
        t->host = t->base_host = t->url.substr(8, slash - 8); t->path = t->base_path = t->url.substr(slash);
        t->length = static_cast<uint64_t>(format.Get("length").AsDouble());
        t->fps = format.Get("fps").is_int() ? format.Get("fps").AsInt() : 30;
        t->live = live_;
        if (!t->length && !live_) { Status("unsupported-live"); Stop(); return; }
        tracks_[i] = std::move(t);
    }
    active_ = true;
    for (auto& t : tracks_) {
        int r = pthread_create(&t->thread, 0, Track::Run, t.get());
        if (r) { Status("worker-error", r); Stop(); return; }
        t->thread_started = true;
    }
    Status("loading"); Pump(0);
}
void NativePlayer::Fetch(Track& t) {
    t.redirect.clear();
    t.request = next_id_--; t.busy = true; t.status = 0; t.range_received = 0; t.range_valid = false; t.segment_expected = 0;
    t.last_data_at = pp::Module::Get()->core()->GetTimeTicks();
    pp::VarDictionary m; m.Set("type", "request"); m.Set("id", t.request);
    m.Set("port", 443); m.Set("method", "GET"); m.Set("mode", mode_);
    std::string headers = "User-Agent: " + user_agent_ + "\r\n";
    if (!t.live) {
        uint64_t end = std::min(t.length, t.offset + kRange) - 1;
        m.Set("host", t.host);
        std::string range = Number(t.offset) + "-" + Number(end);
        m.Set("path", MediaRangePath(t.path, t.header_range ? "" : range));
        if (t.header_range) headers += "Range: bytes=" + range + "\r\n";
    } else if (!t.head_resolved) {
        if (!t.redirected) { t.host = t.base_host; t.path = t.base_path; }
        m.Set("host", t.host);
        m.Set("path", t.path);
        headers += "Range: bytes=0-0\r\n";
    } else {
        if (!t.redirected) { t.host = t.base_host; t.path = MediaSequencePath(t.base_path, static_cast<uint64_t>(t.seq)); }
        m.Set("host", t.host);
        m.Set("path", t.path);
        if (t.segment_received > 0) headers += "Range: bytes=" + Number(t.segment_received) + "-\r\n";
    }
    m.Set("headers", headers);
    if(t.retry_fresh){m.Set("freshConnection",true);t.retry_fresh=false;}
#ifdef TTL_TEST_HTTP_FAILURES
    if(t.index==test_http_track_&&test_http_count_>0){
        --test_http_count_;
        pp::Module::Get()->core()->CallOnMainThread(0,callbacks_.NewCallback(&NativePlayer::TestHttpResponse,t.index,t.request));return;
    }
#endif
    send_(m);
}
#ifdef TTL_TEST_HTTP_FAILURES
void NativePlayer::TestHttpResponse(int32_t,int index,int id){
    if(!active_||!tracks_[index]||tracks_[index]->request!=id)return;
    pp::VarDictionary m;m.Set("id",id);m.Set("type","headers");m.Set("status",test_http_status_);m.Set("headers",std::string("content-length: 24\r\n"));Network(m);
    const char body[]="<html>unavailable</html>";Bytes(id,body,sizeof(body)-1);
    m.Set("type","done");Network(m);
}
#endif
bool NativePlayer::Bytes(int id, const char* data, size_t size) {
    if (id >= 0) return false;
    for (auto& t : tracks_) if (t && t->request == id) {
        if (t->seek_pending) return true;
        if (!t->range_valid) return true;
        pthread_mutex_lock(&t->mutex);
        uint64_t limit = t->live ? (t->segment_expected ? (t->segment_expected - t->segment_received) : 32 * 1024 * 1024)
                                 : std::min<uint64_t>(kRange, t->length - t->offset);
        if (size > limit - t->range_received) t->error = "Media range exceeded requested size";
        else {
            t->input.emplace_back(data, data + size); t->input_bytes += size; t->range_received += size;
            t->last_data_at = pp::Module::Get()->core()->GetTimeTicks();
        }
        pthread_cond_broadcast(&t->changed); pthread_mutex_unlock(&t->mutex);
    }
    return true;
}
bool NativePlayer::Network(const pp::VarDictionary& m) {
    if (!m.Get("id").is_int() || m.Get("id").AsInt() >= 0) return false;
    for (auto& t : tracks_) if (t && t->request == m.Get("id").AsInt()) {
        if (t->seek_pending) return true;
        std::string type = m.Get("type").AsString();
        if(type == "tls"){t->tls = m.Get("tls").AsString();t->reused=m.Get("reused").AsBool();}
        bool reconnecting = false;
        int abort_id = 0;
        int64_t sync_seq = -1;
        pthread_mutex_lock(&t->mutex);
        if (type == "headers") {
            t->status = m.Get("status").AsInt();
            std::string headers = m.Get("headers").AsString();
            if(t->status==503&&t->server_retries<3){
                // Reject the error body; the same range/sequence is retried below.
            } else if (t->status == 301 || t->status == 302 || t->status == 303 || t->status == 307 || t->status == 308) {
                std::string host, path;
                HeaderValue(headers, "location", t->redirect);
                if (++t->redirects > 5 || !MediaRedirect(t->redirect, host, path)) t->error = "Invalid media redirect";
            } else if (t->live && !t->head_resolved) {
                if (t->status == 403 && t->http_retries == 0) {
                    // Discard this response and retry on a fresh connection.
                } else if (t->status == 200 || t->status == 206) {
                    std::string head_str; uint64_t head_val = 0;
                    if (!HeaderValue(headers, "x-head-seqnum", head_str) || !ParseUnsigned(head_str, head_val)) {
                        t->error = "Missing live head sequence";
                    } else {
                        t->probed_head = static_cast<int64_t>(head_val);
                        std::string len_str; uint64_t clen = 0;
                        bool small_probe = HeaderValue(headers, "content-length", len_str) && ParseUnsigned(len_str, clen) && clen <= 65536;
                        if (!small_probe) {
                            sync_seq = std::max<int64_t>(0, t->probed_head - 3);
                            t->seq = sync_seq; t->head_resolved = true;
                            t->redirected = false; t->retries = 0; t->http_retries = 0; t->server_retries = 0; t->redirects = 0;
                            t->host = t->base_host; t->path = t->base_path;
                            abort_id = t->request; t->request = 0; t->busy = false;
                        }
                    }
                } else {
                    t->error = "Media HTTP " + Number(t->status);
                }
            } else if (t->live && t->head_resolved) {
                if (t->status == 403 && t->http_retries == 0) {
                    // Retry once on a fresh connection.
                } else if (t->status == 404 || t->status == 204) {
                    // Live edge wait for next produced segment.
                } else if ((t->status == 200 && t->segment_received == 0) || (t->status == 206 && t->segment_received > 0)) {
                    std::string len_str; uint64_t clen = 0;
                    if (HeaderValue(headers, "content-length", len_str)) {
                        if (!ParseUnsigned(len_str, clen) || clen > 32 * 1024 * 1024 - t->segment_received) t->error = "Invalid media chunk length";
                        else if (!t->segment_expected) t->segment_expected = t->segment_received + clen;
                        else if (t->segment_received + clen != t->segment_expected) t->error = "Invalid media chunk length";
                    }
                    if (t->error.empty()) t->range_valid = true;
                } else {
                    t->error = "Media HTTP " + Number(t->status);
                }
            } else if (t->status == 200) {
                // YouTube's range query returns 200 with the requested chunk,
                // unlike a generic HTTP Range request. Never accept a full file.
                size_t at = headers.find("content-length: "); unsigned long long length = 0;
                if (at == std::string::npos || sscanf(headers.c_str() + at + 16, "%llu", &length) != 1 || length != std::min<uint64_t>(kRange, t->length - t->offset)) t->error = "Invalid media chunk length";
                else t->range_valid = true;
            }
            else if(t->status==403 && t->http_retries==0){/* Discard this response and retry the same range once on a new connection. */}
            else if (t->status != 206) t->error = "Media HTTP " + Number(t->status);
            else {
                size_t at = headers.find("content-range: bytes ");
                unsigned long long start = 0, end = 0, length = 0;
                if (at == std::string::npos || sscanf(headers.c_str() + at + 21, "%llu-%llu/%llu", &start, &end, &length) != 3 ||
                    start != t->offset || end < start || end >= t->length || end - start >= kRange || length != t->length)
                    t->error = "Invalid media byte range";
                else t->range_valid = true;
            }
        }
        if (type == "done" || type == "error") {
            t->busy = false; t->request = 0;
            if (!t->live || t->head_resolved) t->offset += t->range_received;
            if(type=="done"&&t->range_valid&&t->range_received>0&&t->error.empty())t->server_retries=0;
            if(t->status==503&&t->server_retries<3&&t->range_received==0&&t->error.empty()){
                t->retry_at=pp::Module::Get()->core()->GetTimeTicks()+0.5*(1<<t->server_retries);
                ++t->server_retries;if(!t->live){t->header_range=true;t->host=t->base_host;t->path=t->base_path;}t->retry_fresh=true;t->redirected=false;t->redirects=0;reconnecting=true;
            } else if (t->live && !t->head_resolved) {
                if (t->status == 403 && t->http_retries == 0) {
                    ++t->http_retries; t->retry_fresh = true; t->redirected = false;
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + 0.25; reconnecting = true;
                } else if (type == "error") {
                    t->redirected = false;
                    if (++t->retries > 5) t->error = "Media network failed";
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + 1.0;
                } else if (!t->redirect.empty() && t->error.empty()) {
                    MediaRedirect(t->redirect, t->host, t->path); t->url = t->redirect; t->redirect.clear(); t->redirected = true; t->retries = 0;
                } else if (t->error.empty() && t->probed_head >= 0) {
                    sync_seq = std::max<int64_t>(0, t->probed_head - 3);
                    t->seq = sync_seq; t->head_resolved = true;
                    t->redirected = false; t->retries = 0; t->http_retries = 0; t->server_retries = 0; t->redirects = 0;
                } else if (t->error.empty()) {
                    t->error = "Missing live head sequence";
                }
            } else if (t->live) {
                t->segment_received += t->range_received;
                if (t->status == 403 && t->http_retries == 0 && t->range_received == 0) {
                    ++t->http_retries; t->retry_fresh = true; t->redirected = false;
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + 0.25; reconnecting = true;
                } else if (type == "error") {
                    t->redirected = false;
                    if (++t->retries > 5) t->error = "Media network failed";
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + 1.0;
                } else if (!t->redirect.empty() && t->error.empty()) {
                    MediaRedirect(t->redirect, t->host, t->path); t->url = t->redirect; t->redirect.clear(); t->redirected = true; t->retries = 0;
                } else if (t->status == 404 || t->status == 204 || (t->error.empty() && t->range_received == 0 && t->segment_received == 0)) {
                    t->redirected = false; t->redirects = 0;
                    if (++t->retries > 10) t->error = "Media HTTP " + Number(t->status ? t->status : 204);
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + 1.0;
                } else if (t->error.empty() && t->segment_expected && t->segment_received < t->segment_expected) {
                    t->redirected = false;
                    if (++t->retries > 5) t->error = "Media network failed";
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + 0.5;
                } else {
                    ++t->seq; t->segment_received = 0; t->redirected = false; t->retries = 0; t->http_retries = 0; t->redirects = 0;
                }
            } else {
                if(t->status==403 && t->http_retries==0 && t->range_received==0){
                    ++t->http_retries;t->retry_fresh=true;t->retry_at=pp::Module::Get()->core()->GetTimeTicks()+0.25;reconnecting=true;
                }else if (type == "error") {
                    int limit = (!t->header && t->offset == 0) ? 2 : 5;
                    t->host = t->base_host; t->path = t->base_path; t->redirects = 0;
                    t->header_range = t->retries >= 1 ? !t->header_range : true;
                    t->retry_fresh = true;
                    if (++t->retries > limit) t->error = "Media network failed";
                    double delay = t->retries == 1 ? 0.25 : t->retries == 2 ? 0.5 : std::min(4.0, static_cast<double>(t->retries - 2));
                    t->retry_at = pp::Module::Get()->core()->GetTimeTicks() + delay;
                } else if (!t->redirect.empty() && t->error.empty()) {
                    MediaRedirect(t->redirect, t->host, t->path); t->url = t->redirect; t->redirect.clear();
                } else { t->retries = 0; if (!t->range_received) {if(t->error.empty())t->error = "Empty media range";} else t->redirects = 0; }
                if (t->offset >= t->length) t->complete = true;
            }
        }
        pthread_cond_broadcast(&t->changed); pthread_mutex_unlock(&t->mutex);
        if (sync_seq >= 0 && tracks_[1]) {
            pthread_mutex_lock(&tracks_[1]->mutex);
            tracks_[1]->seq = sync_seq;
            tracks_[1]->head_resolved = true;
            pthread_cond_broadcast(&tracks_[1]->changed);
            pthread_mutex_unlock(&tracks_[1]->mutex);
        }
        if (abort_id) { pp::VarDictionary abort_msg; abort_msg.Set("type", "abort"); abort_msg.Set("id", abort_id); send_(abort_msg); }
        if(reconnecting)Status("reconnecting");
    }
    return true;
}
void NativePlayer::Pump(int32_t) {
    if (!active_) return;
    bool drained = true;
    for (int i = 0; i < 2; ++i) {
        Track& t = *tracks_[i];
        pthread_mutex_lock(&t.mutex);
        bool failed = !t.error.empty();
        if (failed) {
            pthread_mutex_unlock(&t.mutex);
            Status(i == 0 ? "video-error" : "audio-error", t.status); Stop(); return;
        }
        if (t.seek_pending) {
            int id = t.request; t.request = 0; t.busy = false;
            t.offset = t.seek_segment.offset; t.seek_pending = false; t.submitted = t.seek_segment.start_ms / 1000.0;
            t.redirect.clear(); t.redirects = 0; t.server_retries = 0;
            pthread_mutex_unlock(&t.mutex);
            if (id) { pp::VarDictionary m; m.Set("type", "abort"); m.Set("id", id); send_(m); }
            pthread_mutex_lock(&t.mutex);
        }
        bool fetch = !t.busy && !t.complete && (!t.live || t.head_resolved || i == 0) && t.input_bytes < kInputLimit && pp::Module::Get()->core()->GetTimeTicks() >= t.retry_at;
        double stall_limit = t.live ? 12.0 : std::min(15.0, 6.0 + t.retries * 3.0);
        int stalled = t.busy && pp::Module::Get()->core()->GetTimeTicks() - t.last_data_at > stall_limit ? t.request : 0;
        bool config = t.header && !t.configured && !t.initializing;
        if (config) t.initializing = true;
        drained = drained && t.ended && t.queue.empty() && !t.append_pending;
        pthread_mutex_unlock(&t.mutex);
        if (stalled) { pp::VarDictionary m; m.Set("type", "abort"); m.Set("id", stalled); send_(m); }
        if (fetch) Fetch(t);
        if (config) Configure(t);
        AppendNext(i);
    }
    if (attached_ && drained && !eos_) { eos_ = true; auto cb = callbacks_.NewCallback(&NativePlayer::Operation); cb.MayForce(source_->SetEndOfStream(cb)); }
    if (!started_ && pp::Module::Get()->core()->GetTimeTicks() >= next_report_) {
        next_report_ = pp::Module::Get()->core()->GetTimeTicks() + 2; Status(attached_ ? "buffering" : "loading");
    }
    pp::Module::Get()->core()->CallOnMainThread(10, callbacks_.NewCallback(&NativePlayer::Pump));
}
void NativePlayer::AppendNext(int index) {
    if (!active_ || !attached_ || !tracks_[index]) return;
    Track& t = *tracks_[index];
    if (t.appending) return;
    t.appending = true;
    for (int burst = 0; burst < 16 && active_ && attached_ && tracks_[index]; ++burst) {
        pthread_mutex_lock(&t.mutex);
        bool can_append = t.configured && t.need && !t.append_pending && !t.queue.empty() &&
                          t.queue.front().pts_ms <= (position_ + 15) * 1000;
        if (!can_append) {
            pthread_mutex_unlock(&t.mutex);
            break;
        }
        if (index == 0 && !live_ && started_ && !seeking_ && t.queue.front().pts_ms < (position_ - 1.5) * 1000) {
            size_t best_key = 0;
            bool found_key = false;
            int64_t target_ms = static_cast<int64_t>((position_ - 0.25) * 1000);
            for (size_t k = 0; k < t.queue.size(); ++k) {
                if (t.queue[k].key) {
                    if (t.queue[k].pts_ms <= target_ms) { best_key = k; found_key = true; }
                    else if (!found_key) { best_key = k; found_key = true; break; }
                    else break;
                }
            }
            if (found_key && best_key > 0) {
                for (size_t k = 0; k < best_key; ++k) {
                    t.queued_bytes -= t.queue.front().data.size();
                    t.queue.pop_front();
                }
            }
        }
        t.pending = std::move(t.queue.front()); t.queue.pop_front(); t.queued_bytes -= t.pending.data.size();
        t.append_pending = true; t.pending_generation = t.seek_generation; pthread_cond_broadcast(&t.changed);
        pthread_mutex_unlock(&t.mutex);

        PP_ESPacket p{}; p.pts = t.pending.pts_ms / 1000.0; p.dts = t.pending.dts_ms / 1000.0;
        p.duration = t.pending.duration_ms / 1000.0; p.is_key_frame = PP_FromBool(t.pending.key);
        p.size = static_cast<uint32_t>(t.pending.data.size()); p.buffer = t.pending.data.data();
        auto cb = callbacks_.NewCallback(&NativePlayer::Appended, index);
        int32_t res = t.stream->AppendPacket(p, cb);
        if (res == PP_OK_COMPLETIONPENDING) break;
        cb.MayForce(res);
    }
    if (active_ && tracks_[index]) tracks_[index]->appending = false;
}
void NativePlayer::Configure(Track& t) {
    if (t.index == 0) { auto cb = callbacks_.NewCallbackWithOutput(&NativePlayer::VideoAdded); cb.MayForce(source_->AddStream(cb, &t)); }
    else { auto cb = callbacks_.NewCallbackWithOutput(&NativePlayer::AudioAdded); cb.MayForce(source_->AddStream(cb, &t)); }
}
void NativePlayer::VideoAdded(int32_t code, pp::VideoElementaryStream_Samsung stream) {
    if (code != PP_OK) { Status("video-create-error", code); Stop(); return; }
    Track& t = *tracks_[0];
    if (t.info.codec != Codec::H264 && t.info.codec != Codec::VP9) { Status("unsupported-codec"); Stop(); return; }
    stream.SetVideoCodecType(t.info.codec == Codec::H264 ? PP_VIDEOCODEC_TYPE_SAMSUNG_H264 : PP_VIDEOCODEC_TYPE_SAMSUNG_VP9);
    stream.SetVideoCodecProfile(t.info.codec == Codec::VP9 ? PP_VIDEOCODEC_PROFILE_SAMSUNG_VP9_MAIN :
        t.info.codec_data.size() > 1 && t.info.codec_data[1] == 66 ? PP_VIDEOCODEC_PROFILE_SAMSUNG_H264_BASELINE :
        t.info.codec_data.size() > 1 && t.info.codec_data[1] == 77 ? PP_VIDEOCODEC_PROFILE_SAMSUNG_H264_MAIN : PP_VIDEOCODEC_PROFILE_SAMSUNG_H264_HIGH);
    PP_Size size = {static_cast<int32_t>(t.info.width), static_cast<int32_t>(t.info.height)};
    stream.SetVideoFrameSize(size); stream.SetFrameRate(t.fps, 1);
    stream.SetVideoFrameFormat(PP_VIDEOFRAME_FORMAT_SAMSUNG_I420);
    if (!t.info.codec_data.empty()) stream.SetCodecExtraData(t.info.codec_data.size(), t.info.codec_data.data());
    t.stream.reset(new pp::VideoElementaryStream_Samsung(stream));
    auto cb = callbacks_.NewCallback(&NativePlayer::Initialized); cb.MayForce(stream.InitializeDone(cb));
}
void NativePlayer::AudioAdded(int32_t code, pp::AudioElementaryStream_Samsung stream) {
    if (code != PP_OK) { Status("audio-create-error", code); Stop(); return; }
    Track& t = *tracks_[1];
    if (t.info.codec != Codec::AAC || (t.info.channels != 1 && t.info.channels != 2)) { Status("unsupported-audio"); Stop(); return; }
    stream.SetAudioCodecType(PP_AUDIOCODEC_TYPE_SAMSUNG_AAC); stream.SetAudioCodecProfile(PP_AUDIOCODEC_PROFILE_SAMSUNG_AAC_LOW);
    stream.SetChannelLayout(t.info.channels == 1 ? PP_CHANNEL_LAYOUT_SAMSUNG_MONO : PP_CHANNEL_LAYOUT_SAMSUNG_STEREO);
    stream.SetSamplesPerSecond(t.info.sample_rate); stream.SetBitsPerChannel(16); stream.SetSampleFormat(PP_SAMPLEFORMAT_SAMSUNG_S16);
    stream.SetCodecExtraData(t.info.codec_data.size(), t.info.codec_data.data());
    t.stream.reset(new pp::AudioElementaryStream_Samsung(stream));
    auto cb = callbacks_.NewCallback(&NativePlayer::Initialized); cb.MayForce(stream.InitializeDone(cb));
}
void NativePlayer::Initialized(int32_t code) {
    if (code != PP_OK) { Status("initialize-error", code); Stop(); return; }
    if (++initialized_ != 2) return;
    tracks_[0]->configured = tracks_[1]->configured = true;
    PP_Rect rect = {{0, 0}, {1920, 1080}};
    auto display = callbacks_.NewCallback(&NativePlayer::Operation); display.MayForce(player_.SetDisplayRect(rect, display));
    if (!live_ && duration_ > 0) {
        auto duration = callbacks_.NewCallback(&NativePlayer::Operation); duration.MayForce(source_->SetDuration(duration_, duration));
    }
    auto attach = callbacks_.NewCallback(&NativePlayer::Attached); attach.MayForce(player_.AttachDataSource(*source_, attach));
}
void NativePlayer::Attached(int32_t code) {
    if (code != PP_OK) { Status("attach-error", code); Stop(); return; }
    attached_ = true; Status("buffering");
}
void NativePlayer::Appended(int32_t code, int index) {
    if (!active_) return;
    Track& t = *tracks_[index];
    if (t.pending_generation != t.seek_generation) { t.pending.data.clear(); t.append_pending = false; return; }
    if (code == PP_ERROR_NOQUOTA) {
        pthread_mutex_lock(&t.mutex); t.queued_bytes += t.pending.data.size(); t.queue.push_front(std::move(t.pending)); pthread_mutex_unlock(&t.mutex);
        t.need = false;
    } else if (code != PP_OK) { Status(index == 0 ? "video-append-error" : "audio-append-error", code); Stop(); return; }
    else { t.submitted = t.pending.pts_ms / 1000.0; ++t.packets; t.pending.data.clear(); }
    t.append_pending = false;
    if (code == PP_OK && t.need && !t.appending) AppendNext(index);
}
void NativePlayer::Operation(int32_t code) { if (code != PP_OK) { Status("operation-error", code); Stop(); } }
void NativePlayer::SeekDone(int32_t code) { if (code != PP_OK) Operation(code); else { eos_ = false; seeking_ = false; Status("seek-complete"); } }
void NativePlayer::OnTimeUpdate(PP_TimeTicks time) { if (!active_ || seeking_) return; position_ = time; Status(paused_ ? "paused" : "playing"); }
void NativePlayer::OnEnded() { if (active_) Status("ended"); }
void NativePlayer::OnError(PP_MediaPlayerError code) { if (!active_) return; Status("decoder-error", code); Stop(); }
void NativePlayer::OnBufferingStart() { if (active_) Status("buffering"); }
void NativePlayer::OnBufferingProgress(uint32_t) {}
void NativePlayer::OnBufferingComplete() {
    if (!active_ || started_) return;
    started_ = true;
    if (paused_) { Status("paused"); return; }
    auto cb = callbacks_.NewCallback(&NativePlayer::Operation); cb.MayForce(player_.Play(cb)); Status("playing");
}
