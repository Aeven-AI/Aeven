/*
 * The jail's only way out to the network. A jailed command has its own network namespace with nothing but a
 * loopback interface, so this program listens on a loopback port inside that namespace and copies every connection
 * to the egress proxy's Unix socket, which the jail mounts read-only. It starts the relay as a detached process
 * and then executes the command, so the command keeps its process id and its descriptors; the relay ends with the
 * jail's process namespace.
 *
 * Each proxy connection opens with one line, `AEVEN <identity>\n`, which the proxy checks before it reads the
 * request. The identity names this jail's own account and conversation and carries their token, so a command that
 * reads it gains nothing it did not have.
 *
 * A relay that cannot listen writes one line to stderr and the command runs without network.
 *
 * Build: musl-gcc -static -O2 -Wall -o aeven-egress-relay egress-relay.c
 * Run:   aeven-egress-relay <port> <proxy socket> <identity> -- <command> [arguments]
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

/* Connections one jail holds at once; a package manager opens a few dozen. Further ones wait in the listen queue. */
#define MAX_CONNECTIONS 64
#define BUFFER_BYTES (64 * 1024)
/* The proxy may be restarting; a connection waits this long for its socket before it is dropped. */
#define CONNECT_ATTEMPTS 20
#define CONNECT_WAIT_MS 50

/* One direction of a connection: bytes read from `from` and not yet written to `to`. */
struct pipe_half {
  char *data;
  size_t length;
  size_t offset;
  int eof;      /* `from` sent everything */
  int shut;     /* that end was passed on to `to` */
};

struct connection {
  int client;   /* the command's TCP connection; -1 marks a free slot */
  int proxy;    /* the proxy's Unix socket */
  struct pipe_half up;   /* client to proxy */
  struct pipe_half down; /* proxy to client */
};

static struct connection connections[MAX_CONNECTIONS];

static void nonblocking(int fd) {
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
  fcntl(fd, F_SETFD, FD_CLOEXEC);
}

static void release(struct connection *c) {
  close(c->client);
  close(c->proxy);
  free(c->up.data);
  free(c->down.data);
  memset(c, 0, sizeof *c);
  c->client = -1;
}

/* Connect to the proxy and queue the identifying line; returns -1 when the proxy stays unreachable. */
static int open_proxy(const char *path, const char *hello, struct pipe_half *up) {
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  strncpy(address.sun_path, path, sizeof address.sun_path - 1);
  for (int attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return -1;
    if (connect(fd, (struct sockaddr *)&address, sizeof address) == 0) {
      nonblocking(fd);
      up->length = strlen(hello);
      memcpy(up->data, hello, up->length);
      return fd;
    }
    close(fd);
    if (errno != ENOENT && errno != ECONNREFUSED && errno != EAGAIN) return -1;
    poll(NULL, 0, CONNECT_WAIT_MS);
  }
  return -1;
}

static void accept_one(int listener, const char *path, const char *hello) {
  struct connection *c = NULL;
  for (int i = 0; i < MAX_CONNECTIONS; i++) if (connections[i].client < 0) { c = &connections[i]; break; }
  if (c == NULL) return;
  int client = accept(listener, NULL, NULL);
  if (client < 0) return;
  nonblocking(client);
  c->up.data = malloc(BUFFER_BYTES);
  c->down.data = malloc(BUFFER_BYTES);
  c->client = client;
  c->proxy = c->up.data == NULL || c->down.data == NULL ? -1 : open_proxy(path, hello, &c->up);
  if (c->proxy < 0) release(c);
}

/* Read into an empty half; returns -1 when the connection failed. */
static int fill(int from, struct pipe_half *half) {
  ssize_t count = read(from, half->data, BUFFER_BYTES);
  if (count < 0) return errno == EAGAIN || errno == EINTR ? 0 : -1;
  if (count == 0) half->eof = 1;
  half->length = (size_t)count;
  half->offset = 0;
  return 0;
}

/* Write what a half holds, and pass on the end of its stream once it is empty; returns -1 when the connection failed. */
static int drain(int to, struct pipe_half *half) {
  while (half->offset < half->length) {
    ssize_t count = write(to, half->data + half->offset, half->length - half->offset);
    if (count < 0) return errno == EAGAIN || errno == EINTR ? 0 : -1;
    half->offset += (size_t)count;
  }
  half->length = half->offset = 0;
  if (half->eof && !half->shut) {
    shutdown(to, SHUT_WR);
    half->shut = 1;
  }
  return 0;
}

static void serve(int listener, const char *path, const char *hello) {
  struct pollfd fds[1 + 2 * MAX_CONNECTIONS];
  struct connection *owner[1 + 2 * MAX_CONNECTIONS];
  for (;;) {
    int count = 0, used = 0;
    for (int i = 0; i < MAX_CONNECTIONS; i++) {
      struct connection *c = &connections[i];
      if (c->client < 0) continue;
      used++;
      short client = 0, proxy = 0;
      if (c->up.length > c->up.offset) proxy |= POLLOUT; else if (!c->up.eof) client |= POLLIN;
      if (c->down.length > c->down.offset) client |= POLLOUT; else if (!c->down.eof) proxy |= POLLIN;
      fds[count] = (struct pollfd){ .fd = c->client, .events = client }; owner[count++] = c;
      fds[count] = (struct pollfd){ .fd = c->proxy, .events = proxy }; owner[count++] = c;
    }
    int listening = used < MAX_CONNECTIONS;
    if (listening) fds[count] = (struct pollfd){ .fd = listener, .events = POLLIN };
    if (poll(fds, (nfds_t)(count + listening), -1) < 0) {
      if (errno == EINTR) continue;
      return;
    }
    for (int i = 0; i < count; i += 2) {
      struct connection *c = owner[i];
      short client = fds[i].revents, proxy = fds[i + 1].revents;
      int failed = (client | proxy) & (POLLERR | POLLNVAL) ? -1 : 0;
      if (client & (POLLIN | POLLHUP | POLLERR) && c->up.length == 0 && !c->up.eof) failed |= fill(c->client, &c->up);
      if (proxy & (POLLIN | POLLHUP | POLLERR) && c->down.length == 0 && !c->down.eof) failed |= fill(c->proxy, &c->down);
      if (!failed) failed |= drain(c->proxy, &c->up);
      if (!failed) failed |= drain(c->client, &c->down);
      if (failed || (c->up.shut && c->down.shut)) release(c);
    }
    if (listening && fds[count].revents & POLLIN) accept_one(listener, path, hello);
  }
}

static int listen_on(int port) {
  int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  struct sockaddr_in address = { .sin_family = AF_INET, .sin_port = htons((uint16_t)port) };
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(fd, (struct sockaddr *)&address, sizeof address) != 0 || listen(fd, 128) != 0) {
    close(fd);
    return -1;
  }
  nonblocking(fd);
  return fd;
}

int main(int argc, char **argv) {
  if (argc < 6 || strcmp(argv[4], "--") != 0) {
    fprintf(stderr, "usage: aeven-egress-relay <port> <proxy socket> <identity> -- <command> [arguments]\n");
    return 125;
  }
  int port = atoi(argv[1]);
  char hello[512];
  int hello_length = snprintf(hello, sizeof hello, "AEVEN %s\n", argv[3]);
  int listener = hello_length > 0 && (size_t)hello_length < sizeof hello ? listen_on(port) : -1;
  if (listener < 0) {
    fprintf(stderr, "aeven-egress-relay: cannot listen on 127.0.0.1:%d (%s); this command has no network\n", port, strerror(errno));
  } else {
    /* Fork twice, so the relay belongs to the namespace's first process and the command never sees a child it did not start. */
    pid_t child = fork();
    if (child == 0) {
      if (fork() != 0) _exit(0);
      setsid();
      signal(SIGPIPE, SIG_IGN);
      int null = open("/dev/null", O_RDWR);
      for (int fd = 0; fd < 3; fd++) dup2(null, fd);
      /* The command's other descriptors stay the command's alone. */
      long limit = sysconf(_SC_OPEN_MAX);
      if (limit < 0 || limit > 65536) limit = 65536;
      for (int fd = 3; fd < limit; fd++) if (fd != listener) close(fd);
      for (int i = 0; i < MAX_CONNECTIONS; i++) connections[i].client = -1;
      serve(listener, argv[2], hello);
      _exit(0);
    }
    if (child > 0) waitpid(child, NULL, 0);
    close(listener);
  }
  execvp(argv[5], argv + 5);
  fprintf(stderr, "aeven-egress-relay: cannot run %s: %s\n", argv[5], strerror(errno));
  return 127;
}
