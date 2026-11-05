import struct, sys, os, hashlib
p, out = sys.argv[1], sys.argv[2]
d = open(p,'rb').read()
fs = len(d) - 221
guid, enc, magic, ver, ioff, isz = struct.unpack_from('<16sBIIqq', d, fs)
print('encrypted', enc, 'magic', hex(magic), 'version', ver, 'index', hex(ioff), isz)
print('compression methods', [d[fs+61+i*32:fs+61+(i+1)*32].rstrip(b'\0') for i in range(5)])
o = ioff
def fstr():
    global o
    n, = struct.unpack_from('<i', d, o); o += 4
    if n < 0: s = d[o:o-2*n].decode('utf-16le'); o += -2*n
    else: s = d[o:o+n].decode('utf-8', 'replace'); o += n
    return s.rstrip('\0')
mount = fstr(); cnt, seed = struct.unpack_from('<iQ', d, o); o += 12
print('mount', mount, 'entries', cnt)
hasph, = struct.unpack_from('<i', d, o); o += 4
if hasph: o += 8+8+20
hasfd, = struct.unpack_from('<i', d, o); o += 4
fdo, fds = struct.unpack_from('<qq', d, o); o += 36
encsz, = struct.unpack_from('<i', d, o); o += 4
enc_start = o; o += encsz
def entry(off):
    v, = struct.unpack_from('<I', d, off); off += 4
    def rd(is32):
        nonlocal off
        if is32: x, = struct.unpack_from('<I', d, off); off += 4
        else: x, = struct.unpack_from('<Q', d, off); off += 8
        return x
    off_ = rd(v & (1<<31)); usz = rd(v & (1<<30))
    meth = (v >> 23) & 0x3f
    csz = rd(v & (1<<29)) if meth else usz
    return off_, usz, csz, meth, bool(v & (1<<22))
# full directory index
o = fdo
ndir, = struct.unpack_from('<i', d, o); o += 4
for _ in range(ndir):
    dn = fstr(); nf, = struct.unpack_from('<i', d, o); o += 4
    for _ in range(nf):
        fn = fstr(); eo, = struct.unpack_from('<i', d, o); o += 4
        off_, usz, csz, meth, encr = entry(enc_start + eo)
        # in-data header: 8+8+8+4+20 +(blocks) +1+4 = 53 bytes for uncompressed
        hdr = 53
        data = d[off_+hdr: off_+hdr+usz]
        path = (mount + dn + fn).lstrip('./')
        print(f'{path}  off={off_} size={usz} comp={meth} enc={encr} sha256={hashlib.sha256(data).hexdigest()}')
        dst = os.path.join(out, *path.split('/')); os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(data)
