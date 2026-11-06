/*
 * The `python3` a jailed command finds first on PATH. It asks the Python zygote, through the socket the jail
 * mounts at /run/aeven/zygote/python.sock, to run this invocation in a preloaded interpreter joined to this jail,
 * and relays the run's signals and exit status. When the socket is absent, the request does not fit one message,
 * or the zygote answers `F`, it executes the image's interpreter (REAL_PYTHON) with the same argv, so every invocation behaves as the
 * real interpreter's would. The protocol is described in python-zygote.py.
 *
 * Build: musl-gcc -static -O2 -DREAL_PYTHON='"/opt/aeven-sandbox/bin/python3"' -o python3 python-shim.c
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#define SOCKET_PATH "/run/aeven/zygote/python.sock"
/* The image's own interpreter, set at build time; its virtual environment holds the installed packages. */
#ifndef REAL_PYTHON
#define REAL_PYTHON "/opt/aeven-sandbox/bin/python3"
#endif
#define MAX_MESSAGE (512 * 1024)
#define MAX_FDS 250

extern char **environ;

static pid_t run_pid;
static char **argv_saved;

static void real_python(void) {
  argv_saved[0] = REAL_PYTHON;
  execv(REAL_PYTHON, argv_saved);
  _exit(127);
}

static void forward(int sig) {
  if (run_pid > 0) kill(run_pid, sig);
}

static int put32(char *buf, size_t *len, uint32_t value) {
  if (*len + 4 > MAX_MESSAGE) return -1;
  memcpy(buf + *len, &value, 4);
  *len += 4;
  return 0;
}

static int put_string(char *buf, size_t *len, const char *text) {
  size_t size = strlen(text) + 1;
  if (*len + size > MAX_MESSAGE) return -1;
  memcpy(buf + *len, text, size);
  *len += size;
  return 0;
}

/* Read exactly one reply message into `reply`; returns its length, 0 at end of stream, -1 on error. */
static ssize_t read_reply(int sock, char *reply, size_t size) {
  for (;;) {
    ssize_t got = recv(sock, reply, size, 0);
    if (got >= 0 || errno != EINTR) return got;
  }
}

int main(int argc, char **argv) {
  argv_saved = argv;
  if (getenv("AEVEN_PYTHON_ZYGOTE") != NULL && strcmp(getenv("AEVEN_PYTHON_ZYGOTE"), "0") == 0) real_python();

  /* The descriptors this process holds, before it opens any of its own. */
  int fds[MAX_FDS + 1];
  uint32_t numbers[MAX_FDS];
  size_t count = 0;
  DIR *dir = opendir("/proc/self/fd");
  if (dir == NULL) real_python();
  int listing = dirfd(dir);
  struct dirent *entry;
  while ((entry = readdir(dir)) != NULL) {
    if (entry->d_name[0] == '.') continue;
    int fd = atoi(entry->d_name);
    if (fd == listing) continue;
    if (count == MAX_FDS) real_python();
    numbers[count++] = (uint32_t)fd;
  }
  closedir(dir);

  int cwd = open(".", O_PATH | O_DIRECTORY | O_CLOEXEC);
  if (cwd < 0) real_python();
  int sock = socket(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
  if (sock < 0) real_python();
  struct sockaddr_un addr = { .sun_family = AF_UNIX };
  strcpy(addr.sun_path, SOCKET_PATH);
  if (connect(sock, (struct sockaddr *)&addr, sizeof addr) != 0) real_python();

  static char message[MAX_MESSAGE];
  size_t len = 0;
  size_t envc = 0;
  while (environ[envc] != NULL) envc++;
  mode_t mask = umask(0);
  umask(mask);
  memcpy(message, "AVNZ1", 6);
  len = 6;
  int fail = put32(message, &len, (uint32_t)mask) | put32(message, &len, (uint32_t)argc)
    | put32(message, &len, (uint32_t)envc) | put32(message, &len, (uint32_t)count);
  for (size_t i = 0; i < count; i++) fail |= put32(message, &len, numbers[i]);
  for (int i = 0; i < argc; i++) fail |= put_string(message, &len, argv[i]);
  for (size_t i = 0; i < envc; i++) fail |= put_string(message, &len, environ[i]);
  if (fail) real_python();

  fds[0] = cwd;
  for (size_t i = 0; i < count; i++) fds[i + 1] = (int)numbers[i];
  static char control[CMSG_SPACE(sizeof(int) * (MAX_FDS + 1))];
  struct iovec iov = { .iov_base = message, .iov_len = len };
  struct msghdr msg = {
    .msg_iov = &iov, .msg_iovlen = 1, .msg_control = control, .msg_controllen = CMSG_SPACE(sizeof(int) * (count + 1)),
  };
  struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg);
  cmsg->cmsg_level = SOL_SOCKET;
  cmsg->cmsg_type = SCM_RIGHTS;
  cmsg->cmsg_len = CMSG_LEN(sizeof(int) * (count + 1));
  memcpy(CMSG_DATA(cmsg), fds, sizeof(int) * (count + 1));
  if (sendmsg(sock, &msg, MSG_NOSIGNAL) < 0) real_python();
  close(cwd);

  struct sigaction action = { .sa_handler = forward };
  sigemptyset(&action.sa_mask);
  const int relayed[] = { SIGINT, SIGTERM, SIGHUP, SIGQUIT, SIGUSR1, SIGUSR2, SIGWINCH, SIGCONT, SIGALRM };
  for (size_t i = 0; i < sizeof relayed / sizeof relayed[0]; i++) sigaction(relayed[i], &action, NULL);

  char reply[16];
  for (;;) {
    ssize_t got = read_reply(sock, reply, sizeof reply);
    if (got <= 0) _exit(126);
    if (reply[0] == 'F') {
      close(sock);
      real_python();
    }
    if (reply[0] == 'P' && got == 5) {
      uint32_t pid;
      memcpy(&pid, reply + 1, 4);
      run_pid = (pid_t)pid;
      continue;
    }
    if (reply[0] == 'X' && got == 9) {
      uint32_t kind, value;
      memcpy(&kind, reply + 1, 4);
      memcpy(&value, reply + 5, 4);
      if (kind == 1) {
        signal((int)value, SIG_DFL);
        kill(getpid(), (int)value);
        _exit(128 + (int)value);
      }
      _exit((int)value);
    }
  }
}
