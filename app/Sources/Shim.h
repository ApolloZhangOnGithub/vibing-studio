// Shim.h —— Swift 调不了的几个 C 函数（变参的），包一层（build.sh 用 -import-objc-header 带进来）
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>

// shm_open 是变参函数（mode 在 ... 里），Swift 直接调不了：远程桌面的画面放在共享内存里，App 建、助手进程画（RdpPanes.swift）
static inline int vs_shm_open(const char *name, int oflag, mode_t mode) { return shm_open(name, oflag, mode); }
