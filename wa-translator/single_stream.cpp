#include "whisper.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <chrono>
#include <cmath>
#include <cstring>
#include <sndfile.h>
using clk = std::chrono::steady_clock;
static double ms_since(clk::time_point t){return std::chrono::duration<double,std::milli>(clk::now()-t).count();}
static std::vector<float> load(const char* p){SF_INFO i{};auto f=sf_open(p,SFM_READ,&i);std::vector<float> d(i.frames*i.channels);sf_readf_float(f,d.data(),i.frames);sf_close(f);std::vector<float> m(i.frames);for(sf_count_t j=0;j<i.frames;j++){float s=0;for(int c=0;c<i.channels;c++)s+=d[j*i.channels+c];m[j]=s/i.channels;}return m;}
int main(int c,char**v){if(c<3){fprintf(stderr,"usage: %s wav model\n",v[0]);return 1;}auto pcm=load(v[1]);auto ctx=whisper_init_from_file_with_params(v[2],whisper_context_default_params());const int WIN=3*16000,STEP=1500*16;size_t pos=0;int n=0;double sum=0,mx=0;while(pos<pcm.size()){int len=std::min(WIN,(int)(pcm.size()-pos));std::vector<float> w(WIN,0);memcpy(w.data(),pcm.data()+pos,len*sizeof(float));auto t0=clk::now();whisper_full_params wp=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);wp.print_progress=wp.print_special=wp.print_realtime=wp.print_timestamps=false;wp.n_threads=8;wp.language="en";wp.no_context=true;whisper_full(ctx,wp,w.data(),WIN);double lat=ms_since(t0);n++;sum+=lat;if(lat>mx)mx=lat;const char*txt=whisper_full_n_segments(ctx)>0?whisper_full_get_segment_text(ctx,0):"";printf("pos=%5.1fs lat=%5.0fms >> %s\n",pos/16000.0,lat,txt);pos+=STEP;}printf("\nSINGLE-STREAM %s: %d windows avg=%.0fms max=%.0fms\n",v[2],n,sum/n,mx);return 0;}
