"""Shared helpers for the Blender build scripts: scene reset, image I/O,
shader-node building and baking. Runs inside Blender (or the `bpy` module)."""
import math
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets'))
TEX = os.path.join(OUT, 'tex')


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.render.bake.margin = 0
    scene.view_settings.view_transform = 'Standard'
    return scene


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hex_lin(h, a=1.0):
    """'#rrggbb' -> linear RGBA tuple for node defaults."""
    h = h.lstrip('#')
    rgb = srgb_to_linear([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return (*rgb.tolist(), a)


def save_image(path, rgba, quality=88):
    """Write an (h, w, 3|4) float array in 0..1 (already display encoded) as PNG or JPEG.
    Row 0 is the bottom of the image, as in Blender."""
    h, w = rgba.shape[:2]
    if rgba.shape[2] == 3:
        rgba = np.concatenate([rgba, np.ones((h, w, 1))], axis=2)
    png = path.endswith('.png')
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=png)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    img.file_format = 'PNG' if png else 'JPEG'
    img.filepath_raw = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if png:
        img.save()
    else:
        img.save(quality=quality)
    bpy.data.images.remove(img)
    print('  wrote', os.path.relpath(path, OUT), f'{os.path.getsize(path) / 1024:.0f} KB')


def height_to_normal(h, strength):
    """Tileable tangent-space (OpenGL, +Y up) normal map from a height field.
    `h` rows go bottom-to-top like Blender pixels."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# ---------------------------------------------------------------- node building

class Nodes:
    """Tiny helper to build shader node trees in code. Socket arguments may be
    plain numbers/tuples (used as defaults) or output sockets (linked)."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new('ShaderNodeOutputMaterial')

    def new(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def feed(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
        elif val is not None:
            if isinstance(val, str):
                val = hex_lin(val)
            if sock.type in ('VECTOR', 'RGBA') and isinstance(val, (int, float)):
                val = (val,) * len(sock.default_value)
            sock.default_value = val

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.new('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if c is not None:
            self.feed(n.inputs[2], c)
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.new('ShaderNodeVectorMath', operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        if scale is not None:
            self.feed(n.inputs['Scale'], scale)
        return n.outputs['Vector'] if op not in ('LENGTH', 'DOT_PRODUCT', 'DISTANCE') else n.outputs['Value']

    def combine(self, x, y, z):
        n = self.new('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)):
            self.feed(n.inputs[i], v)
        return n.outputs[0]

    def separate(self, vec):
        n = self.new('ShaderNodeSeparateXYZ')
        self.feed(n.inputs[0], vec)
        return n.outputs

    def uv(self):
        return self.new('ShaderNodeTexCoord').outputs['UV']

    def torus(self, ru=1.0, rv=1.0, offset=(0.0, 0.0, 0.0, 0.0)):
        """Map UV in 0..1 onto a 4D torus so 4D noise tiles seamlessly.
        Returns (vector, w). Different radii stretch features along u or v."""
        u, v, _ = self.separate(self.uv())
        tau = 2 * math.pi
        au = self.math('MULTIPLY', u, tau)
        av = self.math('MULTIPLY', v, tau)
        x = self.math('MULTIPLY_ADD', self.math('COSINE', au), ru, offset[0])
        y = self.math('MULTIPLY_ADD', self.math('SINE', au), ru, offset[1])
        z = self.math('MULTIPLY_ADD', self.math('COSINE', av), rv, offset[2])
        w = self.math('MULTIPLY_ADD', self.math('SINE', av), rv, offset[3])
        return self.combine(x, y, z), w

    def noise(self, coords, scale=5.0, detail=4.0, rough=0.5, lac=2.0, distortion=0.0, kind='FBM'):
        vec, w = coords
        n = self.new('ShaderNodeTexNoise', noise_dimensions='4D', noise_type=kind)
        self.feed(n.inputs['Vector'], vec)
        self.feed(n.inputs['W'], w)
        self.feed(n.inputs['Scale'], scale)
        self.feed(n.inputs['Detail'], detail)
        self.feed(n.inputs['Roughness'], rough)
        self.feed(n.inputs['Lacunarity'], lac)
        self.feed(n.inputs['Distortion'], distortion)
        return n.outputs

    def voronoi(self, coords, scale=5.0, feature='F1', metric='EUCLIDEAN', random=1.0, detail=0.0):
        vec, w = coords
        n = self.new('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature, distance=metric)
        self.feed(n.inputs['Vector'], vec)
        self.feed(n.inputs['W'], w)
        self.feed(n.inputs['Scale'], scale)
        self.feed(n.inputs['Randomness'], random)
        if 'Detail' in n.inputs:
            self.feed(n.inputs['Detail'], detail)
        return n.outputs

    def ramp(self, fac, stops, interp='LINEAR'):
        """stops: [(pos, '#hex' | value)] -> color socket (linear)."""
        n = self.new('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = interp
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            el.color = hex_lin(col) if isinstance(col, str) else (col, col, col, 1.0)
        self.feed(n.inputs['Fac'], fac)
        return n.outputs['Color']

    def mix(self, a, b, fac, blend='MIX'):
        n = self.new('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[6], a)
        self.feed(n.inputs[7], b)
        return n.outputs[2]

    def smooth(self, x, lo, hi):
        """smoothstep(lo, hi, x) on a float socket."""
        n = self.new('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP', clamp=True)
        self.feed(n.inputs['Value'], x)
        self.feed(n.inputs['From Min'], lo)
        self.feed(n.inputs['From Max'], hi)
        return n.outputs['Result']

    def emit(self, sock):
        e = self.new('ShaderNodeEmission')
        self.feed(e.inputs['Color'], sock)
        self.nt.links.new(e.outputs[0], self.out.inputs['Surface'])


def bake_plane_sockets(build, size, names):
    """Build a material with `build(nodes) -> {name: socket}` on a unit plane and bake
    each named socket (via emission) to a float array of shape (size, size, 3)."""
    scene = bpy.context.scene
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.object
    mat = bpy.data.materials.new('bake')
    plane.data.materials.append(mat)
    nb = Nodes(mat)
    outs = build(nb)
    img = bpy.data.images.new('bake', size, size, float_buffer=True, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    tex = nb.new('ShaderNodeTexImage')
    tex.image = img
    nb.nt.nodes.active = tex
    emission = nb.new('ShaderNodeEmission')
    nb.nt.links.new(emission.outputs[0], nb.out.inputs['Surface'])
    result = {}
    bpy.ops.object.select_all(action='DESELECT')
    plane.select_set(True)
    bpy.context.view_layer.objects.active = plane
    for name in names:
        for l in list(emission.inputs['Color'].links):
            nb.nt.links.remove(l)
        nb.feed(emission.inputs['Color'], outs[name])
        bpy.ops.object.bake(type='EMIT')
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        result[name] = px.reshape(size, size, 4)[..., :3].astype(np.float64)
    bpy.data.objects.remove(plane)
    bpy.data.images.remove(img)
    bpy.data.materials.remove(mat)
    return result
