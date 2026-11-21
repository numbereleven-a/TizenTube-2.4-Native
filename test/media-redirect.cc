#include "../native/src/media_redirect.h"
#include <cassert>
int main() {
    assert(MediaRangePath("/videoplayback?sig=synthetic&range=0-10&cpn=test", "11-20") == "/videoplayback?sig=synthetic&cpn=test&range=11-20");
    assert(MediaRangePath("/videoplayback", "0-10") == "/videoplayback?range=0-10");
    assert(MediaRangePath("/videoplayback?sig=synthetic&range=0-10&cpn=test", "") == "/videoplayback?sig=synthetic&cpn=test");
    assert(MediaRangePath("/videoplayback", "") == "/videoplayback");
    assert(MediaSequencePath("/videoplayback?sig=synthetic&sq=1&range=0-0&cpn=test", 42) == "/videoplayback?sig=synthetic&cpn=test&sq=42");
    assert(MediaSequencePath("/videoplayback", 0) == "/videoplayback?sq=0");
    std::string host, path;
    assert(MediaRedirect("https://r1.example.googlevideo.com/videoplayback?range=100-200&sig=synthetic", host, path));
    assert(host == "r1.example.googlevideo.com" && path == "/videoplayback?range=100-200&sig=synthetic");
    for (const char* url : {"http://r1.googlevideo.com/a", "https://r1.googlevideo.com.evil.test/a", "https://evil@r1.googlevideo.com/a", "https://r1.googlevideo.com:443/a", "https://r1.googlevideo.com/a\r\nx", "https://youtube.com/a"})
        assert(!MediaRedirect(url, host, path));
}
