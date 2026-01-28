#define _GNU_SOURCE
#include <errno.h>

int close_range(unsigned int first, unsigned int last, int flags) {
    errno = 38;
    return -1;
}
