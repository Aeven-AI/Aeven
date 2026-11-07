/*
 * Runs one command as the sandbox user, so a jailed command never holds the Host user's credentials. The Host user
 * alone may execute this file (root:<host group> 0750), which carries only cap_setuid and cap_setgid.
 *
 * The process stays under the Host user so the Host signals it as before, and forks a waiter that takes the sandbox
 * user's uid, gid, and groups and drops every capability. The waiter starts argv[1..] and relays to it each signal
 * the Host sends, read from a pipe whose write end only this process holds; when this process ends, even by SIGKILL,
 * the pipe closes and the waiter kills the command. A parent-death signal cannot do this: executing bubblewrap changes
 * its AppArmor domain, which clears that signal. The Host user may not signal the sandbox user's processes itself.
 * Every process ends with the command's status.
 *
 * Build: cc -O2 -Wall -DSANDBOX_USER='"aeven-sandbox"' -o aeven-sandbox-exec sandbox-exec.c
 * Install: install -o root -g aeven-hosted -m 0750 aeven-sandbox-exec /usr/local/libexec/
 *          setcap cap_setuid,cap_setgid=ep /usr/local/libexec/aeven-sandbox-exec
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/capability.h>
#include <poll.h>
#include <pwd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef SANDBOX_USER
#define SANDBOX_USER "aeven-sandbox"
#endif

/* The exit status a launch failure reports, with a stderr line the jail's runner-failure rules recognise. */
#define EXIT_LAUNCH_FAILURE 125

/* Signals the Host may send that the command receives in turn. */
static const int RELAYED[] = { SIGTERM, SIGINT, SIGHUP, SIGQUIT, SIGUSR1, SIGUSR2, SIGCONT, SIGWINCH, SIGALRM };
#define RELAYED_COUNT (sizeof RELAYED / sizeof RELAYED[0])

static int relay_fd = -1;

static void fail(const char *what) {
  fprintf(stderr, "aeven-sandbox-exec: %s: %s\n", what, strerror(errno));
  _exit(EXIT_LAUNCH_FAILURE);
}

/* Clear the effective, permitted, and inheritable sets and the ambient set. */
static void drop_capabilities(void) {
  prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0);
  struct __user_cap_header_struct header = { .version = _LINUX_CAPABILITY_VERSION_3, .pid = 0 };
  struct __user_cap_data_struct data[2];
  memset(data, 0, sizeof data);
  if (syscall(SYS_capset, &header, data) != 0) fail("drop capabilities");
}

/* In the Host-side process: pass the signal to the waiter, which delivers it to the command. */
static void relay(int sig) {
  unsigned char byte = (unsigned char)sig;
  ssize_t ignored = write(relay_fd, &byte, 1);
  (void)ignored;
}

/* End this process the way the command ended. */
static void end_like(int status) {
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    kill(getpid(), WTERMSIG(status));
    _exit(128 + WTERMSIG(status));
  }
  _exit(WIFEXITED(status) ? WEXITSTATUS(status) : EXIT_LAUNCH_FAILURE);
}

static int wait_for(pid_t pid) {
  int status;
  for (;;) {
    if (waitpid(pid, &status, 0) == pid) return status;
    if (errno != EINTR) fail("waitpid");
  }
}

/* The waiter, under the sandbox user: start the command, relay signals, kill it when the Host-side process ends. */
static void waiter(int relay_read, char **argv) {
  pid_t command = fork();
  if (command < 0) fail("fork");
  if (command == 0) {
    close(relay_read);
    for (size_t i = 0; i < RELAYED_COUNT; i++) signal(RELAYED[i], SIG_DFL);
    execv(argv[0], argv);
    fail(argv[0]);
  }
  int exited = (int)syscall(SYS_pidfd_open, command, 0);
  if (exited < 0) fail("pidfd_open");
  struct pollfd watch[2] = { { .fd = exited, .events = POLLIN }, { .fd = relay_read, .events = POLLIN } };
  for (;;) {
    if (poll(watch, 2, -1) < 0) {
      if (errno == EINTR) continue;
      fail("poll");
    }
    if (watch[0].revents != 0) end_like(wait_for(command));
    if (watch[1].revents == 0) continue;
    unsigned char byte;
    ssize_t got = read(relay_read, &byte, 1);
    if (got == 1) {
      kill(command, byte);
      continue;
    }
    if (got == 0) {
      /* The Host-side process is gone, so the call that started this command is over. */
      kill(command, SIGKILL);
      end_like(wait_for(command));
    }
  }
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: aeven-sandbox-exec <program> [args...]\n");
    return 2;
  }
  errno = 0;
  struct passwd *user = getpwnam(SANDBOX_USER);
  if (user == NULL) fail("no user " SANDBOX_USER);
  if (user->pw_uid == 0 || user->pw_uid == getuid()) {
    errno = EINVAL;
    fail("the sandbox user must differ from root and from the caller");
  }
  int pipefd[2];
  if (pipe2(pipefd, O_CLOEXEC) != 0) fail("pipe");
  pid_t child = fork();
  if (child < 0) fail("fork");
  if (child == 0) {
    close(pipefd[1]);
    gid_t gid = user->pw_gid;
    if (setgroups(1, &gid) != 0) fail("setgroups");
    if (setresgid(gid, gid, gid) != 0) fail("setresgid");
    if (setresuid(user->pw_uid, user->pw_uid, user->pw_uid) != 0) fail("setresuid");
    drop_capabilities();
    for (size_t i = 0; i < RELAYED_COUNT; i++) signal(RELAYED[i], SIG_IGN);
    waiter(pipefd[0], argv + 1);
  }
  close(pipefd[0]);
  drop_capabilities();
  relay_fd = pipefd[1];
  struct sigaction action = { .sa_handler = relay, .sa_flags = SA_RESTART };
  sigemptyset(&action.sa_mask);
  for (size_t i = 0; i < RELAYED_COUNT; i++) sigaction(RELAYED[i], &action, NULL);
  end_like(wait_for(child));
}
