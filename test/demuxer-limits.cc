#include "media/mp4.h"
#include "media/webm.h"
#include <algorithm>
#include <cassert>
#include <cstring>
#include <iostream>
using namespace omega::media;
using Bytes = std::vector<uint8_t>;
static void u32(Bytes& b, uint32_t n) { for (int i = 24; i >= 0; i -= 8) b.push_back(uint8_t(n >> i)); }
static Bytes box(const char* type, const Bytes& payload) {
    Bytes b; u32(b, uint32_t(payload.size() + 8)); b.insert(b.end(), type, type + 4);
    b.insert(b.end(), payload.begin(), payload.end()); return b;
}
static Demuxer::ReadFn reader(const Bytes& bytes, size_t& offset) {
    return [&bytes, &offset](void* dst, size_t n) {
        n = std::min(n, bytes.size() - offset); memcpy(dst, bytes.data() + offset, n); offset += n; return n;
    };
}
static Bytes fragment(uint32_t count, uint32_t flags) {
    Bytes run; u32(run, flags | 1); u32(run, count); u32(run, 44);
    Bytes result = box("moof", box("traf", box("trun", run)));
    Bytes data = box("mdat", Bytes{1, 2}); result.insert(result.end(), data.begin(), data.end()); return result;
}
int main() {
    TrackInfo track; track.timescale = 1000; track.default_duration = 40; track.default_size = 1;
    for (uint32_t flags : {0u, 0x100u}) {
        Bytes bytes = fragment(2, flags); size_t at = 0; std::deque<Sample> out;
        Fmp4Reader d(reader(bytes, at), track, Segment{0, 0, 0});
        bool ok = d.read_fragment(out);
        if (!flags) { assert(ok && out.size() == 2 && out[1].pts_ms == 40 && out[1].data[0] == 2); }
        else { assert(!ok && !d.error().empty()); }
    }
    {
        Bytes bytes = fragment(0xffffffffu, 0); size_t at = 0; std::deque<Sample> out;
        Fmp4Reader d(reader(bytes, at), track, Segment{0, 0, 0});
        assert(!d.read_fragment(out) && !d.error().empty());
    }
    {
        Bytes bytes; u32(bytes, uint32_t(kMaxFragmentBytes + 9)); bytes.insert(bytes.end(), {'m','o','o','v'});
        size_t at = 0; Fmp4Reader d(reader(bytes, at));
        assert(!d.read_header() && at == 8 && !d.error().empty());
    }
    {
        Bytes bytes{0xa3, 0x01, 0, 0, 0, 0, 0, 0, 0};
        uint64_t size = kMaxFragmentBytes + 1;
        for (int i = 0; i < 7; ++i) bytes[8 - i] = uint8_t(size >> (8 * i));
        size_t at = 0; std::deque<Sample> out; WebmReader d(reader(bytes, at), track, Segment{0, 0, 0});
        assert(!d.read_fragment(out) && at == bytes.size() && !d.error().empty());
    }
    {
        Bytes bytes{0, 0, 0, 16}; size_t at = 0; Fmp4Reader d(reader(bytes, at));
        assert(!d.read_header() && !d.error().empty());
    }
    {
        Bytes bytes{0xa3, 0x01}; size_t at = 0; std::deque<Sample> out;
        WebmReader d(reader(bytes, at), track, Segment{0, 0, 0});
        assert(!d.read_fragment(out) && !d.error().empty());
    }
    {
        Bytes run1; u32(run1, 1); u32(run1, 1); u32(run1, 60);
        Bytes run2; u32(run2, 0); u32(run2, 1);
        Bytes traf_payload = box("trun", run1);
        Bytes trun2 = box("trun", run2); traf_payload.insert(traf_payload.end(), trun2.begin(), trun2.end());
        Bytes bytes = box("moof", box("traf", traf_payload));
        Bytes data = box("mdat", Bytes{11, 22}); bytes.insert(bytes.end(), data.begin(), data.end());
        size_t at = 0; std::deque<Sample> out; Fmp4Reader d(reader(bytes, at), track, Segment{0, 0, 0});
        assert(d.read_fragment(out) && out.size() == 2 && out[0].data[0] == 11 && out[1].data[0] == 22 && out[1].pts_ms == 40);
    }
    std::cout << "Demuxer limits and default trun samples passed\n";
}
