#pragma once
#include <cstdint>
#include <cstdio>
#include <string>

inline std::string MediaRangePath(const std::string& path, const std::string& range) {
    size_t question = path.find('?');
    std::string result = path.substr(0, question) + "?";
    if (question != std::string::npos) {
        size_t at = question + 1;
        while (at < path.size()) {
            size_t end = path.find('&', at);
            std::string part = path.substr(at, end == std::string::npos ? end : end - at);
            if (!part.empty() && part.compare(0, 6, "range=") != 0) result += part + "&";
            if (end == std::string::npos) break;
            at = end + 1;
        }
    }
    if (!range.empty()) return result + "range=" + range;
    result.erase(result.size() - 1);
    return result;
}

inline std::string MediaSequencePath(const std::string& path, uint64_t seq) {
    size_t question = path.find('?');
    std::string result = path.substr(0, question) + "?";
    if (question != std::string::npos) {
        size_t at = question + 1;
        while (at < path.size()) {
            size_t end = path.find('&', at);
            std::string part = path.substr(at, end == std::string::npos ? end : end - at);
            if (!part.empty() && part.compare(0, 6, "range=") != 0 && part.compare(0, 3, "sq=") != 0) result += part + "&";
            if (end == std::string::npos) break;
            at = end + 1;
        }
    }
    char b[32];
    snprintf(b, sizeof b, "%llu", (unsigned long long)seq);
    return result + "sq=" + b;
}

// Media redirects retain the byte range and are confined to YouTube's CDN.
inline bool MediaRedirect(const std::string& url, std::string& host, std::string& path) {
    if (url.compare(0, 8, "https://") != 0) return false;
    size_t slash = url.find('/', 8);
    if (slash == std::string::npos) return false;
    std::string authority = url.substr(8, slash - 8);
    const std::string suffix = ".googlevideo.com";
    if (authority.size() <= suffix.size() || authority.compare(authority.size() - suffix.size(), suffix.size(), suffix) != 0) return false;
    if (authority.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-") != std::string::npos || url.find_first_of("\r\n") != std::string::npos) return false;
    host = authority; path = url.substr(slash); return true;
}
