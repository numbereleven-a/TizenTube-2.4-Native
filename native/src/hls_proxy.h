#pragma once
#include <map>
#include <memory>
#include <string>
#include <vector>
#include <cstdio>
#include <cstring>
#include <nacl/nacl_random.h>
#include "ppapi/c/pp_errors.h"
#include "ppapi/c/private/ppb_net_address_private.h"
#include "ppapi/c/private/ppb_tcp_server_socket_private.h"
#include "ppapi/c/private/ppb_tcp_socket_private.h"
#include "ppapi/cpp/module.h"
#include "ppapi/cpp/core.h"
#include "ppapi/cpp/instance.h"
#include "ppapi/cpp/var_array_buffer.h"
#include "ppapi/cpp/var_dictionary.h"
#include "ppapi/utility/completion_callback_factory.h"

class HlsProxy {
    class Connection;
    pp::Instance* instance_;
    const PPB_TCPServerSocket_Private* server_api_;
    const PPB_TCPSocket_Private* socket_api_;
    const PPB_NetAddress_Private* address_api_;
    pp::CompletionCallbackFactory<HlsProxy> callbacks_;
    PP_Resource server_ = 0, accepted_ = 0;
    int next_ = 1;
    std::map<int, std::unique_ptr<Connection>> connections_;
    std::string secret_;
    uint16_t port_ = 0;
    void ListenDone(int32_t code);
    void Accepted(int32_t code);
    void Accept();
    void Remove(int32_t, int id) { connections_.erase(id); }
    void Retire(int id) { pp::Module::Get()->core()->CallOnMainThread(0,callbacks_.NewCallback(&HlsProxy::Remove,id)); }
    void Send(const pp::VarDictionary& m) { instance_->PostMessage(m); }
    class Connection {
        HlsProxy* owner_;
        int id_;
        PP_Resource socket_;
        pp::CompletionCallbackFactory<Connection> callbacks_;
        char input_[8192];
        std::string request_;
        std::vector<char> output_;
        size_t written_ = 0;
        void ReadDone(int32_t code) {
            if (code<=0) { owner_->Retire(id_); return; }
            request_.append(input_,code);
            if (request_.size()>8192) { owner_->Retire(id_); return; }
            if (request_.find("\r\n\r\n")==std::string::npos) { Read(); return; }
            size_t end=request_.find(" HTTP/");
            if(request_.compare(0,4,"GET ")!=0 || end==std::string::npos || request_.compare(4,owner_->secret_.size()+2,"/"+owner_->secret_+"/")!=0) { owner_->Retire(id_); return; }
            pp::VarDictionary m; m.Set("type","hls-request");m.Set("id",id_);m.Set("path",request_.substr(6+owner_->secret_.size(),end-6-owner_->secret_.size()));owner_->Send(m);
        }
        void Read() { auto cb=callbacks_.NewCallback(&Connection::ReadDone);cb.MayForce(owner_->socket_api_->Read(socket_,input_,sizeof(input_),cb.pp_completion_callback())); }
        void WriteDone(int32_t code) { if(code<=0){owner_->Retire(id_);return;}written_+=code;if(written_>=output_.size()){owner_->Retire(id_);return;}Write(); }
        void Write() { auto cb=callbacks_.NewCallback(&Connection::WriteDone);cb.MayForce(owner_->socket_api_->Write(socket_,output_.data()+written_,static_cast<int32_t>(std::min<size_t>(output_.size()-written_,65536)),cb.pp_completion_callback())); }
    public:
        Connection(HlsProxy* owner,int id,PP_Resource socket):owner_(owner),id_(id),socket_(socket),callbacks_(this){}
        ~Connection(){callbacks_.CancelAll();owner_->socket_api_->Disconnect(socket_);pp::Module::Get()->core()->ReleaseResource(socket_);}
        void Begin(){Read();}
        void Reply(const pp::VarDictionary& m){
            pp::Var body=m.Get("body");if(!body.is_array_buffer()){owner_->Retire(id_);return;}
            pp::VarArrayBuffer buffer(body);uint32_t len=buffer.ByteLength();if(len>8*1024*1024){owner_->Retire(id_);return;}
            int status=m.Get("status").AsInt();if(status!=200)status=502;
            std::string type=m.Get("contentType").AsString();if(type!="video/mp2t" && type!="audio/aac" && type!="audio/mp4" && type!="video/mp4" && type!="video/MP2T")type="application/octet-stream";
            char header[256];int n=snprintf(header,sizeof header,"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n",status,status==200?"OK":"Bad Gateway",m.Get("playlist").AsBool()?"application/vnd.apple.mpegurl":type.c_str(),len);
            output_.assign(header,header+n);const char* p=static_cast<const char*>(buffer.Map());if(len)output_.insert(output_.end(),p,p+len);buffer.Unmap();Write();
        }
    };
public:
    explicit HlsProxy(pp::Instance* instance):instance_(instance),
      server_api_(static_cast<const PPB_TCPServerSocket_Private*>(pp::Module::Get()->GetBrowserInterface(PPB_TCPSERVERSOCKET_PRIVATE_INTERFACE))),
      socket_api_(static_cast<const PPB_TCPSocket_Private*>(pp::Module::Get()->GetBrowserInterface(PPB_TCPSOCKET_PRIVATE_INTERFACE))),
      address_api_(static_cast<const PPB_NetAddress_Private*>(pp::Module::Get()->GetBrowserInterface(PPB_NETADDRESS_PRIVATE_INTERFACE))),callbacks_(this){}
    ~HlsProxy(){Stop();}
    void Start(){
        Stop();if(!server_api_||!socket_api_||!address_api_){pp::VarDictionary m;m.Set("type","hls-ready");m.Set("code",-100);Send(m);return;}
        unsigned char bytes[16];size_t count=0;if(nacl_secure_random(bytes,sizeof bytes,&count)!=0||count!=sizeof bytes){pp::VarDictionary m;m.Set("type","hls-ready");m.Set("code",-101);Send(m);return;}
        const char* hex="0123456789abcdef";secret_.clear();for(auto b:bytes){secret_+=hex[b>>4];secret_+=hex[b&15];}
        server_=server_api_->Create(instance_->pp_instance());if(!server_){pp::VarDictionary m;m.Set("type","hls-ready");m.Set("code",-102);Send(m);return;}
        uint8_t ip[4]={127,0,0,1};PP_NetAddress_Private addr{};address_api_->CreateFromIPv4Address(ip,0,&addr);
        auto cb=callbacks_.NewCallback(&HlsProxy::ListenDone);cb.MayForce(server_api_->Listen(server_,&addr,8,cb.pp_completion_callback()));
    }
    void Stop(){callbacks_.CancelAll();connections_.clear();if(server_){server_api_->StopListening(server_);pp::Module::Get()->core()->ReleaseResource(server_);server_=0;}if(accepted_){pp::Module::Get()->core()->ReleaseResource(accepted_);accepted_=0;}secret_.clear();port_=0;}
    void Reply(const pp::VarDictionary& m){auto it=connections_.find(m.Get("id").AsInt());if(it!=connections_.end())it->second->Reply(m);}
};
inline void HlsProxy::ListenDone(int32_t code){
    pp::VarDictionary m;m.Set("type","hls-ready");m.Set("code",code);
    if(code==PP_OK){PP_NetAddress_Private a{};if(server_api_->GetLocalAddress(server_,&a)==PP_OK){port_=address_api_->GetPort(&a);m.Set("port",static_cast<int>(port_));m.Set("secret",secret_);}else m.Set("code",-103);}
    Send(m);if(port_)Accept();
}
inline void HlsProxy::Accept(){auto cb=callbacks_.NewCallback(&HlsProxy::Accepted);cb.MayForce(server_api_->Accept(server_,&accepted_,cb.pp_completion_callback()));}
inline void HlsProxy::Accepted(int32_t code){if(code!=PP_OK)return;PP_Resource socket=accepted_;accepted_=0;if(connections_.size()>=12){socket_api_->Disconnect(socket);pp::Module::Get()->core()->ReleaseResource(socket);}else{int id=next_++;connections_[id].reset(new Connection(this,id,socket));connections_[id]->Begin();}Accept();}
