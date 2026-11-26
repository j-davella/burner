#!/usr/bin/env python3
"""
burner_bridge.py - serial <-> WebSocket bridge for Burner (GRBL laser sender).

Stdlib only. Linux only (termios).
Run:   python3 burner_bridge.py            (serves burner.html from this folder)
Open:  http://localhost:8765

Listens on 127.0.0.1 only and rejects WebSocket connections from any page
not served by this bridge, so a random website can't fire your laser.
One client at a time. If the browser drops, the bridge soft-resets GRBL
(laser off, job killed) and closes the port.
"""
import asyncio, base64, glob, hashlib, json, os, struct, sys, termios

HOST = "127.0.0.1"
PORT = int(os.environ.get("BURNER_PORT", "8765"))
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "burner.html")
GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# ---------------- serial (raw termios) ----------------
class Serial:
    def __init__(self, path, baud, loop, on_data, on_close):
        speed = getattr(termios, "B%d" % baud, None)
        if speed is None:
            raise ValueError("baud %d not supported by termios" % baud)
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


def list_ports():
    out, seen = [], set()
    for link in sorted(glob.glob("/dev/serial/by-id/*")):
        real = os.path.realpath(link)
        seen.add(real)
        out.append({"path": real, "label": "%s  (%s)" % (os.path.basename(real), os.path.basename(link))})
    for p in sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*")):
        if p not in seen:
            out.append({"path": p, "label": os.path.basename(p)})
    return out


# ---------------- websocket (RFC 6455, minimal) ----------------
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


# ---------------- server ----------------
current = {"ws": None, "ser": None}


def allowed_origin(origin):
    return origin in ("http://localhost:%d" % PORT, "http://127.0.0.1:%d" % PORT, "")


async def handle_ws(ws):
    loop = asyncio.get_running_loop()
    old = current["ws"]
    if old:
        old.send_json({"ev": "error", "msg": "Another tab took over the bridge."})
        old.close()
    close_serial("taken over by another tab")
    current["ws"] = ws
    ws.send_json({"ev": "ports", "ports": list_ports()})

    def on_data(b):
        if current["ws"] is ws:
            ws.send_bin(b)

    def on_close(why):
        if current["ser"] and current["ser"].closed:
            current["ser"] = None
        if current["ws"] is ws:
            ws.send_json({"ev": "closed", "why": why})
        print("serial closed:", why, flush=True)

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
                try:
                    current["ser"] = Serial(c["port"], int(c.get("baud", 115200)), loop, on_data, on_close)
                    print("opened", c["port"], c.get("baud"), flush=True)
                    ws.send_json({"ev": "opened", "port": c["port"], "baud": int(c.get("baud", 115200))})
                except PermissionError:
                    ws.send_json({"ev": "error", "msg": "Permission denied on %s. Add yourself to the dialout group "
                                  "(NixOS: users.users.<you>.extraGroups = [ \"dialout\" ];), rebuild, log out and back in." % c["port"]})
                except Exception as e:
                    ws.send_json({"ev": "error", "msg": "Open %s failed: %s" % (c.get("port"), e)})
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
                print("browser disconnected: sent hold + soft reset", flush=True)
            close_serial("browser disconnected")
        ws.close()


def close_serial(why):
    s = current["ser"]
    current["ser"] = None
    if s and not s.closed:
        s.close(why)


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

    if path == "/ws" and hdr.get("upgrade", "").lower() == "websocket":
        if not allowed_origin(hdr.get("origin", "")):
            print("rejected websocket from origin", hdr.get("origin"), flush=True)
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            await writer.drain()
            writer.close()
            return
        acc = base64.b64encode(hashlib.sha1(hdr["sec-websocket-key"].encode() + GUID).digest())
        writer.write(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     b"Sec-WebSocket-Accept: " + acc + b"\r\n\r\n")
        await writer.drain()
        await handle_ws(WS(reader, writer))
        return

    if method == "GET" and path.split("?")[0] in ("/", "/burner.html"):
        try:
            body = open(PAGE, "rb").read()
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                         b"Content-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
        except OSError:
            msg = b"burner.html not found next to burner_bridge.py"
            writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: %d\r\n\r\n" % len(msg) + msg)
    else:
        writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    try:
        await writer.drain()
    except Exception:
        pass
    writer.close()


async def main():
    srv = await asyncio.start_server(handle, HOST, PORT)
    print("Burner bridge on http://localhost:%d  (Ctrl+C to quit)" % PORT, flush=True)
    ports = list_ports()
    print("Serial ports:", ", ".join(p["label"] for p in ports) or "none found (plug in the laser)", flush=True)
    async with srv:
        await srv.serve_forever()


if __name__ == "__main__":
    if not sys.platform.startswith("linux"):
        print("Linux only (uses termios)."); sys.exit(1)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        close_serial("bridge exit")
