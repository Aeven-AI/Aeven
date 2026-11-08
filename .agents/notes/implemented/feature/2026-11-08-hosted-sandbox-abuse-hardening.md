# Agent Note: Hardening the hosted sandbox against one account's abuse

Status: implemented

English | [中文](2026-11-08-hosted-sandbox-abuse-hardening.zh.md)

## Problem

Hosted Aeven Web runs commands for the public, so one account must not be able to degrade the machine or other accounts. An audit of the jail found four ways it could:

- Command output beyond the in-memory tail spilled to a file in the Host's temp directory, up to 64 MiB per stream, kept until the Host exits. On pink that directory sits on the 45 GB root disk shared with Mongo, outside every account's disk quota, and jailed commands cannot read the file anyway.
- The cgroups limited CPU, memory, and processes but not disk I/O, so one account could saturate the disk the Host and Mongo use.
- The shared Python zygote used `select()`, which fails beyond descriptor 1023, and did not contain accept or fork errors. On pink, 1150 idle connections from one jail ended it with `ValueError: filedescriptor out of range in select()`, and five such ends within a minute left it down until the Host restarted, so every account's Python paid its import cost again.
- The system-call filter allowed every socket family, including `AF_ALG`, `AF_VSOCK`, and audit netlink, whose kernel code confined commands never need.

## Decision

- `avn-bash-local` gains `spillOutput` (default true); the hosted patch turns it off, so long output keeps its in-memory tail and the model is told to redirect output to a file in the working directory to read all of it.
- `avn-sandbox-jail` limits gain an optional `ioMax`, written to `io.max` for the whole disk holding `accountsRoot` with the `io` controller enabled. The disk holding the accounts also holds Mongo and reaches about 165 MB/s sequential write and 309 MB/s read on pink, so the hosted patch gives all jails together 40 MiB/s write, 80 MiB/s read, 1000 write and 3000 read IOPS, about a quarter of the disk, and each account 10 MiB/s write, 30 MiB/s read, 300 write and 1000 read IOPS. Measured on pink's `loop2` with a 50 MiB/s write and 100 MiB/s read limit, a direct write ran at 55.6 MB/s, a buffered write with fsync at 33.9 MB/s, and a direct read at 111 MB/s, against 2.3 GB/s unlimited.
- The zygote waits with epoll, answers `F` to any connection beyond eight waiting per account or 256 in total, answers `F` when planning or forking fails, and survives any one request's error. The shim runs the real interpreter when the connection ends before the run started. A zygote that keeps ending restarts after five minutes instead of staying down. On pink, the new zygote held 3000 connections from one account while a caller in another cgroup was answered in 0.4 ms. The hosted zygote's own group is capped at four CPUs.
- The filter allows only `AF_UNIX`, `AF_INET`, `AF_INET6`, and routing netlink, refuses socketpair outside `AF_UNIX`, and is compiled as a binary tree. A syscall in a Python loop cost 291 ns against 279 ns before.

## Alternatives considered

Deleting spill files when a command settles was rejected for hosted Hosts: the model there cannot read the Host's temp directory, so the files serve nobody. Spilling into the account folder would charge the quota but needs a per-call directory the executor does not know.

`io.weight` was rejected: it only takes effect with the BFQ scheduler or `io.cost` configured, while `io.max` works on any block device, including the loop device holding the accounts.

## Consequences

Updating the seccomp filter or the shim requires rebuilding them on the Host (`seccomp-filter.c`, `install-python-zygote.sh`) before the restart. Per-user kernel counters, such as inotify instances, are still shared by every account through the one sandbox user, and the shared kernel remains the barrier against an escalation; both are recorded in the `avn-sandbox-jail` README's limitations.
