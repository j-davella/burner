#!/usr/bin/env python3
"""
burner_bridge.py - serial <-> WebSocket bridge for Burner (GRBL laser sender).

Stdlib only, no pip installs. Runs on Linux (NixOS included), Windows and macOS.
  Linux/macOS serial: termios.   Windows serial: Win32 API through ctypes.

Run:   python3 burner_bridge.py [--open] [--port 8765] [--sim-speed 1]
Open:  http://localhost:8765

Listens on 127.0.0.1 only. Rejects WebSocket connections from any page not
served by this bridge (and requests with a foreign Host header), so a random
website can't fire your laser. One client at a time. If the browser drops,
the bridge feed-holds and soft-resets GRBL (laser off, job killed) and closes
the port.

The port list always ends with "Simulator (no laser)": a fake GRBL 1.1 for
trying the UI or testing streaming without a machine.
"""
import argparse, asyncio, base64, glob, hashlib, json, os, re, struct, sys, threading, time, urllib.parse

HOST = "127.0.0.1"
PORT = int(os.environ.get("BURNER_PORT", "8765"))
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
IS_WIN = sys.platform.startswith("win")
SIM_PATH = "sim"
SIM_SPEED = 1.0

try:  # never crash on a port name the console can't print
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass


def say(*a):
    print(*a, flush=True)


# ======================= serial: Linux / macOS (termios) =======================
class PosixSerial:
    def __init__(self, path, baud, loop, on_data, on_close):
        import termios
        speed = getattr(termios, "B%d" % baud, None)
        if speed is None:
            raise ValueError("baud %d not supported on this system" % baud)
        self.path, self.loop, self.on_data, self.on_close = path, loop, on_data, on_close
        self.fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        try:
            a = termios.tcgetattr(self.fd)
            a[0] = 0                                                # iflag: raw
            a[1] = 0                                                # oflag: raw
            a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL | termios.HUPCL
            a[3] = 0                                                # lflag: no echo/canon/signals
            a[4] = a[5] = speed
            a[6][termios.VMIN] = 0
            a[6][termios.VTIME] = 0
            termios.tcsetattr(self.fd, termios.TCSANOW, a)
            termios.tcflush(self.fd, termios.TCIOFLUSH)
        except Exception:
            os.close(self.fd)
            raise
        self.wbuf = bytearray()
        self.closed = False
        loop.add_reader(self.fd, self._readable)

    def _readable(self):
        try:
            data = os.read(self.fd, 4096)
        except BlockingIOError:
            return
        except OSError as e:
            self.close("serial error: %s" % e.strerror)
            return
        if not data:
            self.close("device gone")
            return
        self.on_data(data)

    def write(self, data):
        if self.closed:
            return
        self.wbuf += data
        self._flush()

    def _flush(self):
        while self.wbuf:
            try:
                n = os.write(self.fd, self.wbuf)
            except BlockingIOError:
                self.loop.add_writer(self.fd, self._flush)
                return
            except OSError as e:
                self.close("write error: %s" % e.strerror)
                return
            del self.wbuf[:n]
        self.loop.remove_writer(self.fd)

    def close(self, why="closed"):
        if self.closed:
            return
        self.closed = True
        for f in (self.loop.remove_reader, self.loop.remove_writer):
            try:
                f(self.fd)
            except Exception:
                pass
        try:
            os.close(self.fd)
        except OSError:
            pass
        self.on_close(why)


def list_ports_posix():
    out, seen = [], set()
    for link in sorted(glob.glob("/dev/serial/by-id/*")):
        real = os.path.realpath(link)
        seen.add(real)
        out.append({"path": real, "label": "%s  (%s)" % (os.path.basename(real), os.path.basename(link))})
    pats = ["/dev/ttyUSB*", "/dev/ttyACM*", "/dev/cu.usbserial*", "/dev/cu.usbmodem*", "/dev/cu.wchusbserial*"]
    for p in sorted(sum((glob.glob(x) for x in pats), [])):
        if p not in seen:
            out.append({"path": p, "label": os.path.basename(p)})
    return out


# ======================= serial: Windows (Win32 via ctypes) =======================
if IS_WIN:
    import ctypes, queue, winreg
    from ctypes import wintypes as W

    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class _DCB(ctypes.Structure):
        _fields_ = [("DCBlength", W.DWORD), ("BaudRate", W.DWORD),
                    ("fBinary", W.DWORD, 1), ("fParity", W.DWORD, 1), ("fOutxCtsFlow", W.DWORD, 1),
                    ("fOutxDsrFlow", W.DWORD, 1), ("fDtrControl", W.DWORD, 2), ("fDsrSensitivity", W.DWORD, 1),
                    ("fTXContinueOnXoff", W.DWORD, 1), ("fOutX", W.DWORD, 1), ("fInX", W.DWORD, 1),
                    ("fErrorChar", W.DWORD, 1), ("fNull", W.DWORD, 1), ("fRtsControl", W.DWORD, 2),
                    ("fAbortOnError", W.DWORD, 1), ("fDummy2", W.DWORD, 17),
                    ("wReserved", W.WORD), ("XonLim", W.WORD), ("XoffLim", W.WORD),
                    ("ByteSize", W.BYTE), ("Parity", W.BYTE), ("StopBits", W.BYTE),
                    ("XonChar", ctypes.c_char), ("XoffChar", ctypes.c_char), ("ErrorChar", ctypes.c_char),
                    ("EofChar", ctypes.c_char), ("EvtChar", ctypes.c_char), ("wReserved1", W.WORD)]

    class _TIMEOUTS(ctypes.Structure):
        _fields_ = [("ReadIntervalTimeout", W.DWORD), ("ReadTotalTimeoutMultiplier", W.DWORD),
                    ("ReadTotalTimeoutConstant", W.DWORD), ("WriteTotalTimeoutMultiplier", W.DWORD),
                    ("WriteTotalTimeoutConstant", W.DWORD)]

    class _OVERLAPPED(ctypes.Structure):
        _fields_ = [("Internal", ctypes.c_void_p), ("InternalHigh", ctypes.c_void_p),
                    ("Offset", W.DWORD), ("OffsetHigh", W.DWORD), ("hEvent", W.HANDLE)]

    def _fn(name, res, *args):
        f = getattr(_k32, name)
        f.restype, f.argtypes = res, list(args)
        return f

    _CreateFileW = _fn("CreateFileW", W.HANDLE, W.LPCWSTR, W.DWORD, W.DWORD, W.LPVOID, W.DWORD, W.DWORD, W.HANDLE)
    _CloseHandle = _fn("CloseHandle", W.BOOL, W.HANDLE)
    _CreateEventW = _fn("CreateEventW", W.HANDLE, W.LPVOID, W.BOOL, W.BOOL, W.LPCWSTR)
    _ResetEvent = _fn("ResetEvent", W.BOOL, W.HANDLE)
    _ReadFile = _fn("ReadFile", W.BOOL, W.HANDLE, W.LPVOID, W.DWORD, ctypes.POINTER(W.DWORD), ctypes.POINTER(_OVERLAPPED))
    _WriteFile = _fn("WriteFile", W.BOOL, W.HANDLE, W.LPCVOID, W.DWORD, ctypes.POINTER(W.DWORD), ctypes.POINTER(_OVERLAPPED))
    _GetOverlappedResult = _fn("GetOverlappedResult", W.BOOL, W.HANDLE, ctypes.POINTER(_OVERLAPPED), ctypes.POINTER(W.DWORD), W.BOOL)
    _CancelIoEx = _fn("CancelIoEx", W.BOOL, W.HANDLE, ctypes.POINTER(_OVERLAPPED))
    _GetCommState = _fn("GetCommState", W.BOOL, W.HANDLE, ctypes.POINTER(_DCB))
    _SetCommState = _fn("SetCommState", W.BOOL, W.HANDLE, ctypes.POINTER(_DCB))
    _SetCommTimeouts = _fn("SetCommTimeouts", W.BOOL, W.HANDLE, ctypes.POINTER(_TIMEOUTS))
    _SetupComm = _fn("SetupComm", W.BOOL, W.HANDLE, W.DWORD, W.DWORD)
    _PurgeComm = _fn("PurgeComm", W.BOOL, W.HANDLE, W.DWORD)

    _INVALID = W.HANDLE(-1).value
    _ERROR_IO_PENDING, _ERROR_OPERATION_ABORTED = 997, 995
    _MAXDWORD = 0xFFFFFFFF

    def _winerr(what):
        code = ctypes.get_last_error()
        return OSError(code, "%s failed: %s" % (what, ctypes.FormatError(code).strip()))

    def _subkeys(k):
        i = 0
        while True:
            try:
                yield winreg.EnumKey(k, i)
            except OSError:
                return
            i += 1


class WinSerial:
    """Overlapped Win32 serial port. A reader thread and a writer thread each own
    their own OVERLAPPED, so a pending read never delays a STOP being written."""

    def __init__(self, path, baud, loop, on_data, on_close):
        self.path, self.loop, self.on_data, self.on_close = path, loop, on_data, on_close
        dev = path if path.startswith("\\\\.\\") else "\\\\.\\" + path
        h = _CreateFileW(dev, 0x80000000 | 0x40000000, 0, None, 3, 0x40000000, None)  # RW, OPEN_EXISTING, OVERLAPPED
        if h == _INVALID or not h:
            code = ctypes.get_last_error()
            if code == 5:
                raise PermissionError("%s is in use by another program. Close LightBurn, the Arduino IDE or "
                                      "another Burner tab, then Connect again." % path)
            if code == 2:
                raise FileNotFoundError("%s not found (unplugged?)" % path)
            raise OSError(code, ctypes.FormatError(code).strip())
        self.h = h
        try:
            _SetupComm(h, 8192, 8192)
            dcb = _DCB()
            dcb.DCBlength = ctypes.sizeof(_DCB)
            if not _GetCommState(h, ctypes.byref(dcb)):
                raise _winerr("GetCommState")
            dcb.BaudRate = baud
            dcb.ByteSize, dcb.Parity, dcb.StopBits = 8, 0, 0     # 8N1
            dcb.fBinary, dcb.fParity = 1, 0
            dcb.fOutxCtsFlow = dcb.fOutxDsrFlow = dcb.fDsrSensitivity = 0
            dcb.fOutX = dcb.fInX = dcb.fNull = dcb.fAbortOnError = dcb.fErrorChar = 0
            dcb.fDtrControl = 1                                   # DTR on, same as a Linux open
            dcb.fRtsControl = 1
            if not _SetCommState(h, ctypes.byref(dcb)):
                raise _winerr("SetCommState (baud %d)" % baud)
            # read: return as soon as any byte is there, else after 200 ms. write: give up after 5 s.
            to = _TIMEOUTS(_MAXDWORD, _MAXDWORD, 200, 0, 5000)
            if not _SetCommTimeouts(h, ctypes.byref(to)):
                raise _winerr("SetCommTimeouts")
            _PurgeComm(h, 0x0F)
        except Exception:
            _CloseHandle(h)
            raise
        self.closed = False
        self._stop = False
        self._wq = queue.Queue()
        self._rt = threading.Thread(target=self._reader, name="serial-read", daemon=True)
        self._wt = threading.Thread(target=self._writer, name="serial-write", daemon=True)
        self._rt.start()
        self._wt.start()

    def _fail(self, why):
        if not self._stop:
            self.loop.call_soon_threadsafe(self.close, why)

    def _reader(self):
        ov = _OVERLAPPED()
        ov.hEvent = _CreateEventW(None, True, False, None)
        buf = ctypes.create_string_buffer(4096)
        n = W.DWORD(0)
        try:
            while not self._stop:
                _ResetEvent(ov.hEvent)
                if not _ReadFile(self.h, buf, 4096, None, ctypes.byref(ov)):
                    err = ctypes.get_last_error()
                    if err != _ERROR_IO_PENDING:
                        self._fail("serial read error %d (device unplugged?)" % err)
                        return
                if not _GetOverlappedResult(self.h, ctypes.byref(ov), ctypes.byref(n), True):
                    err = ctypes.get_last_error()
                    if err != _ERROR_OPERATION_ABORTED:
                        self._fail("serial read error %d (device unplugged?)" % err)
                    return
                if n.value:
                    self.loop.call_soon_threadsafe(self._deliver, buf.raw[:n.value])
        finally:
            _CloseHandle(ov.hEvent)

    def _deliver(self, data):
        if not self.closed:
            self.on_data(data)

    def _writer(self):
        ov = _OVERLAPPED()
        ov.hEvent = _CreateEventW(None, True, False, None)
        n = W.DWORD(0)
        try:
            while True:
                data = self._wq.get()
                if data is None or self._stop:
                    return
                while data and not self._stop:
                    _ResetEvent(ov.hEvent)
                    if not _WriteFile(self.h, data, len(data), None, ctypes.byref(ov)):
                        err = ctypes.get_last_error()
                        if err != _ERROR_IO_PENDING:
                            self._fail("serial write error %d" % err)
                            return
                    if not _GetOverlappedResult(self.h, ctypes.byref(ov), ctypes.byref(n), True):
                        err = ctypes.get_last_error()
                        if err != _ERROR_OPERATION_ABORTED:
                            self._fail("serial write error %d" % err)
                        return
                    if n.value == 0:
                        self._fail("serial write timed out (controller not reading)")
                        return
                    data = data[n.value:]
        finally:
            _CloseHandle(ov.hEvent)

    def write(self, data):
        if not self.closed:
            self._wq.put(bytes(data))

    def close(self, why="closed"):
        if self.closed:
            return
        self.closed = True
        self._stop = True
        self._wq.put(None)
        # keep cancelling: a thread may start a new read/write just after a cancel
        deadline = time.monotonic() + 1.0
        for t in (self._rt, self._wt):
            while t is not threading.current_thread() and t.is_alive() and time.monotonic() < deadline:
                _CancelIoEx(self.h, None)
                t.join(0.02)
        _CloseHandle(self.h)
        self.on_close(why)


def list_ports_windows():
    names = []
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\SERIALCOMM") as k:
            i = 0
            while True:
                try:
                    names.append(winreg.EnumValue(k, i)[1])
                except OSError:
                    break
                i += 1
    except OSError:
        pass
    friendly = {}
    for bus in ("USB", "FTDIBUS"):
        try:
            root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Enum\%s" % bus)
        except OSError:
            continue
        with root:
            for dev in _subkeys(root):
                try:
                    dk = winreg.OpenKey(root, dev)
                except OSError:
                    continue
                with dk:
                    for inst in _subkeys(dk):
                        try:
                            with winreg.OpenKey(dk, inst + r"\Device Parameters") as pk:
                                port = winreg.QueryValueEx(pk, "PortName")[0]
                            with winreg.OpenKey(dk, inst) as ik:
                                friendly[port] = winreg.QueryValueEx(ik, "FriendlyName")[0]
                        except OSError:
                            pass
    names = sorted(set(names), key=lambda s: (len(s), s))
    return [{"path": n, "label": friendly.get(n, n)} for n in names]


# ======================= simulator: fake GRBL 1.1 laser =======================
SIM_SETTINGS = [(0, "10"), (1, "25"), (2, "0"), (3, "0"), (4, "0"), (5, "0"), (6, "0"), (10, "1"), (11, "0.010"),
                (12, "0.002"), (13, "0"), (20, "0"), (21, "0"), (22, "1"), (23, "3"), (24, "100.000"),
                (25, "3000.000"), (26, "250"), (27, "1.000"), (30, "1000"), (31, "0"), (32, "1"),
                (100, "80.000"), (101, "80.000"), (102, "80.000"), (110, "6000.000"), (111, "6000.000"),
                (112, "1000.000"), (120, "500.000"), (121, "500.000"), (122, "100.000"), (130, "400.000"),
                (131, "400.000"), (132, "50.000")]
_WORD = re.compile(r"([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))")


class SimGrbl:
    """Enough of GRBL 1.1 to drive the UI: 128-byte RX buffer (overflow is reported
    loudly, so broken character counting shows up), 15-block planner, status
    reports, feed hold/resume, soft reset (ALARM:3 if reset while moving),
    overrides, jog + jog cancel, home, unlock, G10 L20, $$ and $N=v.
    Moves are straight lines at the programmed feed (no accel); arcs go
    straight to their end point."""
    RX = 128
    PLAN = 15

    def __init__(self, path, baud, loop, on_data, on_close):
        self.loop, self.on_data, self.on_close = loop, on_data, on_close
        self.closed = False
        self.settings = {k: v for k, v in SIM_SETTINGS}
        self.speed = SIM_SPEED
        self.overflows = 0
        self.state = "Idle"
        self.m = [0.0, 0.0, 0.0]
        self.wco = [0.0, 0.0, 0.0]
        self._reset(boot=True)
        self.task = loop.create_task(self._run())

    # --- state ---
    def _reset(self, boot=False):
        moving = not boot and self.state in ("Run", "Jog") and not self.hold
        locked = not boot and self.state == "Alarm"
        self.rx = bytearray()
        self.plan = []                     # [x, y, feed mm/min or None=rapid, laser on, jog]
        self.cur = None
        self.hold = False
        self.ov = [100, 100, 100]
        self.mode, self.abs, self.scale, self.F, self.S, self.laser = 0, True, 1.0, 0.0, 0.0, 0
        self.home_t = 0
        self.booted = time.monotonic()
        self.banner_due = True
        self.state = "Alarm" if (moving or locked) else "Idle"
        if moving:
            self._send("ALARM:3")

    def _send(self, s):
        if not self.closed:
            self.on_data((s + "\r\n").encode())

    def write(self, data):
        if self.closed:
            return
        for b in data:
            if b == 0x3F:                                  # ?  status
                self._status()
            elif b == 0x21:                                # !  feed hold
                if self.state == "Jog":
                    self._cancel_jog()
                elif self.state == "Run":
                    self.hold = True
            elif b == 0x7E:                                # ~  resume
                self.hold = False
            elif b == 0x18:                                # ctrl-x soft reset
                self._reset()
            elif b == 0x85:                                # jog cancel
                if self.state == "Jog":
                    self._cancel_jog()
            elif 0x90 <= b <= 0x9D:
                self._override(b)
            elif b >= 0x80:
                pass
            else:
                if len(self.rx) >= self.RX - 1:
                    self.overflows += 1
                    if self.overflows < 5:
                        say("SIM: RX BUFFER OVERFLOW - sender wrote more than 127 unacked bytes")
                        self._send("[MSG:SIM RX OVERFLOW - character counting broke]")
                    continue
                self.rx.append(b)
        if not self.banner_due and self.state != "Home":
            self._pump_rx()                                # real GRBL acks right away, not on a tick

    def _pump_rx(self):
        # RX -> planner; GRBL acks a line as it enters the planner
        while len(self.plan) < self.PLAN:
            i = self.rx.find(b"\n")
            if i < 0:
                break
            raw = self.rx[:i].decode("ascii", "replace").strip()
            del self.rx[:i + 1]
            self._send(self._line(raw))

    def _cancel_jog(self):
        self.plan = [p for p in self.plan if not p[4]]
        self.cur = None
        self.state = "Idle"

    def _override(self, b):
        f, r, s = self.ov
        if b == 0x90: f = 100
        elif b == 0x91: f += 10
        elif b == 0x92: f -= 10
        elif b == 0x93: f += 1
        elif b == 0x94: f -= 1
        elif b == 0x95: r = 100
        elif b == 0x96: r = 50
        elif b == 0x97: r = 25
        elif b == 0x99: s = 100
        elif b == 0x9A: s += 10
        elif b == 0x9B: s -= 10
        elif b == 0x9C: s += 1
        elif b == 0x9D: s -= 1
        self.ov = [max(10, min(200, f)), r, max(10, min(200, s))]

    def _status(self):
        st = self.state
        run = st in ("Run", "Jog")
        if self.hold and run:
            st = "Hold:0"
        live = bool(self.cur) and run and not self.hold
        s = self.S * self.ov[2] / 100 if live and self.cur[3] else 0
        f = (self.cur[2] or float(self.settings[110])) * (1 if self.cur[4] else self.ov[0] / 100) if live else 0
        self._send("<%s|MPos:%.3f,%.3f,%.3f|Bf:%d,%d|FS:%d,%d|Ov:%d,%d,%d|WCO:%.3f,%.3f,%.3f>" % (
            st, self.m[0], self.m[1], self.m[2], self.PLAN - len(self.plan), self.RX - 1 - len(self.rx),
            f, s, self.ov[0], self.ov[1], self.ov[2], self.wco[0], self.wco[1], self.wco[2]))

    # --- line handling ---
    def _line(self, raw):
        line = re.sub(r"\(.*?\)|;.*$", "", raw).replace(" ", "").upper()
        if not line:
            return "ok"
        if line[0] == "$":
            return self._dollar(line)
        if self.state == "Alarm":
            return "error:9"
        words = _WORD.findall(line)
        if "".join(a + b for a, b in words) != line:
            return "error:1"
        w, g53, g10 = {}, False, False
        for k, v in words:
            v = float(v)
            if k == "G":
                if v in (0, 1, 2, 3): self.mode = int(v)
                elif v == 90: self.abs = True
                elif v == 91: self.abs = False
                elif v == 20: self.scale = 25.4
                elif v == 21: self.scale = 1.0
                elif v == 53: g53 = True
                elif v == 10: g10 = True
            elif k == "M":
                if v in (3, 4): self.laser = int(v)
                elif v in (5, 2, 30): self.laser = 0
            else:
                w[k] = v
        if "S" in w: self.S = w["S"]
        if "F" in w: self.F = w["F"] * self.scale
        if g10:
            if w.get("L") == 20:
                end = self._end_pos()
                for i, a in enumerate("XY"):
                    if a in w:
                        self.wco[i] = end[i] - w[a] * self.scale
            return "ok"
        if "X" in w or "Y" in w:
            if self.mode != 0 and self.F <= 0:
                return "error:22"
            x, y = self._target(w, g53, not self.abs, self.scale)
            self._queue(x, y, None if self.mode == 0 else self.F, bool(self.laser) and self.mode != 0, False)
        return "ok"

    def _end_pos(self):
        return list(self.plan[-1][:2]) if self.plan else list(self.m[:2])

    def _target(self, w, g53, rel, scale):
        out = []
        for i, (a, e) in enumerate(zip("XY", self._end_pos())):
            if a not in w:
                out.append(e)
            elif rel:
                out.append(e + w[a] * scale)
            else:
                out.append(w[a] * scale + (0 if g53 else self.wco[i]))
        return out

    def _queue(self, x, y, feed, laser, jog):
        self.plan.append([x, y, feed, laser, jog])
        if self.state == "Idle":
            self.state = "Jog" if jog else "Run"

    def _dollar(self, line):
        if line == "$$":
            for k, v in SIM_SETTINGS:
                self._send("$%d=%s" % (k, self.settings[k]))
            return "ok"
        if line == "$I":
            self._send("[VER:1.1h.SIM:Burner simulator]")
            return "ok"
        if line == "$G":
            self._send("[GC:G%d G54 G17 G%d G%d G94 M%d T0 F%d S%d]" % (
                self.mode, 21 if self.scale == 1 else 20, 90 if self.abs else 91, self.laser or 5, self.F, self.S))
            return "ok"
        if line == "$#":
            self._send("[G54:%.3f,%.3f,%.3f]" % tuple(self.wco))
            return "ok"
        if line == "$X":
            if self.state == "Alarm":
                self.state = "Idle"
                self._send("[MSG:Caution: Unlocked]")
            return "ok"
        if line == "$H":
            if self.plan or self.state not in ("Idle", "Alarm"):
                return "error:8"
            self.state, self.home_t = "Home", time.monotonic() + 1.5 / self.speed
            return "ok"
        if line.startswith("$J="):
            if self.state not in ("Idle", "Jog"):
                return "error:8"
            body = line[3:]
            words = dict((k, float(v)) for k, v in _WORD.findall(body))
            if "F" not in words:
                return "error:22"
            sc = 25.4 if "G20" in body else 1.0
            x, y = self._target(words, "G53" in body, "G91" in body, sc)
            self._queue(x, y, words["F"] * sc, False, True)
            return "ok"
        m = re.fullmatch(r"\$(\d+)=([-+]?[\d.]+)", line)
        if m:
            if self.state != "Idle":
                return "error:8"
            k = int(m.group(1))
            if k not in self.settings:
                return "error:3"
            self.settings[k] = m.group(2)
            return "ok"
        return "error:3"

    # --- clock ---
    async def _run(self):
        last = time.monotonic()
        try:
            while not self.closed:
                await asyncio.sleep(0.01)
                now = time.monotonic()
                dt, last = (now - last) * self.speed, now
                if self.banner_due:
                    if now - self.booted > 0.15:
                        self.banner_due = False
                        self._send("")
                        self._send("Grbl 1.1h ['$' for help]")
                        if self.state == "Alarm":
                            self._send("[MSG:'$H'|'$X' to unlock]")
                    continue
                if self.state == "Home":
                    if now >= self.home_t:
                        self.m = [0.0, 0.0, 0.0]
                        self.state = "Idle"
                    continue
                self._move(dt)
                self._pump_rx()                            # planner freed up while moving
        except asyncio.CancelledError:
            pass

    def _move(self, dt):
        while dt > 1e-9 and not self.hold:
            if self.cur is None:
                if not self.plan:
                    if self.state in ("Run", "Jog"):
                        self.state = "Idle"
                    return
                self.cur = self.plan[0]
            x, y, feed, laser, jog = self.cur
            if feed is None:
                rate = float(self.settings[110]) * self.ov[1] / 100
            else:
                rate = feed * (1 if jog else self.ov[0] / 100)
            rate = max(rate, 1.0) / 60.0                       # mm/s
            dx, dy = x - self.m[0], y - self.m[1]
            d = (dx * dx + dy * dy) ** 0.5
            if rate * dt >= d:
                self.m[0], self.m[1] = x, y
                dt -= d / rate
                self.plan.pop(0)
                self.cur = None
            else:
                self.m[0] += dx / d * rate * dt
                self.m[1] += dy / d * rate * dt
                dt = 0

    def close(self, why="closed"):
        if self.closed:
            return
        self.closed = True
        self.task.cancel()
        self.on_close(why)


# ======================= port registry =======================
def list_ports():
    try:
        ports = list_ports_windows() if IS_WIN else list_ports_posix()
    except Exception as e:
        say("port scan failed:", e)
        ports = []
    return ports + [{"path": SIM_PATH, "label": "Simulator (no laser)", "sim": True}]


def open_serial(path, baud, loop, on_data, on_close):
    if path == SIM_PATH:
        return SimGrbl(path, baud, loop, on_data, on_close)
    cls = WinSerial if IS_WIN else PosixSerial
    return cls(path, baud, loop, on_data, on_close)


def permission_hint(port):
    return ("Permission denied on %s. Add yourself to the dialout group "
            "(NixOS: users.users.<you>.extraGroups = [ \"dialout\" ];), rebuild, log out and back in." % port)


# ======================= websocket (RFC 6455, minimal) =======================
class WS:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.closed = False

    async def recv(self):
        """Returns (opcode, payload) for text/binary; None on close."""
        buf, op0 = b"", None
        while True:
            h = await self.r.readexactly(2)
            fin, op = h[0] & 0x80, h[0] & 0x0F
            masked, ln = h[1] & 0x80, h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", await self.r.readexactly(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", await self.r.readexactly(8))[0]
            if ln > 1 << 20:
                return None
            key = await self.r.readexactly(4) if masked else b"\0\0\0\0"
            data = bytearray(await self.r.readexactly(ln))
            for i in range(ln):
                data[i] ^= key[i & 3]
            if op == 8:
                return None
            if op == 9:
                self._frame(10, bytes(data))
                continue
            if op == 10:
                continue
            if op in (1, 2):
                op0, buf = op, bytes(data)
            elif op == 0:
                buf += bytes(data)
            if fin and op0 is not None:
                return op0, buf

    def _frame(self, op, data):
        if self.closed:
            return
        n = len(data)
        if n < 126:
            hdr = struct.pack(">BB", 0x80 | op, n)
        elif n < 65536:
            hdr = struct.pack(">BBH", 0x80 | op, 126, n)
        else:
            hdr = struct.pack(">BBQ", 0x80 | op, 127, n)
        self.w.write(hdr + data)

    def send_bin(self, data):
        self._frame(2, data)

    def send_json(self, obj):
        self._frame(1, json.dumps(obj).encode())

    def close(self):
        if not self.closed:
            try:
                self._frame(8, b"")
            except Exception:
                pass
            self.closed = True
            try:
                self.w.close()
            except Exception:
                pass


# ======================= server =======================
current = {"ws": None, "ser": None}


def local_names():
    return ("localhost:%d" % PORT, "127.0.0.1:%d" % PORT)


def allowed_origin(origin):
    return origin in ["http://" + h for h in local_names()] + [""]


async def handle_ws(ws):
    loop = asyncio.get_running_loop()
    old = current["ws"]
    if old:
        old.send_json({"ev": "error", "msg": "Another tab took over the bridge."})
        old.close()
    close_serial("taken over by another tab")
    current["ws"] = ws
    ws.send_json({"ev": "hello", "platform": sys.platform, "version": 2})
    ws.send_json({"ev": "ports", "ports": list_ports()})

    def on_data(b):
        if current["ws"] is ws:
            ws.send_bin(b)

    def on_close(why):
        if current["ser"] and current["ser"].closed:
            current["ser"] = None
        if current["ws"] is ws:
            ws.send_json({"ev": "closed", "why": why})
        say("serial closed:", why)

    try:
        while True:
            m = await ws.recv()
            if m is None:
                break
            op, data = m
            if op == 2:
                s = current["ser"]
                if s and not s.closed:
                    s.write(data)
                continue
            try:
                c = json.loads(data)
            except ValueError:
                continue
            cmd = c.get("cmd")
            if cmd == "list":
                ws.send_json({"ev": "ports", "ports": list_ports()})
            elif cmd == "open":
                close_serial("reopen")
                port, baud = str(c.get("port", "")), int(c.get("baud", 115200))
                try:
                    current["ser"] = open_serial(port, baud, loop, on_data, on_close)
                    say("opened", port, baud)
                    ws.send_json({"ev": "opened", "port": port, "baud": baud, "sim": port == SIM_PATH})
                except PermissionError as e:
                    ws.send_json({"ev": "error", "msg": str(e) if IS_WIN else permission_hint(port)})
                except Exception as e:
                    ws.send_json({"ev": "error", "msg": "Open %s failed: %s" % (port, e)})
            elif cmd == "close":
                close_serial("closed by user")
    except (asyncio.IncompleteReadError, ConnectionError):
        pass
    finally:
        if current["ws"] is ws:
            current["ws"] = None
            # browser gone: kill the job and the laser
            s = current["ser"]
            if s and not s.closed:
                s.write(b"!")
                await asyncio.sleep(0.25)
                s.write(b"\x18")
                await asyncio.sleep(0.1)
                say("browser disconnected: sent hold + soft reset")
            close_serial("browser disconnected")
        ws.close()


def close_serial(why):
    s = current["ser"]
    current["ser"] = None
    if s and not s.closed:
        s.close(why)


MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
        ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
        ".otf": "font/otf", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8"}


def static_file(path):
    """URL path -> file under web/, or None. Blocks traversal, dotfiles and unknown types."""
    p = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
    if p in ("", "/"):
        p = "/index.html"
    parts = [x for x in p.split("/") if x]
    if any(x.startswith(".") or "\\" in x or ":" in x for x in parts):
        return None
    root = os.path.realpath(WEB)
    full = os.path.realpath(os.path.join(root, *parts))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        return None
    if os.path.splitext(full)[1].lower() not in MIME:
        return None
    return full


async def respond(writer, code, msg, body=b"", ctype="text/plain; charset=utf-8", extra=b""):
    writer.write(b"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nCache-Control: no-store\r\n"
                 b"X-Content-Type-Options: nosniff\r\nConnection: close\r\n%s\r\n" % (code, msg, ctype.encode(), len(body), extra) + body)
    try:
        await writer.drain()
    except Exception:
        pass
    writer.close()


async def handle(reader, writer):
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
    except Exception:
        writer.close()
        return
    lines = head.decode("latin-1").split("\r\n")
    try:
        method, path, _ = lines[0].split(" ", 2)
    except ValueError:
        writer.close()
        return
    hdr = {}
    for l in lines[1:]:
        if ":" in l:
            k, v = l.split(":", 1)
            hdr[k.strip().lower()] = v.strip()

    # DNS-rebinding guard: only answer to our own host names
    if hdr.get("host", "") not in local_names():
        say("rejected request for host", hdr.get("host"))
        await respond(writer, 403, b"Forbidden", b"wrong host")
        return

    if path == "/ws" and hdr.get("upgrade", "").lower() == "websocket":
        if not allowed_origin(hdr.get("origin", "")):
            say("rejected websocket from origin", hdr.get("origin"))
            await respond(writer, 403, b"Forbidden")
            return
        acc = base64.b64encode(hashlib.sha1(hdr["sec-websocket-key"].encode() + GUID).digest())
        writer.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     b"Sec-WebSocket-Accept: " + acc + b"\r\n\r\n")
        await writer.drain()
        await handle_ws(WS(reader, writer))
        return

    if method != "GET":
        await respond(writer, 405, b"Method Not Allowed")
        return
    if path.split("?")[0] == "/burner.html":                        # old bookmark
        await respond(writer, 301, b"Moved Permanently", extra=b"Location: /\r\n")
        return
    f = static_file(path)
    if not f:
        await respond(writer, 404, b"Not Found", b"not found")
        return
    try:
        with open(f, "rb") as fh:
            body = fh.read()
    except OSError:
        await respond(writer, 404, b"Not Found", b"not found")
        return
    await respond(writer, 200, b"OK", body, MIME[os.path.splitext(f)[1].lower()])


async def main(open_browser):
    srv = await asyncio.start_server(handle, HOST, PORT)
    url = "http://localhost:%d" % PORT
    say("Burner bridge on %s  (Ctrl+C to quit)" % url)
    real = [p["label"] for p in list_ports() if not p.get("sim")]
    say("Serial ports:", ", ".join(real) or "none found (plug in the laser)")
    if not os.path.isfile(os.path.join(WEB, "index.html")):
        say("WARNING: web/index.html not found next to burner_bridge.py")
    if open_browser:
        import webbrowser
        asyncio.get_running_loop().call_later(0.3, webbrowser.open, url)
    async with srv:
        await srv.serve_forever()


def cli():
    global PORT, SIM_SPEED
    ap = argparse.ArgumentParser(description="Burner: GRBL laser sender bridge")
    ap.add_argument("--port", type=int, default=PORT, help="HTTP port (default %(default)s, env BURNER_PORT)")
    ap.add_argument("--open", action="store_true", help="open the browser once the bridge is up")
    ap.add_argument("--sim-speed", type=float, default=1.0, help="simulator time multiplier (default 1 = real time)")
    a = ap.parse_args()
    PORT, SIM_SPEED = a.port, max(0.1, a.sim_speed)
    try:
        asyncio.run(main(a.open))
    except KeyboardInterrupt:
        pass
    finally:
        close_serial("bridge exit")


if __name__ == "__main__":
    cli()
