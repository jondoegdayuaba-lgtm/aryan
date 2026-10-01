"""Shrinks a GLB for embedding: positions become int16 and normals int8 (both stored as VEC4 with an
'extras.q' note that the game's loader decodes), vertex colours and skin weights become normalized bytes.
Pure Python so build.py needs no extra packages."""
import json, struct
from array import array

FMT = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B', 5122: 'h', 5120: 'b'}
SIZE = {5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def pack(glb: bytes) -> bytes:
    n = struct.unpack_from('<I', glb, 12)[0]
    j = json.loads(glb[20:20 + n])
    off = 20 + n
    blen = struct.unpack_from('<I', glb, off)[0]
    binb = glb[off + 8:off + 8 + blen]

    def read(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        c, k = a['componentType'], NC[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or SIZE[c] * k
        out = array(FMT[c])
        if stride == SIZE[c] * k:
            out.frombytes(binb[start:start + a['count'] * stride])
        else:
            for e in range(a['count']):
                out.frombytes(binb[start + e * stride:start + e * stride + SIZE[c] * k])
        return a, out, k

    views, blobs, pos = [], [], 0

    def add(data: bytes):
        nonlocal pos
        pad = (-pos) % 4
        if pad:
            blobs.append(b'\0' * pad)
            pos += pad
        views.append({'buffer': 0, 'byteOffset': pos, 'byteLength': len(data)})
        blobs.append(data)
        pos += len(data)
        return len(views) - 1

    done = {}
    newacc = []

    def conv(i, how):
        key = (i, how)
        if key in done:
            return done[key]
        a, v, k = read(i)
        cnt = a['count']
        na = {'count': cnt}
        if how == 'pos':
            lo = [min(v[e * k + c] for e in range(cnt)) for c in range(3)]
            hi = [max(v[e * k + c] for e in range(cnt)) for c in range(3)]
            o = [(lo[c] + hi[c]) / 2 for c in range(3)]
            s = [max(1e-6, (hi[c] - lo[c]) / 2) for c in range(3)]
            q = array('h')
            for e in range(cnt):
                for c in range(3):
                    q.append(max(-32767, min(32767, round((v[e * k + c] - o[c]) / s[c] * 32767))))
                q.append(0)
            na.update(componentType=5122, type='VEC4', extras={'q': {'n': 3, 'o': o, 's': s}})
        elif how == 'nrm':
            q = array('b')
            for e in range(cnt):
                for c in range(3):
                    q.append(max(-127, min(127, round(v[e * k + c] * 127))))
                q.append(0)
            na.update(componentType=5120, type='VEC4', extras={'q': {'n': 3, 'norm': 127}})
        elif how == 'u8':
            sc = 1.0 if a['componentType'] == 5126 else (65535.0 if a['componentType'] == 5123 else 255.0)
            q = array('B', (max(0, min(255, round(x / sc * 255))) for x in v))
            na.update(componentType=5121, type=a['type'], normalized=True)
        else:
            q = v
            na.update(componentType=a['componentType'], type=a['type'])
            if a.get('normalized'):
                na['normalized'] = True
        na['bufferView'] = add(q.tobytes())
        newacc.append(na)
        done[key] = len(newacc) - 1
        return done[key]

    for m in j.get('meshes', []):
        for p in m['primitives']:
            at = p['attributes']
            for name in list(at):
                how = 'pos' if name == 'POSITION' else 'nrm' if name == 'NORMAL' else 'u8' if name in ('COLOR_0', 'WEIGHTS_0') else 'copy'
                at[name] = conv(at[name], how)
            if 'indices' in p:
                p['indices'] = conv(p['indices'], 'copy')
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = conv(s['inverseBindMatrices'], 'copy')
    j['accessors'] = newacc
    j['bufferViews'] = views
    binb2 = b''.join(blobs)
    binb2 += b'\0' * ((-len(binb2)) % 4)
    j['buffers'] = [{'byteLength': len(binb2)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binb2)
    return (struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js
            + struct.pack('<II', len(binb2), 0x004E4942) + binb2)
