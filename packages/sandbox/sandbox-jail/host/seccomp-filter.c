/*
 * Writes the Aeven sandbox jail's system-call filter as a BPF program for
 * `bwrap --seccomp`. Everything not listed is allowed; the jail's namespaces,
 * dropped capabilities, no_new_privs and Landlock remain the main barriers,
 * and this filter removes kernel surface that confined commands never need.
 *
 * Build: cc -O2 -o seccomp-filter seccomp-filter.c -lseccomp
 * Run:   ./seccomp-filter /opt/aeven-sandbox/seccomp.bpf
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <seccomp.h>
#include <stdio.h>
#include <unistd.h>

#define DENY(ctx, name) rule((ctx), SCMP_ACT_ERRNO(EPERM), SCMP_SYS(name), #name)
#define ABSENT(ctx, name) rule((ctx), SCMP_ACT_ERRNO(ENOSYS), SCMP_SYS(name), #name)

static int rule(scmp_filter_ctx ctx, uint32_t action, int nr, const char *name) {
  /* A syscall this architecture lacks resolves negative and needs no rule. */
  if (nr < 0) return 0;
  int rc = seccomp_rule_add(ctx, action, nr, 0);
  if (rc != 0) fprintf(stderr, "seccomp-filter: %s: %d\n", name, rc);
  return rc;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: seccomp-filter <output.bpf>\n");
    return 2;
  }
  scmp_filter_ctx ctx = seccomp_init(SCMP_ACT_ALLOW);
  if (ctx == NULL) return 1;
  int rc = 0;
  /* Mounts, namespaces and root changes: the jail is already built. */
  rc |= DENY(ctx, mount); rc |= DENY(ctx, umount2); rc |= DENY(ctx, pivot_root); rc |= DENY(ctx, chroot);
  rc |= DENY(ctx, unshare); rc |= DENY(ctx, setns);
  rc |= DENY(ctx, open_tree); rc |= DENY(ctx, move_mount); rc |= DENY(ctx, fsopen); rc |= DENY(ctx, fsconfig);
  rc |= DENY(ctx, fsmount); rc |= DENY(ctx, fspick); rc |= DENY(ctx, mount_setattr);
  /* Inspecting or controlling other processes and the kernel. */
  rc |= DENY(ctx, ptrace); rc |= DENY(ctx, process_vm_readv); rc |= DENY(ctx, process_vm_writev);
  rc |= DENY(ctx, bpf); rc |= DENY(ctx, perf_event_open); rc |= DENY(ctx, userfaultfd);
  rc |= DENY(ctx, keyctl); rc |= DENY(ctx, add_key); rc |= DENY(ctx, request_key);
  rc |= DENY(ctx, init_module); rc |= DENY(ctx, finit_module); rc |= DENY(ctx, delete_module);
  rc |= DENY(ctx, kexec_load); rc |= DENY(ctx, kexec_file_load); rc |= DENY(ctx, reboot);
  rc |= DENY(ctx, swapon); rc |= DENY(ctx, swapoff); rc |= DENY(ctx, acct); rc |= DENY(ctx, syslog);
  rc |= DENY(ctx, open_by_handle_at); rc |= DENY(ctx, name_to_handle_at); rc |= DENY(ctx, fanotify_init);
  rc |= DENY(ctx, quotactl); rc |= DENY(ctx, vhangup); rc |= DENY(ctx, personality);
  /* Absent rather than denied, so runtimes fall back to plain system calls. */
  rc |= ABSENT(ctx, io_uring_setup); rc |= ABSENT(ctx, io_uring_enter); rc |= ABSENT(ctx, io_uring_register);
  rc |= ABSENT(ctx, clone3);
  /* clone() may not create namespaces either: one rule per flag, matching when that bit is set. */
  const scmp_datum_t namespaces[] = {
    CLONE_NEWNS, CLONE_NEWUSER, CLONE_NEWPID, CLONE_NEWNET, CLONE_NEWIPC, CLONE_NEWUTS, CLONE_NEWCGROUP,
  };
  for (size_t i = 0; i < sizeof namespaces / sizeof namespaces[0]; i++) {
    rc |= seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EPERM), SCMP_SYS(clone), 1,
      SCMP_A0(SCMP_CMP_MASKED_EQ, namespaces[i], namespaces[i]));
  }
  if (rc != 0) {
    seccomp_release(ctx);
    return 1;
  }
  int fd = open(argv[1], O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) {
    perror("seccomp-filter");
    seccomp_release(ctx);
    return 1;
  }
  rc = seccomp_export_bpf(ctx, fd);
  close(fd);
  seccomp_release(ctx);
  return rc == 0 ? 0 : 1;
}
