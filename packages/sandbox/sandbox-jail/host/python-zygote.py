"""Preloaded Python interpreter that runs jailed `python3` commands without paying their imports.

The sandbox-jail provider starts this process once, outside every jail, in its own cgroup. It imports the
configured modules, then serves a SOCK_SEQPACKET socket whose directory each jail mounts. The `python3` shim in a
jail sends its argv, environment, umask, and open descriptors; for each connection this process forks a helper
that identifies the caller by the socket's peer pidfd, moves itself into the caller's account cgroup, joins the
caller's user, mount, IPC, UTS, network, cgroup, and PID namespaces, and forks the run. The run drops every
capability, sets no_new_privs, installs the same Landlock rules the jail's launcher installs (read beneath `/`;
write to `/dev/null`, `/dev/shm`, and, when the jail mounts writable roots, `/tmp` and those roots, read from the
jail's own mount table), loads the jail's seccomp filter, and executes the program as `python3` would. Nothing
security-relevant is taken from the request: the namespaces, cgroup, and writable roots all come from the kernel's
view of the caller. A request this interpreter cannot reproduce exactly is answered `F`, and the shim executes
`/usr/bin/python3` instead.

Protocol (one connection per run): the shim sends one message `AVNZ1\\0`, umask, argc, envc, fd count (u32 each),
the descriptor numbers (u32 each), then NUL-terminated argv and environment strings, carrying the cwd descriptor
followed by the listed descriptors as SCM_RIGHTS. This process answers `F` (run the real interpreter), or `P` and
the run's pid in the caller's PID namespace, then `X`, a kind (0 exit status, 1 signal), and the value.
"""

import array
import atexit
import ctypes
import json
import os
import re
import runpy
import selectors
import signal
import site
import socket
import struct
import sys
import tempfile
import threading
import time
import traceback
import types

MAGIC = b'AVNZ1\0'
MAX_MESSAGE = 512 * 1024
MAX_FDS = 250
# Seconds a connected shim has to send its request.
REQUEST_TIMEOUT = 2
# Connections awaiting their request, per account and in total; a connection beyond either is answered `F` at once,
# so one account flooding the socket sends only its own runs to the real interpreter.
MAX_PENDING_PER_ACCOUNT = 8
MAX_PENDING = 256
SO_PEERPIDFD = 77
NAMESPACES = (os.CLONE_NEWUSER | os.CLONE_NEWNS | os.CLONE_NEWIPC | os.CLONE_NEWUTS | os.CLONE_NEWNET
              | os.CLONE_NEWCGROUP | os.CLONE_NEWPID)

# Landlock filesystem rights, by the ABI that introduced them; the launcher handles these through ABI 5.
LL_EXECUTE, LL_WRITE_FILE, LL_READ_FILE, LL_READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
LL_ABI1 = (1 << 13) - 1
LL_REFER, LL_TRUNCATE, LL_IOCTL_DEV = 1 << 13, 1 << 14, 1 << 15
LL_FILE_RIGHTS = LL_EXECUTE | LL_WRITE_FILE | LL_READ_FILE | LL_TRUNCATE | LL_IOCTL_DEV
SYS_LANDLOCK_CREATE_RULESET, SYS_LANDLOCK_ADD_RULE, SYS_LANDLOCK_RESTRICT_SELF = 444, 445, 446

PR_SET_PDEATHSIG, PR_SET_SECCOMP, PR_CAPBSET_DROP, PR_SET_NO_NEW_PRIVS, PR_CAP_AMBIENT = 1, 22, 24, 38, 47
PR_CAP_AMBIENT_CLEAR_ALL, SECCOMP_MODE_FILTER = 4, 2

# Interpreter flags a run reproduces; any other flag runs the real interpreter.
FLAGS = set('uBs')
# Environment variables a preloaded interpreter cannot honour after its imports.
PINNED_PREFIXES = ('LANG', 'LC_', 'OPENBLAS_', 'OMP_', 'MKL_', 'NUMEXPR_', 'MPL')
ALLOWED_PYTHON_VARS = {'PYTHONDONTWRITEBYTECODE', 'PYTHONUNBUFFERED'}

libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long
libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]


def check(result, what):
    """Raise OSError with errno when a libc call returned a negative value."""
    if result < 0:
        err = ctypes.get_errno()
        raise OSError(err, f'{what}: {os.strerror(err)}')
    return result


def log(message):
    sys.stderr.write(f'python-zygote: {message}\n')
    sys.stderr.flush()


def pidfd_pid(pidfd):
    """The pid a pidfd refers to, or -1 once that process has exited."""
    with open(f'/proc/self/fdinfo/{pidfd}') as info:
        for line in info:
            if line.startswith('Pid:'):
                return int(line.split()[1])
    return -1


def plan(argv, env, stdin_fd, pinned, preloaded):
    """How a run reproduces `python3 argv[1:]`, or None when only the real interpreter can.

    Returns (mode, value, args, unbuffered) with mode one of 'script', 'code', 'module', 'stdin'.
    """
    for key, value in env.items():
        if key.startswith('PYTHON') and key not in ALLOWED_PYTHON_VARS:
            return None
        if key.startswith(PINNED_PREFIXES) and pinned.get(key) != value:
            return None
    for key, value in pinned.items():
        if key.startswith(PINNED_PREFIXES) and env.get(key) != value:
            return None
    unbuffered = env.get('PYTHONUNBUFFERED', '') != ''
    rest = argv[1:]
    while rest and rest[0].startswith('-') and rest[0] not in ('-', '-c', '-m') and not rest[0].startswith('--'):
        letters = rest[0][1:]
        if letters == '' or not set(letters) <= FLAGS:
            return None
        unbuffered = unbuffered or 'u' in letters
        rest = rest[1:]
    if not rest:
        # An interactive session needs the real interpreter's prompt and line editing.
        return None if stdin_fd >= 0 and os.isatty(stdin_fd) else ('stdin', None, [''], unbuffered)
    head = rest[0]
    if head == '-c' or head == '-m':
        if len(rest) < 2:
            return None
        if head == '-c' and not any(re.search(rf'\b{re.escape(name)}\b', rest[1]) for name in preloaded):
            # Code that names no preloaded module starts faster in the real interpreter.
            return None
        return ('code' if head == '-c' else 'module', rest[1], [head, *rest[2:]], unbuffered)
    if head == '-':
        return ('stdin', None, rest, unbuffered)
    if head.startswith('-') or not head.endswith('.py'):
        # A directory, archive, or extensionless script runs through the real interpreter's own lookup.
        return None
    return ('script', head, rest, unbuffered)


def writable_roots():
    """Workspace roots the jail mounts writable: read-write mounts other than its tmpfs, /dev, and /proc."""
    roots = []
    with open('/proc/self/mountinfo') as table:
        for line in table:
            fields = line.split()
            point = fields[4].replace('\\040', ' ')
            options = fields[5].split(',')
            if point in ('/', '/tmp', '/dev/shm', '/dev', '/proc') or point.startswith(('/dev/', '/proc/', '/run/aeven')):
                continue
            if 'rw' in options:
                roots.append(point)
    return roots


def landlock():
    """Install the jail launcher's Landlock rules on this process."""
    abi = check(libc.syscall(SYS_LANDLOCK_CREATE_RULESET, None, ctypes.c_size_t(0), ctypes.c_uint32(1)), 'landlock abi')
    handled = LL_ABI1 | (LL_REFER if abi >= 2 else 0) | (LL_TRUNCATE if abi >= 3 else 0) | (LL_IOCTL_DEV if abi >= 5 else 0)
    attr = ctypes.c_uint64(handled)
    ruleset = check(libc.syscall(SYS_LANDLOCK_CREATE_RULESET, ctypes.byref(attr), ctypes.c_size_t(8), ctypes.c_uint32(0)), 'landlock ruleset')
    roots = writable_roots()
    grants = [('/', (LL_EXECUTE | LL_READ_FILE | LL_READ_DIR) & handled), ('/dev/null', handled), ('/dev/shm', handled)]
    if roots:
        grants += [(path, handled) for path in ['/tmp', *roots]]
    for path, access in grants:
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
        try:
            if not os.path.isdir(f'/proc/self/fd/{fd}'):
                access &= LL_FILE_RIGHTS
            rule = struct.pack('=Qi', access, fd)
            buffer = ctypes.create_string_buffer(rule, len(rule))
            check(libc.syscall(SYS_LANDLOCK_ADD_RULE, ctypes.c_int(ruleset), ctypes.c_int(1), buffer, ctypes.c_uint32(0)), f'landlock rule {path}')
        finally:
            os.close(fd)
    check(libc.syscall(SYS_LANDLOCK_RESTRICT_SELF, ctypes.c_int(ruleset), ctypes.c_uint32(0)), 'landlock restrict')
    os.close(ruleset)


def drop_capabilities():
    """Leave the run with no capabilities in the joined user namespace, as bubblewrap leaves a command."""
    with open('/proc/sys/kernel/cap_last_cap') as last:
        top = int(last.read())
    for cap in range(top + 1):
        check(libc.prctl(PR_CAPBSET_DROP, cap, 0, 0, 0), 'drop bounding capability')
    check(libc.prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0), 'clear ambient capabilities')
    header = struct.pack('=Ii', 0x20080522, 0)
    data = bytes(24)
    check(libc.capset(ctypes.create_string_buffer(header, 8), ctypes.create_string_buffer(data, 24)), 'capset')


class SockFprog(ctypes.Structure):
    _fields_ = [('len', ctypes.c_ushort), ('filter', ctypes.c_void_p)]


def load_seccomp(program):
    """Install the jail's system-call filter; no_new_privs is already set."""
    buffer = ctypes.create_string_buffer(program, len(program))
    prog = SockFprog(len(program) // 8, ctypes.addressof(buffer))
    check(libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.addressof(prog), 0, 0), 'seccomp')


def place_descriptors(received, cwd_fd, keep):
    """Give the run exactly the caller's descriptors at their numbers, and the caller's directory."""
    os.fchdir(cwd_fd)
    os.close(cwd_fd)
    top = max([number for number, _ in received] + [fd for _, fd in received] + list(keep) + [2]) + 1
    moved = []
    for number, fd in received:
        high = os.dup2(fd, top + len(moved), inheritable=True) if fd < top else fd
        if high != fd:
            os.close(fd)
        moved.append((number, high))
    wanted = {number for number, _ in moved} | set(keep) | {high for _, high in moved}
    for fd in [int(name) for name in os.listdir('/proc/self/fd')]:
        if fd not in wanted:
            try:
                os.close(fd)
            except OSError:
                # The listing's own descriptor closed itself once listdir returned.
                pass
    for number, high in moved:
        os.dup2(high, number, inheritable=True)
        os.close(high)
    for number in set(range(3)) - {n for n, _ in moved}:
        null = os.open('/dev/null', os.O_RDWR)
        if null != number:
            os.dup2(null, number)
            os.close(null)


def report(kind, value, tb):
    """Print an uncaught exception as the real interpreter would, without this file's and runpy's frames."""
    while tb is not None and tb.tb_frame.f_code.co_filename in (__file__, runpy.__file__):
        tb = tb.tb_next
    sys.excepthook(kind, value.with_traceback(tb), tb)


def finish(code):
    """Interpreter shutdown: join threads, run exit handlers, flush the standard streams; returns the exit status."""
    try:
        threading._shutdown()
    except BaseException:
        traceback.print_exc()
    atexit._run_exitfuncs()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except BaseException:
            code = code or 120
    return code


def execute(planned, env):
    """Run the planned program as `python3` would, then end the process with its status."""
    mode, value, args, unbuffered = planned
    os.environ.clear()
    os.environ.update(env)
    tempfile.tempdir = None
    if 'numpy' in sys.modules:
        sys.modules['numpy'].random.seed()
    sys.stdout.reconfigure(line_buffering=os.isatty(1), write_through=unbuffered)
    sys.stderr.reconfigure(write_through=unbuffered)
    sys.argv = list(args)
    sys.path.pop(0)
    if mode == 'script':
        sys.path.insert(0, os.path.dirname(os.path.realpath(value)))
    elif mode == 'module':
        sys.path.insert(0, os.getcwd())
    else:
        sys.path.insert(0, '')
    if 'aeven_user_site' in sys.modules:
        # As aeven_user_site.py does at an interpreter's start, for this run's own home.
        os.environ.setdefault('PIP_PREFIX', os.path.join(os.path.expanduser('~'), '.local'))
    if site.ENABLE_USER_SITE or 'aeven_user_site' in sys.modules:
        site.USER_BASE = None
        site.USER_SITE = None
        if os.path.isdir(site.getusersitepackages()):
            site.addsitedir(site.getusersitepackages())
    code = 0
    try:
        if mode == 'script':
            # As the interpreter runs a script: `__file__` absolute, `sys.argv[0]` as written.
            path = os.path.abspath(value)
            with open(path, 'rb') as script:
                source = script.read()
            main = types.ModuleType('__main__')
            main.__file__ = path
            main.__cached__ = None
            main.__builtins__ = __builtins__
            sys.modules['__main__'] = main
            exec(compile(source, path, 'exec'), main.__dict__)
        elif mode == 'module':
            runpy._run_module_as_main(value, alter_argv=True)
        else:
            main = types.ModuleType('__main__')
            main.__builtins__ = __builtins__
            sys.modules['__main__'] = main
            source = value if mode == 'code' else sys.stdin.read()
            exec(compile(source, '<string>' if mode == 'code' else '<stdin>', 'exec'), main.__dict__)
    except SystemExit as exit_:
        status = exit_.code
        if status is None:
            code = 0
        elif isinstance(status, int):
            code = status & 0xff
        else:
            print(status, file=sys.stderr)
            code = 1
    except KeyboardInterrupt:
        # The real interpreter ends by the signal itself after its traceback, so the caller sees SIGINT.
        report(*sys.exc_info())
        finish(0)
        signal.signal(signal.SIGINT, signal.SIG_DFL)
        os.kill(os.getpid(), signal.SIGINT)
        code = 130
    except BaseException:
        report(*sys.exc_info())
        code = 1
    os._exit(finish(code))


def receive(conn, pinned, preloaded):
    """Read and plan one request; returns (planned, env, umask, cwd_fd, received), or None to answer `F`.

    Descriptors the request carried are closed when it is refused.
    """
    message, ancillary, _flags, _addr = conn.recvmsg(MAX_MESSAGE, socket.CMSG_SPACE((MAX_FDS + 1) * 4))
    fds = array.array('i')
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            fds.frombytes(data[:len(data) - (len(data) % fds.itemsize)])
    planned = None
    try:
        if message.startswith(MAGIC) and len(fds) >= 1 and len(message) >= len(MAGIC) + 16:
            umask, argc, envc, count = struct.unpack_from('=4I', message, len(MAGIC))
            offset = len(MAGIC) + 16
            strings = message[offset + 4 * count:].split(b'\0') if len(message) >= offset + 4 * count else []
            if len(fds) == count + 1 and len(strings) >= argc + envc:
                numbers = list(struct.unpack_from(f'={count}I', message, offset))
                argv = [item.decode('utf-8', 'surrogateescape') for item in strings[:argc]]
                env = dict(item.decode('utf-8', 'surrogateescape').partition('=')[::2] for item in strings[argc:argc + envc])
                received = list(zip(numbers, fds[1:]))
                stdin_fd = dict(received).get(0, -1)
                planned = plan(argv, env, stdin_fd, pinned, preloaded)
                if planned is not None:
                    return planned, env, umask, fds[0], received
    except (struct.error, ValueError, OSError):
        planned = None
    for fd in fds:
        os.close(fd)
    return None


# Whether this helper has told the shim that its run started; until then any failure answers `F`.
STATE = {'started': False}


def refuse(conn):
    """Tell the shim to run the real interpreter; returns the helper's exit status."""
    try:
        conn.sendall(b'F')
    except OSError:
        # The shim is gone; its command ended without a run.
        pass
    return 0


def run(conn, config, seccomp, request):
    """The helper's work for one planned connection; returns the helper's exit status."""
    planned, env, umask, cwd_fd, received = request
    pidfd = conn.getsockopt(socket.SOL_SOCKET, SO_PEERPIDFD)

    # The caller is the jailed process that connected, identified by the kernel and still alive.
    pid = pidfd_pid(pidfd)
    if pid <= 0:
        return refuse(conn)
    with open(f'/proc/{pid}/cgroup') as cgroup_file:
        cgroup = cgroup_file.read().strip().split('::', 1)[-1]
    jailed = os.stat(f'/proc/{pid}/ns/user').st_ino != os.stat('/proc/self/ns/user').st_ino
    # Still alive after the reads, so the pid was not reused by another process in between.
    if pidfd_pid(pidfd) != pid or not jailed:
        return refuse(conn)
    group = '/sys/fs/cgroup' + cgroup
    if os.path.dirname(group) != config['accountsCgroup'] or not os.path.basename(group).startswith('acct-'):
        log(f'refused a caller outside the account cgroups: {cgroup}')
        return refuse(conn)
    try:
        with open(os.path.join(group, 'cgroup.procs'), 'w') as procs:
            procs.write('0')
    except OSError as error:
        log(f'cannot join {group}: {error}')
        return refuse(conn)
    os.setns(pidfd, NAMESPACES)
    os.close(pidfd)

    ready_read, ready_write = os.pipe()
    child = os.fork()
    if child == 0:
        try:
            os.close(ready_read)
            conn.close()
            os.setsid()
            check(libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0), 'parent death signal')
            place_descriptors(received, cwd_fd, keep={ready_write})
            os.umask(umask)
            drop_capabilities()
            check(libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0), 'no_new_privs')
            landlock()
            load_seccomp(seccomp)
            os.write(ready_write, struct.pack('=I', os.getpid()))
            os.close(ready_write)
        except BaseException:
            traceback.print_exc()
            os._exit(126)
        execute(planned, env)
        os._exit(1)

    os.close(ready_write)
    os.close(cwd_fd)
    for _, fd in received:
        os.close(fd)
    started = os.read(ready_read, 4)
    os.close(ready_read)
    if len(started) == 4:
        conn.sendall(b'P' + started)
        STATE['started'] = True
    child_fd = os.pidfd_open(child)
    waiter = selectors.DefaultSelector()
    waiter.register(conn, selectors.EVENT_READ)
    waiter.register(child_fd, selectors.EVENT_READ)
    while True:
        readable = {key.fileobj for key, _ in waiter.select()}
        if child_fd in readable:
            break
        if conn in readable and conn.recv(16) == b'':
            # The shim ended, so its command did; the run goes with it.
            os.kill(child, signal.SIGKILL)
            break
    _, status = os.waitpid(child, 0)
    if len(started) == 4:
        kind, value = (1, os.WTERMSIG(status)) if os.WIFSIGNALED(status) else (0, os.waitstatus_to_exitcode(status))
        try:
            conn.sendall(b'X' + struct.pack('=II', kind, value))
        except OSError:
            # The shim is gone; nobody reads the status.
            pass
    else:
        refuse(conn)
    return 0


def caller_account(conn):
    """The cgroup name of a connected peer, such as `acct-<id>`, or None when its process cannot be read."""
    pid = struct.unpack('=iII', conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('=iII')))[0]
    try:
        with open(f'/proc/{pid}/cgroup') as cgroup_file:
            return os.path.basename(cgroup_file.read().strip().split('::', 1)[-1])
    except OSError:
        # The peer already exited; its connection is answered like any other.
        return None


def answer_fallback(conn):
    """Answer `F` and close: the shim then runs the real interpreter."""
    try:
        conn.setblocking(False)
        conn.sendall(b'F')
    except OSError:
        # The shim is gone or its buffer is full; it falls back when the connection closes before a run starts.
        pass
    conn.close()


def serve(conn, config, seccomp, preloaded, inherited):
    """Plan one connection whose request arrived and fork its helper; every failure answers `F`.

    `inherited` holds the listener, the selector, and the other pending connections, which the helper closes.
    """
    request = None
    try:
        request = receive(conn, config['pinned'], preloaded)
        if request is None:
            answer_fallback(conn)
            return
        helper = os.fork()
    except OSError as error:
        # A failed fork, such as EAGAIN at the zygote group's pids.max, sends this run to the real interpreter.
        log(f'cannot serve a request: {error}')
        answer_fallback(conn)
        if request is not None:
            for fd in [request[3], *(fd for _, fd in request[4])]:
                os.close(fd)
        return
    if helper == 0:
        status = 1
        try:
            for item in inherited:
                item.close()
            signal.signal(signal.SIGCHLD, signal.SIG_DFL)
            conn.setblocking(True)
            status = run(conn, config, seccomp, request)
        except BaseException:
            traceback.print_exc()
            if not STATE['started']:
                status = refuse(conn)
        os._exit(status)
    conn.close()
    for fd in [request[3], *(fd for _, fd in request[4])]:
        os.close(fd)


def main():
    config = json.loads(sys.argv[1])
    with open(config['seccompFilter'], 'rb') as filter_file:
        seccomp = filter_file.read()
    for name in config['preload']:
        __import__(name)
    preloaded = sorted({name.split('.')[0] for name in config['preload']})
    import gc
    gc.collect()
    gc.freeze()
    path = config['socket']
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    listener.bind(path)
    os.chmod(path, 0o600)
    listener.listen(128)
    listener.setblocking(False)
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    # epoll has no descriptor-number ceiling, unlike select().
    selector = selectors.DefaultSelector()
    selector.register(listener, selectors.EVENT_READ)
    log(f'ready with {", ".join(config["preload"]) or "no modules"}')
    # Connections whose request has not arrived yet: the time each must arrive by, and its account.
    pending = {}
    per_account = {}

    def forget(conn):
        _, account = pending.pop(conn)
        selector.unregister(conn)
        left = per_account[account] - 1
        if left > 0:
            per_account[account] = left
        else:
            del per_account[account]

    while True:
        now = time.monotonic()
        for conn, (deadline, _) in list(pending.items()):
            if deadline <= now:
                forget(conn)
                conn.close()
        timeout = max(0.0, min(deadline for deadline, _ in pending.values()) - now) if pending else None
        for key, _ in selector.select(timeout):
            ready = key.fileobj
            if ready is listener:
                try:
                    conn, _ = listener.accept()
                except BlockingIOError:
                    continue
                except OSError as error:
                    # EMFILE or ENFILE: the connection stays queued; pause instead of spinning on the ready listener.
                    log(f'cannot accept: {error}')
                    time.sleep(0.05)
                    continue
                try:
                    account = caller_account(conn)
                except OSError:
                    conn.close()
                    continue
                if len(pending) >= MAX_PENDING or per_account.get(account, 0) >= MAX_PENDING_PER_ACCOUNT:
                    answer_fallback(conn)
                    continue
                conn.setblocking(False)
                pending[conn] = (time.monotonic() + REQUEST_TIMEOUT, account)
                per_account[account] = per_account.get(account, 0) + 1
                selector.register(conn, selectors.EVENT_READ)
                continue
            forget(ready)
            try:
                serve(ready, config, seccomp, preloaded, [listener, selector, *pending])
            except Exception:
                # One malformed request must not end the interpreter every account's runs share.
                traceback.print_exc()
                answer_fallback(ready)

if __name__ == '__main__':
    main()
