"""Rebuild an uncompressed, unencrypted UE pak (v11) with replaced file contents.

Usage: python -I pak_repack.py <original.pak> <replacement_root> <out.pak>

The file list, order, mount point, path-hash index and directory index are taken
from the original pak; each file's bytes are read from <replacement_root>/<path>
(mount point stripped). Offsets, sizes, SHA-1 hashes and index hashes are rebuilt.
Feeding the extracted, unchanged files back in reproduces the original byte-for-byte.
"""
import hashlib
import os
import struct
import sys

FOOTER = 221  # v11: guid16 + enc1 + magic4 + ver4 + off8 + size8 + hash20 + 5*32 names
RECORD_HEADER = 53  # offset8 + csize8 + usize8 + method4 + sha1 20 + flags1 + blocksize4


class Reader:
    def __init__(self, data, pos):
        self.d, self.o = data, pos

    def take(self, fmt):
        vals = struct.unpack_from(fmt, self.d, self.o)
        self.o += struct.calcsize(fmt)
        return vals if len(vals) > 1 else vals[0]

    def fstring(self):
        n = self.take("<i")
        if n < 0:
            s = self.d[self.o:self.o - 2 * n].decode("utf-16le")
            self.o += -2 * n
        else:
            s = self.d[self.o:self.o + n].decode("utf-8")
            self.o += n
        return s.rstrip("\0")


def parse_encoded(buf, off):
    """Return (flags, data_offset, size, positions) of one encoded entry."""
    flags = struct.unpack_from("<I", buf, off)[0]
    if (flags >> 23) & 0x3F or flags & (1 << 22) or (flags >> 6) & 0xFFFF:
        raise SystemExit("compressed or encrypted entries are not supported")
    pos, p = {}, off + 4
    for key, bit in (("offset", 31), ("size", 30)):
        fmt = "<I" if flags & (1 << bit) else "<Q"
        pos[key] = (p, fmt)
        p += struct.calcsize(fmt)
    return flags, struct.unpack_from(pos["offset"][1], buf, pos["offset"][0])[0], \
        struct.unpack_from(pos["size"][1], buf, pos["size"][0])[0], pos


def main(src, root, out):
    d = open(src, "rb").read()
    fs = len(d) - FOOTER
    _, enc, magic, ver, ioff, isz = struct.unpack_from("<16sBIIqq", d, fs)
    if magic != 0x5A6F12E1 or ver != 11 or enc:
        raise SystemExit(f"unsupported pak: magic={magic:#x} version={ver} encrypted={enc}")
    if any(d[fs + 61 + i * 32:fs + 61 + (i + 1) * 32].strip(b"\0") for i in range(5)):
        raise SystemExit("pak declares compression methods; not supported")

    r = Reader(d, ioff)
    mount = r.fstring()
    r.take("<iQ")  # entry count, path hash seed
    if not r.take("<i"):
        raise SystemExit("pak has no path hash index")
    phi_ref = r.o
    phi_off, phi_size = r.take("<qq"); r.o += 20
    if not r.take("<i"):
        raise SystemExit("pak has no full directory index")
    fdi_ref = r.o
    fdi_off, fdi_size = r.take("<qq"); r.o += 20
    enc_len = r.take("<i")
    enc_start = r.o
    primary_end = ioff + isz
    if phi_off < primary_end or fdi_off < primary_end:
        raise SystemExit("unexpected index layout")

    # Directory index: path -> encoded entry offset
    r = Reader(d, fdi_off)
    files = []
    for _ in range(r.take("<i")):
        dname = r.fstring()
        for _ in range(r.take("<i")):
            fname = r.fstring()
            files.append((dname + fname, r.take("<i")))

    primary = bytearray(d[ioff:primary_end])
    entries = []
    for path, eoff in files:
        flags, data_off, size, pos = parse_encoded(d, enc_start + eoff)
        rel = (mount + path).replace("\\", "/")
        while rel.startswith("../"):
            rel = rel[3:]
        entries.append({"path": rel, "eoff": eoff, "old_off": data_off, "pos": pos})

    body = bytearray()
    for e in sorted(entries, key=lambda e: e["old_off"]):
        header = d[e["old_off"]:e["old_off"] + RECORD_HEADER]
        data = open(os.path.join(root, *e["path"].split("/")), "rb").read()
        e["new_off"], e["size"] = len(body), len(data)
        rec = bytearray(header)
        struct.pack_into("<qqqI20s", rec, 0, 0, len(data), len(data), 0, hashlib.sha1(data).digest())
        body += rec + data
        for key, value in (("offset", e["new_off"]), ("size", e["size"])):
            p, fmt = e["pos"][key]
            if fmt == "<I" and value >= 1 << 32:
                raise SystemExit("value no longer fits a 32-bit encoded field")
            struct.pack_into(fmt, primary, p - ioff, value)

    phi = d[phi_off:phi_off + phi_size]
    fdi = d[fdi_off:fdi_off + fdi_size]
    new_ioff = len(body)
    new_phi_off = new_ioff + len(primary)
    new_fdi_off = new_phi_off + len(phi) + (fdi_off - (phi_off + phi_size))
    struct.pack_into("<qq20s", primary, phi_ref - ioff, new_phi_off, len(phi), hashlib.sha1(phi).digest())
    struct.pack_into("<qq20s", primary, fdi_ref - ioff, new_fdi_off, len(fdi), hashlib.sha1(fdi).digest())

    gap = d[phi_off + phi_size:fdi_off]
    tail = d[fdi_off + fdi_size:fs]
    footer = bytearray(d[fs:])
    struct.pack_into("<qq20s", footer, 25, new_ioff, len(primary), hashlib.sha1(primary).digest())
    out_bytes = bytes(body) + bytes(primary) + d[primary_end:phi_off] + phi + gap + fdi + tail + bytes(footer)
    if d[primary_end:phi_off]:
        raise SystemExit("unexpected bytes between primary index and path hash index")
    open(out, "wb").write(out_bytes)
    for e in entries:
        print(f"{e['path']}  offset={e['new_off']} size={e['size']}")
    print(f"wrote {out} ({len(out_bytes)} bytes) sha256={hashlib.sha256(out_bytes).hexdigest()}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
