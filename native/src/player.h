#pragma once
#include "ppapi/cpp/var_dictionary.h"
#include "ppapi/cpp/instance.h"
#include "ppapi/cpp/samsung/media_player_samsung.h"
#include "ppapi/cpp/samsung/es_data_source_samsung.h"
#include "ppapi/cpp/samsung/media_events_listener_samsung.h"
#include "ppapi/cpp/samsung/buffering_listener_samsung.h"
#include "ppapi/utility/completion_callback_factory.h"
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>

class NativePlayer : public pp::MediaEventsListener_Samsung, public pp::BufferingListener_Samsung {
public:
    typedef std::function<void(const pp::VarDictionary&)> Sender;
    NativePlayer(pp::Instance* instance, Sender send);
    ~NativePlayer();
    void Command(const pp::VarDictionary& message);
    bool Network(const pp::VarDictionary& message);
    bool Bytes(int id, const char* data, size_t size);
    void OnTimeUpdate(PP_TimeTicks time) override;
    void OnEnded() override;
    void OnError(PP_MediaPlayerError error) override;
    void OnBufferingStart() override;
    void OnBufferingProgress(uint32_t percent) override;
    void OnBufferingComplete() override;
private:
    struct Track;
    pp::Instance* instance_;
    Sender send_;
    pp::CompletionCallbackFactory<NativePlayer> callbacks_;
    pp::MediaPlayer_Samsung player_;
    std::unique_ptr<pp::ESDataSource_Samsung> source_;
    std::unique_ptr<Track> tracks_[2];
    bool active_ = false, attached_ = false, started_ = false, paused_ = false, eos_ = false, seeking_ = false, live_ = false;
    std::atomic<int64_t> live_base_ms_;
    double duration_ = 0, position_ = 0;
    double next_report_ = 0;
    int next_id_ = -100, initialized_ = 0, session_ = 0;
    bool closing_ = false, wants_open_ = false;
    pp::VarDictionary pending_open_;
    std::string user_agent_, mode_;
    void Stop();
    void Close();
    void Closed(int32_t);
    void Open(const pp::VarDictionary& message);
    void Pump(int32_t);
    void AppendNext(int index);
    void Fetch(Track& track);
    void Configure(Track& track);
    void VideoAdded(int32_t, pp::VideoElementaryStream_Samsung stream);
    void AudioAdded(int32_t, pp::AudioElementaryStream_Samsung stream);
    void Initialized(int32_t);
    void Attached(int32_t);
    void Appended(int32_t, int index);
    void Operation(int32_t);
    void SeekDone(int32_t);
    void Status(const char* state, int code = 0);
#ifdef TTL_TEST_HTTP_FAILURES
    int test_http_track_=-1,test_http_count_=0,test_http_status_=503;
    void TestHttpResponse(int32_t,int index,int id);
#endif
};

inline void PlayerCapabilities(pp::Instance* instance, pp::VarDictionary& message) {
    pp::MediaPlayer_Samsung player(instance);
    pp::ESDataSource_Samsung source(instance);
    message.Set("nativePlayer", !player.is_null());
    message.Set("elementaryStreams", !source.is_null());
}
