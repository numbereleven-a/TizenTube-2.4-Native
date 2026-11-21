#include "media/demuxer.h"
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <algorithm>
#include <iostream>
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    FILE* file = fopen(argv[1], "rb"); if (!file) return 2;
    auto d = omega::media::open_demuxer([file](void* p, size_t n) { return fread(p, 1, n, file); });
    if (!d->read_header()) { std::cerr << d->error(); return 1; }
    std::deque<omega::media::Sample> samples;
    int count = 0, reordered = 0; int64_t previous = -10000;
    while (d->read_fragment(samples)) {
        for (const auto& s : samples) {
            if (s.data.empty() || s.dts_ms < previous || s.duration_ms < 0) return 1;
            previous = s.dts_ms; if (s.dts_ms != s.pts_ms) ++reordered; ++count;
        }
        samples.clear();
    }
    fclose(file);
    if (!d->error().empty()) { std::cerr << d->error(); return 1; }
    if (d->segments().size() > 1) {
        const auto segment = d->segments()[1];
        FILE* seek = fopen(argv[1], "rb"); if (!seek) return 2;
        fseek(seek, static_cast<long>(segment.offset), SEEK_SET);
        auto resumed = omega::media::resume_demuxer([seek](void* p, size_t n) { return fread(p, 1, n, seek); },d->track(),segment);
        if (!resumed->read_fragment(samples) || samples.empty() || !samples.front().key) return 1;
        fclose(seek);
        std::cout << "Indexed seek: " << samples.front().pts_ms << " ms\n";
    }
    std::cout << "Samples: " << count << ", reordered: " << reordered << "\n";
    return count > 0 ? 0 : 1;
}
