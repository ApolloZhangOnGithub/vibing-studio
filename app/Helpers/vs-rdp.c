// vs-rdp.c —— Vibing Studio 的远程桌面助手（RDP 客户端，FreeRDP 3）：一个连接一个进程，App 起它（Sources/RdpPanes.swift），崩了也只断这一个连接。
//   画面：GDI 直接画进 fd 3 那块共享内存（App 建的；BGRA，一行紧挨一行：stride = 宽 × 4）；画完一块就告诉 App 哪块变了（frame 事件），App 拷到自己的显示层上
//   标准输入：App → 这里，一行一条（先是连接参数，「connect」开始连；连上以后是键盘、鼠标、剪贴板、改大小……）；值都是百分号编码的
//   标准输出：这里 → App，一行一个 JSON 事件；库自己打的日志都改去标准错误（不会混进事件里）
// 编译（build.sh；没带编好的那台 Mac 上 App 自己编）：
//   clang -O2 vs-rdp.c -I<freerdp>/include/freerdp3 -I<freerdp>/include/winpr3 -L<freerdp>/lib -lfreerdp3 -lfreerdp-client3 -lwinpr3 -o vs-rdp
// 单独试：没有 fd 3 时自己分一块内存（画面不给别人看），照样能连、能收事件——
//   printf 'host 127.0.0.1\nport 3389\nuser u\npass p\nconnect\n' | ./vs-rdp
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <freerdp/freerdp.h>
#include <freerdp/client.h>
#include <freerdp/client/cliprdr.h>
#include <freerdp/client/disp.h>
#include <freerdp/channels/cliprdr.h>
#include <freerdp/channels/disp.h>
#include <freerdp/codec/color.h>
#include <freerdp/constants.h>
#include <freerdp/error.h>
#include <freerdp/event.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/graphics.h>
#include <freerdp/settings.h>
#include <freerdp/version.h>
#include <winpr/input.h>
#include <winpr/string.h>
#include <winpr/synch.h>
#include <winpr/user.h>

#define VS_RDP_PROTOCOL 1 // App 和助手之间的协议版本（--version 里报给 App；改了不兼容的地方 +1，App 就知道要重新编）

// ---------------------------------------------------------------- 事件（JSON 一行一个）
static FILE* EV;
static pthread_mutex_t evLock = PTHREAD_MUTEX_INITIALIZER;

typedef struct { char* p; size_t n, cap; } sbuf;
static void sb_put(sbuf* b, const char* s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    size_t c = b->cap ? b->cap : 256;
    while (c < b->n + n + 1) c *= 2;
    char* q = realloc(b->p, c);
    if (!q) return;
    b->p = q; b->cap = c;
  }
  memcpy(b->p + b->n, s, n);
  b->n += n;
  b->p[b->n] = 0;
}
static void sb_str(sbuf* b, const char* s) { sb_put(b, s, strlen(s)); }
static void sb_fmt(sbuf* b, const char* fmt, ...) {
  char tmp[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  if (n > 0) sb_put(b, tmp, (size_t)n < sizeof tmp ? (size_t)n : sizeof tmp - 1);
}
// JSON 字符串（带引号）：引号、反斜杠、控制字符转义；UTF-8 照原样
static void sb_json(sbuf* b, const char* s) {
  sb_put(b, "\"", 1);
  for (const unsigned char* q = (const unsigned char*)(s ? s : ""); *q; q++) {
    char e[8];
    if (*q == '"' || *q == '\\') { e[0] = '\\'; e[1] = (char)*q; sb_put(b, e, 2); }
    else if (*q == '\n') sb_put(b, "\\n", 2);
    else if (*q == '\r') sb_put(b, "\\r", 2);
    else if (*q == '\t') sb_put(b, "\\t", 2);
    else if (*q < 0x20) { snprintf(e, sizeof e, "\\u%04x", *q); sb_put(b, e, 6); }
    else sb_put(b, (const char*)q, 1);
  }
  sb_put(b, "\"", 1);
}
static void sb_b64(sbuf* b, const BYTE* d, size_t n) {
  static const char T[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  char o[4];
  size_t i = 0;
  for (; i + 2 < n; i += 3) {
    UINT32 v = ((UINT32)d[i] << 16) | ((UINT32)d[i + 1] << 8) | d[i + 2];
    o[0] = T[v >> 18]; o[1] = T[(v >> 12) & 63]; o[2] = T[(v >> 6) & 63]; o[3] = T[v & 63];
    sb_put(b, o, 4);
  }
  if (i < n) {
    UINT32 v = (UINT32)d[i] << 16;
    if (i + 1 < n) v |= (UINT32)d[i + 1] << 8;
    o[0] = T[v >> 18]; o[1] = T[(v >> 12) & 63]; o[2] = i + 1 < n ? T[(v >> 6) & 63] : '='; o[3] = '=';
    sb_put(b, o, 4);
  }
}
static void ev_send(sbuf* b) {
  if (!b->p) return;
  pthread_mutex_lock(&evLock);
  fputs(b->p, EV);
  fputc('\n', EV);
  fflush(EV);
  pthread_mutex_unlock(&evLock);
  free(b->p);
  b->p = NULL; b->n = b->cap = 0;
}
static void ev(const char* fmt, ...) {
  char tmp[1024];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  pthread_mutex_lock(&evLock);
  fputs(tmp, EV);
  fputc('\n', EV);
  fflush(EV);
  pthread_mutex_unlock(&evLock);
}
// 出错：码、FreeRDP 给的名字和说明（App 按名字分类：密码不对、连不上、证书……）
static void ev_error(const char* where, UINT32 code) {
  sbuf b = { 0 };
  sb_fmt(&b, "{\"ev\":\"error\",\"where\":\"%s\",\"code\":%u,\"name\":", where, code);
  sb_json(&b, freerdp_get_last_error_name(code));
  sb_str(&b, ",\"msg\":");
  sb_json(&b, freerdp_get_last_error_string(code));
  sb_str(&b, ",\"cat\":");
  sb_json(&b, freerdp_get_last_error_category(code));
  sb_str(&b, "}");
  ev_send(&b);
}

// ---------------------------------------------------------------- 状态
typedef struct {
  rdpClientContext common;
  DispClientContext* disp;
  BOOL dispOk;
  CliprdrClientContext* clip;
  BOOL clipOk;
  UINT32 nextCursor;
} vsContext;

typedef struct {
  rdpPointer pointer;
  UINT32 id;
} vsPointer;

static BYTE* FB;       // 画面（fd 3 的共享内存，或者单独试时自己分的）
static size_t FBMAX;
static char* PIN;      // 认过的证书指纹（App 记着的）：对不上就不连，告诉 App
static BOOL WANT_AUDIO;
static BOOL QUIT;      // App 叫断开的（q）：不算出错

// 剪贴板：这台 Mac 上现在复制的文字（UTF-16，带结尾的 0）；远端要的时候给
static pthread_mutex_t clipLock = PTHREAD_MUTEX_INITIALIZER;
static WCHAR* clipW;
static size_t clipWLen;
static UINT32 clipWant;

// ---------------------------------------------------------------- 画
static BOOL vs_begin_paint(rdpContext* context) {
  rdpGdi* gdi = context->gdi;
  if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd) return TRUE;
  HGDI_WND hwnd = gdi->primary->hdc->hwnd;
  if (hwnd->invalid) hwnd->invalid->null = TRUE;
  hwnd->ninvalid = 0;
  return TRUE;
}

static BOOL vs_end_paint(rdpContext* context) {
  rdpGdi* gdi = context->gdi;
  if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd) return TRUE;
  HGDI_WND hwnd = gdi->primary->hdc->hwnd;
  if (!hwnd->invalid || hwnd->invalid->null) return TRUE;
  INT32 x = hwnd->invalid->x, y = hwnd->invalid->y, w = hwnd->invalid->w, h = hwnd->invalid->h;
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > gdi->width) w = gdi->width - x;
  if (y + h > gdi->height) h = gdi->height - y;
  if (w > 0 && h > 0) ev("{\"ev\":\"frame\",\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d}", x, y, w, h);
  hwnd->invalid->null = TRUE;
  hwnd->ninvalid = 0;
  return TRUE;
}

static BOOL fits(UINT32 w, UINT32 h) { return w > 0 && h > 0 && (size_t)w * h * 4 <= FBMAX; }

// 远端改了分辨率（连上时定的、GFX 的 ResetGraphics、我们要求的）：同一块内存，按新的宽高重新排
static BOOL vs_desktop_resize(rdpContext* context) {
  rdpGdi* gdi = context->gdi;
  rdpSettings* s = context->settings;
  UINT32 w = freerdp_settings_get_uint32(s, FreeRDP_DesktopWidth), h = freerdp_settings_get_uint32(s, FreeRDP_DesktopHeight);
  if (!fits(w, h)) { ev("{\"ev\":\"error\",\"where\":\"resize\",\"name\":\"VS_TOO_BIG\",\"msg\":\"desktop %ux%u is too large\"}", w, h); return FALSE; }
  if (!gdi_resize_ex(gdi, w, h, w * 4, PIXEL_FORMAT_BGRA32, FB, NULL)) return FALSE;
  ev("{\"ev\":\"size\",\"w\":%u,\"h\":%u,\"stride\":%u}", w, h, w * 4);
  return TRUE;
}

static BOOL vs_play_sound(rdpContext* context, const PLAY_SOUND_UPDATE* ps) {
  (void)context; (void)ps;
  ev("{\"ev\":\"beep\"}");
  return TRUE;
}
static BOOL vs_keyboard_indicators(rdpContext* context, UINT16 flags) {
  (void)context;
  ev("{\"ev\":\"leds\",\"flags\":%u}", flags);
  return TRUE;
}
static BOOL vs_keyboard_ime(rdpContext* context, UINT16 id, UINT32 state, UINT32 mode) {
  (void)context; (void)id; (void)state; (void)mode;
  return TRUE;
}

// ---------------------------------------------------------------- 鼠标指针（远端的样子：转成 BGRA 交给 App 做成 NSCursor）
static BOOL vs_pointer_new(rdpContext* context, rdpPointer* pointer) {
  vsContext* vs = (vsContext*)context;
  vsPointer* p = (vsPointer*)pointer;
  p->id = 0;
  UINT32 w = pointer->width, h = pointer->height;
  if (!w || !h || w > 512 || h > 512 || !context->gdi) return TRUE;
  BYTE* px = calloc((size_t)w * h, 4);
  if (!px) return FALSE;
  if (!freerdp_image_copy_from_pointer_data(px, PIXEL_FORMAT_BGRA32, w * 4, 0, 0, w, h, pointer->xorMaskData, pointer->lengthXorMask,
                                            pointer->andMaskData, pointer->lengthAndMask, pointer->xorBpp, &context->gdi->palette)) {
    free(px);
    return TRUE;
  }
  p->id = ++vs->nextCursor;
  sbuf b = { 0 };
  sb_fmt(&b, "{\"ev\":\"cursor\",\"id\":%u,\"w\":%u,\"h\":%u,\"hx\":%u,\"hy\":%u,\"data\":\"", p->id, w, h, pointer->xPos, pointer->yPos);
  sb_b64(&b, px, (size_t)w * h * 4);
  sb_str(&b, "\"}");
  ev_send(&b);
  free(px);
  return TRUE;
}
static void vs_pointer_free(rdpContext* context, rdpPointer* pointer) {
  (void)context;
  vsPointer* p = (vsPointer*)pointer;
  if (p->id) ev("{\"ev\":\"cursor\",\"free\":%u}", p->id);
}
static BOOL vs_pointer_set(rdpContext* context, rdpPointer* pointer) {
  (void)context;
  ev("{\"ev\":\"cursor\",\"set\":%u}", ((vsPointer*)pointer)->id);
  return TRUE;
}
static BOOL vs_pointer_set_null(rdpContext* context) {
  (void)context;
  ev("{\"ev\":\"cursor\",\"hide\":true}");
  return TRUE;
}
static BOOL vs_pointer_set_default(rdpContext* context) {
  (void)context;
  ev("{\"ev\":\"cursor\",\"set\":0}");
  return TRUE;
}
static BOOL vs_pointer_set_position(rdpContext* context, UINT32 x, UINT32 y) {
  (void)context; (void)x; (void)y;
  return TRUE;
}

// ---------------------------------------------------------------- 剪贴板（只同步文字；远端一复制就要过来交给 App，App 放进这台 Mac 的剪贴板）
static UINT clip_send_formats(CliprdrClientContext* c) {
  CLIPRDR_FORMAT f = { CF_UNICODETEXT, NULL };
  CLIPRDR_FORMAT_LIST l = { 0 };
  l.common.msgType = CB_FORMAT_LIST;
  pthread_mutex_lock(&clipLock);
  BOOL have = clipW != NULL;
  pthread_mutex_unlock(&clipLock);
  l.numFormats = have ? 1 : 0;
  l.formats = have ? &f : NULL;
  return c->ClientFormatList(c, &l);
}
static UINT clip_monitor_ready(CliprdrClientContext* c, const CLIPRDR_MONITOR_READY* m) {
  (void)m;
  CLIPRDR_GENERAL_CAPABILITY_SET g = { 0 };
  g.capabilitySetType = CB_CAPSTYPE_GENERAL;
  g.capabilitySetLength = CB_CAPSTYPE_GENERAL_LEN;
  g.version = CB_CAPS_VERSION_2;
  g.generalFlags = CB_USE_LONG_FORMAT_NAMES;
  CLIPRDR_CAPABILITIES caps = { 0 };
  caps.common.msgType = CB_CLIP_CAPS;
  caps.cCapabilitiesSets = 1;
  caps.capabilitySets = (CLIPRDR_CAPABILITY_SET*)&g;
  UINT rc = c->ClientCapabilities(c, &caps);
  if (rc != CHANNEL_RC_OK) return rc;
  ((vsContext*)c->custom)->clipOk = TRUE;
  return clip_send_formats(c);
}
static UINT clip_server_caps(CliprdrClientContext* c, const CLIPRDR_CAPABILITIES* caps) {
  (void)c; (void)caps;
  return CHANNEL_RC_OK;
}
static UINT clip_server_format_list(CliprdrClientContext* c, const CLIPRDR_FORMAT_LIST* l) {
  CLIPRDR_FORMAT_LIST_RESPONSE r = { 0 };
  r.common.msgType = CB_FORMAT_LIST_RESPONSE;
  r.common.msgFlags = CB_RESPONSE_OK;
  UINT rc = c->ClientFormatListResponse(c, &r);
  if (rc != CHANNEL_RC_OK) return rc;
  UINT32 want = 0;
  for (UINT32 i = 0; i < l->numFormats; i++) {
    if (l->formats[i].formatId == CF_UNICODETEXT) want = CF_UNICODETEXT;
    else if (!want && l->formats[i].formatId == CF_TEXT) want = CF_TEXT;
  }
  if (!want) return CHANNEL_RC_OK;
  clipWant = want;
  CLIPRDR_FORMAT_DATA_REQUEST q = { 0 };
  q.common.msgType = CB_FORMAT_DATA_REQUEST;
  q.requestedFormatId = want;
  return c->ClientFormatDataRequest(c, &q);
}
static UINT clip_server_format_list_response(CliprdrClientContext* c, const CLIPRDR_FORMAT_LIST_RESPONSE* r) {
  (void)c; (void)r;
  return CHANNEL_RC_OK;
}
static UINT clip_server_data_request(CliprdrClientContext* c, const CLIPRDR_FORMAT_DATA_REQUEST* q) {
  CLIPRDR_FORMAT_DATA_RESPONSE r = { 0 };
  r.common.msgType = CB_FORMAT_DATA_RESPONSE;
  pthread_mutex_lock(&clipLock);
  if (q->requestedFormatId == CF_UNICODETEXT && clipW) {
    r.common.msgFlags = CB_RESPONSE_OK;
    r.common.dataLen = (UINT32)(clipWLen * sizeof(WCHAR));
    r.requestedFormatData = (const BYTE*)clipW;
  } else r.common.msgFlags = CB_RESPONSE_FAIL;
  UINT rc = c->ClientFormatDataResponse(c, &r);
  pthread_mutex_unlock(&clipLock);
  return rc;
}
static UINT clip_server_data_response(CliprdrClientContext* c, const CLIPRDR_FORMAT_DATA_RESPONSE* r) {
  (void)c;
  if (!(r->common.msgFlags & CB_RESPONSE_OK) || !r->requestedFormatData || !r->common.dataLen) return CHANNEL_RC_OK;
  char* u8 = NULL;
  if (clipWant == CF_UNICODETEXT) {
    size_t n = r->common.dataLen / sizeof(WCHAR);
    const WCHAR* w = (const WCHAR*)r->requestedFormatData;
    while (n > 0 && w[n - 1] == 0) n--;
    u8 = n ? ConvertWCharNToUtf8Alloc(w, n, NULL) : strdup("");
  } else {
    size_t n = r->common.dataLen;
    const char* a = (const char*)r->requestedFormatData;
    while (n > 0 && a[n - 1] == 0) n--;
    u8 = strndup(a, n);
  }
  if (!u8) return CHANNEL_RC_OK;
  sbuf b = { 0 };
  sb_str(&b, "{\"ev\":\"clip\",\"text\":");
  sb_json(&b, u8);
  sb_str(&b, "}");
  ev_send(&b);
  free(u8);
  return CHANNEL_RC_OK;
}
static void clip_init(vsContext* vs, CliprdrClientContext* c) {
  vs->clip = c;
  c->custom = vs;
  c->MonitorReady = clip_monitor_ready;
  c->ServerCapabilities = clip_server_caps;
  c->ServerFormatList = clip_server_format_list;
  c->ServerFormatListResponse = clip_server_format_list_response;
  c->ServerFormatDataRequest = clip_server_data_request;
  c->ServerFormatDataResponse = clip_server_data_response;
}
// App 说这台 Mac 上复制了文字（NULL：复制的不是文字 / 清空了）：记下来，告诉远端「我这有文字」，它要的时候再给
static void clip_set_local(vsContext* vs, const char* utf8) {
  pthread_mutex_lock(&clipLock);
  free(clipW);
  clipW = NULL;
  clipWLen = 0;
  if (utf8) {
    size_t n = 0;
    clipW = ConvertUtf8ToWCharAlloc(utf8, &n);
    if (clipW) clipWLen = n + 1;
  }
  pthread_mutex_unlock(&clipLock);
  if (vs->clip && vs->clipOk) (void)clip_send_formats(vs->clip);
}

// ---------------------------------------------------------------- 改分辨率（远端支持「显示控制」时：跟着标签页的大小走）
static UINT vs_disp_caps(DispClientContext* disp, UINT32 maxMonitors, UINT32 a, UINT32 b) {
  (void)a; (void)b;
  vsContext* vs = (vsContext*)disp->custom;
  vs->dispOk = TRUE;
  ev("{\"ev\":\"disp\",\"max\":%u}", maxMonitors);
  return CHANNEL_RC_OK;
}

// ---------------------------------------------------------------- 通道
static void vs_channel_connected(void* context, const ChannelConnectedEventArgs* e) {
  vsContext* vs = (vsContext*)context;
  if (strcmp(e->name, CLIPRDR_SVC_CHANNEL_NAME) == 0) clip_init(vs, (CliprdrClientContext*)e->pInterface);
  else if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) {
    vs->disp = (DispClientContext*)e->pInterface;
    vs->disp->custom = vs;
    vs->disp->DisplayControlCaps = vs_disp_caps;
  } else freerdp_client_OnChannelConnectedEventHandler(context, e);
}
static void vs_channel_disconnected(void* context, const ChannelDisconnectedEventArgs* e) {
  vsContext* vs = (vsContext*)context;
  if (strcmp(e->name, CLIPRDR_SVC_CHANNEL_NAME) == 0) { vs->clip = NULL; vs->clipOk = FALSE; }
  else if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) { vs->disp = NULL; vs->dispOk = FALSE; }
  else freerdp_client_OnChannelDisconnectedEventHandler(context, e);
}

// ---------------------------------------------------------------- 连接的几步
static BOOL vs_pre_connect(freerdp* instance) {
  rdpContext* ctx = instance->context;
  rdpSettings* s = ctx->settings;
  if (!freerdp_settings_set_uint32(s, FreeRDP_OsMajorType, OSMAJORTYPE_MACINTOSH)) return FALSE;
  if (!freerdp_settings_set_uint32(s, FreeRDP_OsMinorType, OSMINORTYPE_MACINTOSH)) return FALSE;
  PubSub_SubscribeChannelConnected(ctx->pubSub, vs_channel_connected);
  PubSub_SubscribeChannelDisconnected(ctx->pubSub, vs_channel_disconnected);
  return TRUE;
}

static BOOL vs_post_connect(freerdp* instance) {
  rdpContext* ctx = instance->context;
  rdpSettings* s = ctx->settings;
  UINT32 w = freerdp_settings_get_uint32(s, FreeRDP_DesktopWidth), h = freerdp_settings_get_uint32(s, FreeRDP_DesktopHeight);
  if (!fits(w, h)) { ev("{\"ev\":\"error\",\"where\":\"connect\",\"name\":\"VS_TOO_BIG\",\"msg\":\"desktop %ux%u is too large\"}", w, h); return FALSE; }
  if (!gdi_init_ex(instance, PIXEL_FORMAT_BGRA32, w * 4, FB, NULL)) return FALSE;
  rdpPointer proto = { 0 };
  proto.size = sizeof(vsPointer);
  proto.New = vs_pointer_new;
  proto.Free = vs_pointer_free;
  proto.Set = vs_pointer_set;
  proto.SetNull = vs_pointer_set_null;
  proto.SetDefault = vs_pointer_set_default;
  proto.SetPosition = vs_pointer_set_position;
  graphics_register_pointer(ctx->graphics, &proto);
  rdpUpdate* u = ctx->update;
  u->BeginPaint = vs_begin_paint;
  u->EndPaint = vs_end_paint;
  u->DesktopResize = vs_desktop_resize;
  u->PlaySound = vs_play_sound;
  u->SetKeyboardIndicators = vs_keyboard_indicators;
  u->SetKeyboardImeStatus = vs_keyboard_ime;
  ev("{\"ev\":\"size\",\"w\":%u,\"h\":%u,\"stride\":%u}", w, h, w * 4);
  return TRUE;
}

static void vs_post_disconnect(freerdp* instance) {
  if (!instance || !instance->context) return;
  PubSub_UnsubscribeChannelConnected(instance->context->pubSub, vs_channel_connected);
  PubSub_UnsubscribeChannelDisconnected(instance->context->pubSub, vs_channel_disconnected);
  gdi_free(instance);
}

// 缺密码：不在终端里问（这里没有终端），告诉 App，App 在标签页里让人输
static BOOL vs_authenticate(freerdp* instance, char** username, char** password, char** domain, rdp_auth_reason reason) {
  (void)instance; (void)username; (void)password; (void)domain;
  ev("{\"ev\":\"needpass\",\"reason\":%d}", (int)reason);
  return FALSE;
}

// 证书：自签的（GNOME 远程桌面就是）没法按 CA 认，按指纹认——第一次记下（App 记），以后对不上就不连（可能是别的机器冒充）
static DWORD vs_cert(const char* fp, const char* subject, const char* issuer, BOOL changed) {
  BOOL ok = !PIN || !*PIN || (fp && strcasecmp(PIN, fp) == 0);
  sbuf b = { 0 };
  sb_str(&b, "{\"ev\":\"cert\",\"fp\":");
  sb_json(&b, fp);
  sb_str(&b, ",\"subject\":");
  sb_json(&b, subject);
  sb_str(&b, ",\"issuer\":");
  sb_json(&b, issuer);
  sb_fmt(&b, ",\"ok\":%s,\"changed\":%s}", ok ? "true" : "false", changed ? "true" : "false");
  ev_send(&b);
  return ok ? 2 : 0; // 2：这一次接受（不写进 FreeRDP 自己的证书库，认不认由 App 记着的指纹定）
}
static DWORD vs_verify_cert(freerdp* instance, const char* host, UINT16 port, const char* cn, const char* subject, const char* issuer,
                            const char* fp, DWORD flags) {
  (void)instance; (void)host; (void)port; (void)cn; (void)flags;
  return vs_cert(fp, subject, issuer, FALSE);
}
static DWORD vs_verify_changed_cert(freerdp* instance, const char* host, UINT16 port, const char* cn, const char* subject, const char* issuer,
                                    const char* fp, const char* oldSubject, const char* oldIssuer, const char* oldFp, DWORD flags) {
  (void)instance; (void)host; (void)port; (void)cn; (void)oldSubject; (void)oldIssuer; (void)oldFp; (void)flags;
  return vs_cert(fp, subject, issuer, TRUE);
}

static int vs_logon_error_info(freerdp* instance, UINT32 data, UINT32 type) {
  (void)instance;
  sbuf b = { 0 };
  sb_fmt(&b, "{\"ev\":\"logon\",\"data\":%u,\"type\":%u,\"what\":", data, type);
  sb_json(&b, freerdp_get_logon_error_info_type(type));
  sb_str(&b, ",\"detail\":");
  sb_json(&b, freerdp_get_logon_error_info_data(data));
  sb_str(&b, "}");
  ev_send(&b);
  return 1;
}

static BOOL vs_client_new(freerdp* instance, rdpContext* context) {
  (void)context;
  instance->PreConnect = vs_pre_connect;
  instance->PostConnect = vs_post_connect;
  instance->PostDisconnect = vs_post_disconnect;
  instance->AuthenticateEx = vs_authenticate;
  instance->VerifyCertificateEx = vs_verify_cert;
  instance->VerifyChangedCertificateEx = vs_verify_changed_cert;
  instance->LogonErrorInfo = vs_logon_error_info;
  return TRUE;
}
static void vs_client_free(freerdp* instance, rdpContext* context) { (void)instance; (void)context; }
static int vs_client_start(rdpContext* context) { (void)context; return 0; }
static int vs_client_stop(rdpContext* context) { (void)context; return 0; }

// ---------------------------------------------------------------- 输入（App → 这里）
static void pct_decode(char* s) {
  char* o = s;
  for (char* p = s; *p; p++) {
    if (*p == '%' && p[1] && p[2]) {
      char hx[3] = { p[1], p[2], 0 };
      *o++ = (char)strtol(hx, NULL, 16);
      p += 2;
    } else *o++ = *p;
  }
  *o = 0;
}

static void send_wheel(rdpInput* in, BOOL horizontal, int units, UINT16 x, UINT16 y) {
  // 一次最多 ±255（9 位补码里正的那半）；多的拆成几次
  while (units != 0) {
    int u = units > 120 ? 120 : units < -120 ? -120 : units;
    UINT16 f = horizontal ? PTR_FLAGS_HWHEEL : PTR_FLAGS_WHEEL;
    if (u < 0) f |= PTR_FLAGS_WHEEL_NEGATIVE | (UINT16)((0x100 + u) & 0xFF);
    else f |= (UINT16)(u & 0xFF);
    (void)freerdp_input_send_mouse_event(in, f, x, y);
    units -= u;
  }
}

static void handle_line(vsContext* vs, char* line) {
  rdpContext* ctx = &vs->common.context;
  rdpInput* in = ctx->input;
  unsigned a = 0, b = 0, c = 0;
  int sw = 0;
  switch (line[0]) {
    case 'm': // 鼠标：m <flags> <x> <y>（flags 是 RDP 的 PTR_FLAGS_*，App 算好的）
      if (sscanf(line + 1, "%u %u %u", &a, &b, &c) == 3) (void)freerdp_input_send_mouse_event(in, (UINT16)a, (UINT16)b, (UINT16)c);
      break;
    case 'x': // 侧键（后退 / 前进）：x <PTR_XFLAGS_*> <x> <y>
      if (sscanf(line + 1, "%u %u %u", &a, &b, &c) == 3) (void)freerdp_input_send_extended_mouse_event(in, (UINT16)a, (UINT16)b, (UINT16)c);
      break;
    case 'w': // 滚轮：w <0 竖 | 1 横> <单位（120 = 一格，正 = 往上 / 往右）> <x> <y>
      if (sscanf(line + 1, "%u %d %u %u", &a, &sw, &b, &c) == 4) send_wheel(in, a != 0, sw, (UINT16)b, (UINT16)c);
      break;
    case 'k': // 键：k <0 松开 | 1 按下 | 2 按着连发> <扫描码，十六进制（扩展键带 0x100）>
      if (sscanf(line + 1, "%u %x", &a, &b) == 2) (void)freerdp_input_send_keyboard_event_ex(in, a != 0, a == 2, b);
      break;
    case 'u': // Unicode 字符：u <0 | 1> <码位>
      if (sscanf(line + 1, "%u %u", &a, &b) == 2) (void)freerdp_input_send_unicode_keyboard_event(in, a ? 0 : KBD_FLAGS_RELEASE, (UINT16)b);
      break;
    case 's': // 锁定键的状态（大写锁定……）：s <KBD_SYNC_*>
      if (sscanf(line + 1, "%u", &a) == 1) (void)freerdp_input_send_synchronize_event(in, a);
      break;
    case 'r': // 改分辨率：r <宽> <高> <缩放 %>（远端支持显示控制才有用）
      if (sscanf(line + 1, "%u %u %u", &a, &b, &c) >= 2 && vs->disp && vs->dispOk) {
        if (a < 200) a = 200;
        if (b < 200) b = 200;
        if (a > 8192) a = 8192;
        if (b > 8192) b = 8192;
        a &= ~1u;
        if (!fits(a, b)) break;
        DISPLAY_CONTROL_MONITOR_LAYOUT l = { 0 };
        l.Flags = DISPLAY_CONTROL_MONITOR_PRIMARY;
        l.Width = a;
        l.Height = b;
        l.Orientation = ORIENTATION_LANDSCAPE;
        l.DesktopScaleFactor = c >= 100 && c <= 500 ? c : 100;
        l.DeviceScaleFactor = 100;
        (void)vs->disp->SendMonitorLayout(vs->disp, 1, &l);
      }
      break;
    case 'v': // 看不看得见：v 0 → 让远端先别发画面（省流量）；v 1 → 接着发（远端会整个重画一遍）
      if (ctx->gdi && sscanf(line + 1, "%u", &a) == 1) (void)gdi_send_suppress_output(ctx->gdi, a ? FALSE : TRUE);
      break;
    case 'R': { // 整个重画一遍
      rdpGdi* gdi = ctx->gdi;
      if (gdi && ctx->update && ctx->update->RefreshRect) {
        RECTANGLE_16 r = { 0, 0, (UINT16)gdi->width, (UINT16)gdi->height };
        (void)ctx->update->RefreshRect(ctx, 1, &r);
      }
      break;
    }
    case 'c': // 这台 Mac 上复制了文字：c <百分号编码的 UTF-8>
      pct_decode(line + 2);
      clip_set_local(vs, line + 2);
      break;
    case 'C': // 复制的不是文字
      clip_set_local(vs, NULL);
      break;
    case 'q':
      QUIT = TRUE;
      freerdp_abort_connect_context(ctx);
      break;
    default:
      break;
  }
}

// 标准输入：不阻塞地读，凑够一行处理一行；读到头（App 关了管道 / App 没了）就断开
static char* inbuf;
static size_t inlen, incap;
static BOOL read_input(vsContext* vs) {
  for (;;) {
    if (incap - inlen < 65536) {
      size_t nc = incap ? incap * 2 : 1 << 16;
      if (nc > (64u << 20)) { inlen = 0; nc = incap; } // 一行太长（剪贴板里几十 MB）：不要了
      char* q = realloc(inbuf, nc);
      if (!q) return FALSE;
      inbuf = q;
      incap = nc;
    }
    ssize_t r = read(STDIN_FILENO, inbuf + inlen, incap - inlen - 1);
    if (r > 0) {
      inlen += (size_t)r;
      size_t start = 0;
      for (size_t i = 0; i < inlen; i++) {
        if (inbuf[i] != '\n') continue;
        inbuf[i] = 0;
        if (i > start) handle_line(vs, inbuf + start);
        start = i + 1;
      }
      memmove(inbuf, inbuf + start, inlen - start);
      inlen -= start;
      continue;
    }
    if (r == 0) return FALSE;
    if (errno == EAGAIN || errno == EWOULDBLOCK) return TRUE;
    if (errno == EINTR) continue;
    return FALSE;
  }
}

// 连接参数：一行一个「名字 值」，到「connect」为止（阻塞地读）
typedef struct {
  char *host, *user, *pass, *domain, *cfg;
  unsigned port, w, h, scale;
  BOOL clip, avc444, h264, gfx;
} vsConfig;

static char* read_config_line(void) {
  static char line[1 << 16];
  size_t n = 0;
  for (;;) {
    char ch;
    ssize_t r = read(STDIN_FILENO, &ch, 1);
    if (r == 1) {
      if (ch == '\n') { line[n] = 0; return line; }
      if (n < sizeof line - 1) line[n++] = ch;
      continue;
    }
    if (r < 0 && errno == EINTR) continue;
    return NULL;
  }
}

static BOOL read_config(vsConfig* c) {
  c->port = 3389; c->w = 1920; c->h = 1080; c->scale = 100;
  c->clip = TRUE; c->avc444 = TRUE; c->h264 = TRUE; c->gfx = TRUE;
  for (;;) {
    char* l = read_config_line();
    if (!l) return FALSE;
    if (strcmp(l, "connect") == 0) return c->host != NULL;
    char* sp = strchr(l, ' ');
    char* v = sp ? sp + 1 : (char*)"";
    if (sp) *sp = 0;
    pct_decode(v);
    if (!strcmp(l, "host")) c->host = strdup(v);
    else if (!strcmp(l, "port")) c->port = (unsigned)atoi(v);
    else if (!strcmp(l, "user")) c->user = strdup(v);
    else if (!strcmp(l, "pass")) c->pass = strdup(v);
    else if (!strcmp(l, "domain")) c->domain = strdup(v);
    else if (!strcmp(l, "w")) c->w = (unsigned)atoi(v);
    else if (!strcmp(l, "h")) c->h = (unsigned)atoi(v);
    else if (!strcmp(l, "scale")) c->scale = (unsigned)atoi(v);
    else if (!strcmp(l, "clip")) c->clip = atoi(v) != 0;
    else if (!strcmp(l, "audio")) WANT_AUDIO = atoi(v) != 0;
    else if (!strcmp(l, "avc444")) c->avc444 = atoi(v) != 0;
    else if (!strcmp(l, "h264")) c->h264 = atoi(v) != 0;
    else if (!strcmp(l, "gfx")) c->gfx = atoi(v) != 0;
    else if (!strcmp(l, "pin")) PIN = strdup(v);
    else if (!strcmp(l, "cfg")) c->cfg = strdup(v);
  }
}

static BOOL apply_config(rdpSettings* s, const vsConfig* c) {
  BOOL ok = TRUE;
  ok = ok && freerdp_settings_set_string(s, FreeRDP_ServerHostname, c->host);
  ok = ok && freerdp_settings_set_uint32(s, FreeRDP_ServerPort, c->port);
  if (c->user && *c->user) ok = ok && freerdp_settings_set_string(s, FreeRDP_Username, c->user);
  if (c->pass && *c->pass) ok = ok && freerdp_settings_set_string(s, FreeRDP_Password, c->pass);
  if (c->domain && *c->domain) ok = ok && freerdp_settings_set_string(s, FreeRDP_Domain, c->domain);
  if (c->cfg && *c->cfg) ok = ok && freerdp_settings_set_string(s, FreeRDP_ConfigPath, c->cfg); // FreeRDP 自己的配置（证书库……）放 App 的目录里，不碰 ~/.config/freerdp
  UINT32 w = c->w < 200 ? 200 : c->w > 8192 ? 8192 : c->w, h = c->h < 200 ? 200 : c->h > 8192 ? 8192 : c->h;
  w &= ~1u;
  ok = ok && freerdp_settings_set_uint32(s, FreeRDP_DesktopWidth, w);
  ok = ok && freerdp_settings_set_uint32(s, FreeRDP_DesktopHeight, h);
  ok = ok && freerdp_settings_set_uint32(s, FreeRDP_ColorDepth, 32);
  if (c->scale > 100 && c->scale <= 500) {
    ok = ok && freerdp_settings_set_uint32(s, FreeRDP_DesktopScaleFactor, c->scale);
    ok = ok && freerdp_settings_set_uint32(s, FreeRDP_DeviceScaleFactor, 100);
  }
  // 画面：图形管线（RDPGFX）+ H.264（AVC444：文字的颜色边不糊；AVC420 更省流量）、渐进式、RemoteFX 兜底
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_SupportGraphicsPipeline, c->gfx);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_GfxH264, c->h264);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_GfxAVC444, c->h264 && c->avc444);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_GfxAVC444v2, c->h264 && c->avc444);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_GfxProgressive, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_GfxProgressiveV2, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_RemoteFxCodec, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_FastPathOutput, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_FrameMarkerCommandEnabled, TRUE);
  ok = ok && freerdp_settings_set_uint32(s, FreeRDP_ConnectionType, CONNECTION_TYPE_AUTODETECT);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_NetworkAutoDetect, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_AllowFontSmoothing, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_AllowDesktopComposition, TRUE);
  // 跟着标签页改大小（远端支持才有用：GNOME 的「远程登录」可以，「桌面共享」跟着那边的显示器）
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_SupportDisplayControl, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_DynamicResolutionUpdate, TRUE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_RedirectClipboard, c->clip);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_AudioPlayback, WANT_AUDIO);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_IgnoreCertificate, FALSE);
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_AutoReconnectionEnabled, FALSE); // 断了 App 来重连（隧道断了要等它回来，App 看得见）
  ok = ok && freerdp_settings_set_bool(s, FreeRDP_UseCommonStdioCallbacks, FALSE);  // 别在标准输入上问东西（那是 App 的管道）
  return ok;
}

int main(int argc, char** argv) {
  if (argc > 1 && !strcmp(argv[1], "--version")) {
    printf("{\"protocol\":%d,\"freerdp\":\"%s\"}\n", VS_RDP_PROTOCOL, freerdp_get_version_string());
    return 0;
  }
  signal(SIGPIPE, SIG_IGN);
  // 事件走原来的标准输出；标准输出本身改到标准错误（库里 printf 的、WLog 打的都不会混进事件）
  int evfd = dup(STDOUT_FILENO);
  dup2(STDERR_FILENO, STDOUT_FILENO);
  EV = fdopen(evfd, "w");
  if (!EV) return 2;

  struct stat st;
  if (fstat(3, &st) == 0 && st.st_size > 0) {
    FBMAX = (size_t)st.st_size;
    FB = mmap(NULL, FBMAX, PROT_READ | PROT_WRITE, MAP_SHARED, 3, 0);
    if (FB == MAP_FAILED) FB = NULL;
  }
  if (!FB) { // 单独试：自己的一块（只用到的部分才真占内存）
    FBMAX = (size_t)8192 * 8192 * 4;
    FB = mmap(NULL, FBMAX, PROT_READ | PROT_WRITE, MAP_ANON | MAP_PRIVATE, -1, 0);
    if (FB == MAP_FAILED) { ev("{\"ev\":\"error\",\"where\":\"start\",\"name\":\"VS_NO_MEMORY\",\"msg\":\"no framebuffer\"}"); return 2; }
  }

  vsConfig cfg = { 0 };
  if (!read_config(&cfg)) { ev("{\"ev\":\"error\",\"where\":\"start\",\"name\":\"VS_BAD_CONFIG\",\"msg\":\"missing host\"}"); return 2; }

  RDP_CLIENT_ENTRY_POINTS ep = { 0 };
  ep.Version = RDP_CLIENT_INTERFACE_VERSION;
  ep.Size = sizeof(RDP_CLIENT_ENTRY_POINTS_V1);
  ep.ContextSize = sizeof(vsContext);
  ep.ClientNew = vs_client_new;
  ep.ClientFree = vs_client_free;
  ep.ClientStart = vs_client_start;
  ep.ClientStop = vs_client_stop;
  rdpContext* ctx = freerdp_client_context_new(&ep);
  if (!ctx) { ev("{\"ev\":\"error\",\"where\":\"start\",\"name\":\"VS_NO_CONTEXT\",\"msg\":\"freerdp_client_context_new failed\"}"); return 2; }
  vsContext* vs = (vsContext*)ctx;
  int rc = 0;
  if (!apply_config(ctx->settings, &cfg)) { ev("{\"ev\":\"error\",\"where\":\"start\",\"name\":\"VS_BAD_SETTINGS\",\"msg\":\"settings rejected\"}"); rc = 2; goto out; }
  if (cfg.pass) { memset(cfg.pass, 0, strlen(cfg.pass)); free(cfg.pass); cfg.pass = NULL; } // FreeRDP 自己留了一份：这份抹掉
  if (freerdp_client_start(ctx) != 0) { ev("{\"ev\":\"error\",\"where\":\"start\",\"name\":\"VS_START\",\"msg\":\"freerdp_client_start failed\"}"); rc = 2; goto out; }

  ev("{\"ev\":\"state\",\"s\":\"connecting\"}");
  if (!freerdp_connect(ctx->instance)) {
    ev_error("connect", freerdp_get_last_error(ctx));
    rc = 1;
    goto stop;
  }
  ev("{\"ev\":\"state\",\"s\":\"connected\"}");

  fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK);
  HANDLE hIn = CreateFileDescriptorEventA(NULL, FALSE, FALSE, STDIN_FILENO, WINPR_FD_READ);
  BOOL appGone = FALSE;
  while (!freerdp_shall_disconnect_context(ctx)) {
    HANDLE hs[MAXIMUM_WAIT_OBJECTS] = { 0 };
    DWORD n = freerdp_get_event_handles(ctx, hs, ARRAYSIZE(hs) - 1);
    if (n == 0) break;
    if (hIn) hs[n++] = hIn;
    DWORD w = WaitForMultipleObjects(n, hs, FALSE, 250);
    if (w == WAIT_FAILED) break;
    if (!freerdp_check_event_handles(ctx)) break;
    if (!read_input(vs)) { appGone = TRUE; break; }
  }
  UINT32 err = freerdp_get_last_error(ctx);
  BOOL byApp = appGone || QUIT;
  if (err != FREERDP_ERROR_SUCCESS && !byApp) ev_error("session", err);
  ev("{\"ev\":\"state\",\"s\":\"closed\",\"code\":%u,\"by\":\"%s\"}", byApp ? 0 : err, byApp ? "app" : "remote");
  if (hIn) CloseHandle(hIn);
  freerdp_disconnect(ctx->instance);
stop:
  freerdp_client_stop(ctx);
out:
  freerdp_client_context_free(ctx);
  return rc;
}
