"""
Sky panoramas rendered with Cycles (Nishita sky + a hazy range of far mountains).

  ski/assets/tex/sky.hdr      full panorama with the sun disc, used as the background
  ski/assets/tex/sky_ibl.hdr  same scene, sun disc hidden from camera rays (the sun still lights
                              the snowfields, so the lower hemisphere is bright); used for lighting
  ski/assets/world/atmosphere.json   fog / sun colours measured from the render

Equirect orientation matches three.js exactly (image centre = +X, u grows toward +Z) - the camera
is rotated (90, 0, -90) in Blender, whose (x, -z, y) frame is the game's (x, y, z).

usage: python make_sky.py [--res 4096] [--samples 64] [--quick]
"""
import json
import math
import os
import sys

import numpy as np

import common as C
from common import bpy
import noise as N
import world_gen as wg

CAM_ALT = 1750.0     # panorama camera altitude (metres, mid run)
BASE_REL = -1000.0   # valley floor of the far range relative to the camera


def sun_target():
    d = wg.sun_direction()
    lon = math.atan2(d[2], d[0])       # three.js: atan2(z, x)
    lat = math.asin(d[1])
    return lon, lat


def build_world(sun_rot, sun_elev, sun_visible_to_camera, altitude=CAM_ALT):
    sc = bpy.context.scene
    world = bpy.data.worlds.new('SkyWorld')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')

    def sky(disc):
        s = nt.nodes.new('ShaderNodeTexSky')
        s.sky_type = 'NISHITA'
        s.sun_disc = disc
        s.sun_elevation = sun_elev
        s.sun_rotation = sun_rot
        s.sun_size = math.radians(0.545)
        s.sun_intensity = 1.0
        s.altitude = altitude
        s.air_density = 0.8
        s.dust_density = 0.06
        s.ground_albedo = 0.8
        s.ozone_density = 1.0
        bg = nt.nodes.new('ShaderNodeBackground')
        nt.links.new(s.outputs['Color'], bg.inputs['Color'])
        return s, bg

    _, full = sky(True)
    _, cam = sky(sun_visible_to_camera)
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    nt.links.new(full.outputs['Background'], mix.inputs[1])
    nt.links.new(cam.outputs['Background'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    world.cycles.sample_map_resolution = 2048 if hasattr(world.cycles, 'sample_map_resolution') else None
    return world


def pano_camera():
    cam = bpy.data.cameras.new('pano')
    cam.type = 'PANO'
    cam.panorama_type = 'EQUIRECTANGULAR'
    cam.latitude_min, cam.latitude_max = -math.pi / 2, math.pi / 2
    cam.longitude_min, cam.longitude_max = -math.pi, math.pi
    cam.clip_start, cam.clip_end = 1.0, 250000.0
    ob = bpy.data.objects.new('pano', cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (0, 0, 0)
    ob.rotation_euler = (math.radians(90), 0, math.radians(-90))
    bpy.context.scene.camera = ob
    return ob


def render_pixels(path, w, h, samples, fmt='HDR'):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.cycles.samples = samples
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    arr = C.image_to_numpy(img)
    bpy.data.images.remove(img)
    return arr


def calibrate_sun():
    """Find the sun_rotation that puts the sun disc where the game's sun is."""
    tgt_lon, tgt_lat = sun_target()
    tmp = os.path.join(C.BUILD, 'sun_probe.hdr')

    def probe(rot):
        for w in list(bpy.data.worlds):
            bpy.data.worlds.remove(w)
        build_world(rot, tgt_lat, True)
        sc = bpy.context.scene
        den = sc.cycles.use_denoising
        sc.cycles.use_denoising = False
        arr = render_pixels(tmp, 512, 256, 24)
        sc.cycles.use_denoising = den
        lum = arr[..., :3].sum(axis=2)
        j, i = np.unravel_index(np.argmax(lum), lum.shape)
        # centroid of the bright core for sub-pixel accuracy
        core = lum >= lum[j, i] * 0.25
        jj, ii = np.nonzero(core)
        wgt = lum[core]
        ci = float((ii * wgt).sum() / wgt.sum())
        cj = float((jj * wgt).sum() / wgt.sum())
        lon = ((ci + 0.5) / 512) * 2 * math.pi - math.pi
        lat = math.pi / 2 - ((cj + 0.5) / 256) * math.pi
        print(f"  probe rot={rot:+.3f}: peak {lum[j, i]:.1f} at px ({i},{j}) lon {math.degrees(lon):.1f} lat {math.degrees(lat):.1f}")
        return lon, lat

    def wrap(a):
        return (a + math.pi) % (2 * math.pi) - math.pi

    l0, la0 = probe(0.0)
    l1, _ = probe(0.6)
    slope = 1.0 if abs(wrap(l1 - l0 - 0.6)) < abs(wrap(l1 - l0 + 0.6)) else -1.0
    rot = wrap((tgt_lon - l0) / slope)
    l2, la2 = probe(rot)
    print(f"sun calibration: rot={rot:.4f} slope={slope:+.0f} -> lon {math.degrees(l2):.1f} (want {math.degrees(tgt_lon):.1f}) "
          f"lat {math.degrees(la2):.1f} (want {math.degrees(tgt_lat):.1f})")
    return rot, tgt_lat



def probe_irradiance(rot, elev):
    """Sun / sky irradiance on a horizontal white diffuse plane (Blender units)."""
    bpy.ops.mesh.primitive_plane_add(size=40.0, location=(0, 0, -1500.0))
    plane = bpy.context.active_object
    m = bpy.data.materials.new('white')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    plane.data.materials.append(m)
    cam = bpy.data.cameras.new('top')
    cam.type = 'ORTHO'
    cam.ortho_scale = 10.0
    co = bpy.data.objects.new('top', cam)
    bpy.context.scene.collection.objects.link(co)
    co.location = (0, 0, -1400.0)
    co.rotation_euler = (0, 0, 0)          # looks straight down -Z
    prev = bpy.context.scene.camera
    bpy.context.scene.camera = co
    sc = bpy.context.scene
    den = sc.cycles.use_denoising
    sc.cycles.use_denoising = False

    def radiance(sun):
        for w in list(bpy.data.worlds):
            bpy.data.worlds.remove(w)
        # sun=False: the disc is removed from every ray type, leaving only the scattered sky
        world = build_world(rot, elev, sun)
        if not sun:
            nt = world.node_tree
            for n in nt.nodes:
                if n.bl_idname == 'ShaderNodeTexSky':
                    n.sun_disc = False
        arr = render_pixels(os.path.join(C.BUILD, 'irr_probe.hdr'), 64, 64, 96)
        return arr[20:44, 20:44, :3].reshape(-1, 3).mean(axis=0)

    tot = radiance(True)
    sky = radiance(False)
    sc.cycles.use_denoising = den
    sc.camera = prev
    for o in (plane, co):
        bpy.data.objects.remove(o)
    e_sky = math.pi * sky
    e_sun_h = math.pi * np.maximum(tot - sky, 0.0)
    e_sun_n = e_sun_h / max(math.sin(elev), 1e-3)
    print(f"irradiance probe: sky E={e_sky}, sun E(normal)={e_sun_n}")
    return e_sky, e_sun_n

# ------------------------------------------------------------------ far mountains
def far_mountains(seed=5):
    rng = np.random.default_rng(seed)
    n = 1024
    size = 110000.0
    dxm = size / (n - 1)
    xs = (np.arange(n) - n / 2) * dxm
    X, Y = np.meshgrid(xs, xs)              # Blender frame: +Y ahead (game -Z), +X right
    r = np.hypot(X, Y)
    az = np.degrees(np.arctan2(X, Y))       # 0 ahead, + toward the right

    n1 = N.spectral_noise((n, n), dxm, 3000.0, 30000.0, 2.2, rng)
    n2 = N.spectral_noise((n, n), dxm, 800.0, 6000.0, 2.0, rng)
    n3 = N.spectral_noise((n, n), dxm, 250.0, 1500.0, 1.8, rng)
    nlo = N.spectral_noise((n, n), dxm, 20000.0, 90000.0, 2.0, rng)

    ring = N.smoothstep(3500.0, 15000.0, r)
    var = 0.55 + 0.45 * np.tanh(nlo * 0.9 + 0.2)
    h = BASE_REL + 90.0 * n1 + 45.0 * n2 + ring * (350.0 + var * (2300.0 * N.ridged(n1) + 800.0 * N.ridged(n2) + 140.0 * n3))
    # hero peaks: azimuth (deg from ahead), distance, height above camera, radius
    for a_deg, dist, top, rad in ((-24, 8500, 2900, 4800), (38, 11500, 3100, 6600), (-118, 10500, 2900, 6000),
                                  (142, 15000, 3300, 8000), (-62, 16500, 2700, 8200), (92, 19000, 3000, 9000),
                                  (5, 21000, 3200, 8600)):
        cx, cy = dist * math.sin(math.radians(a_deg)), dist * math.cos(math.radians(a_deg))
        d = np.hypot(X - cx, Y - cy) / rad
        cone = np.clip(1.0 - d, 0.0, 1.0) ** 1.35
        cone *= 0.7 + 0.3 * N.ridged(n2 + 0.8 * n3, 1.0)
        h = np.maximum(h, BASE_REL + cone * (top - BASE_REL))
    h = np.maximum(h, BASE_REL)
    verts = np.stack([X.ravel(), Y.ravel(), h.ravel()], 1).astype(np.float32)
    tris = C.grid_triangles(n, n)
    ob = C.mesh_from_arrays('FarMountains', verts, tris)
    return ob


def far_material(altitude=CAM_ALT):
    m = C.Mat('FarRange', base=(0.9, 0.92, 0.95, 1.0), rough=0.95)
    nt, nodes, links = m.nt, m.nodes, m.links
    geo = m.node('ShaderNodeNewGeometry', -900, 200)
    sep = m.node('ShaderNodeSeparateXYZ', -700, 200)
    links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    pos = m.node('ShaderNodeSeparateXYZ', -700, 0)
    links.new(geo.outputs['Position'], pos.inputs['Vector'])
    noise = m.node('ShaderNodeTexNoise', -900, -200)
    noise.inputs['Scale'].default_value = 0.0006
    noise.inputs['Detail'].default_value = 8.0
    # steepness -> rock
    ramp = m.node('ShaderNodeValToRGB', -450, 250)
    ramp.color_ramp.elements[0].position = 0.66
    ramp.color_ramp.elements[0].color = (0.16, 0.14, 0.13, 1)
    ramp.color_ramp.elements[1].position = 0.90
    ramp.color_ramp.elements[1].color = (0.93, 0.95, 0.98, 1)
    add = m.node('ShaderNodeMath', -600, 250, operation='ADD')
    mul = m.node('ShaderNodeMath', -750, -150, operation='MULTIPLY')
    mul.inputs[1].default_value = 0.09
    links.new(noise.outputs['Fac'], mul.inputs[0])
    links.new(sep.outputs['Z'], add.inputs[0])
    links.new(mul.outputs['Value'], add.inputs[1])
    links.new(add.outputs['Value'], ramp.inputs['Fac'])
    # forest tint in the low valleys
    low = m.node('ShaderNodeMapRange', -450, -50)
    low.inputs['Value'].default_value = 0.0
    links.new(pos.outputs['Z'], low.inputs['Value'])
    low.inputs['From Min'].default_value = -900.0
    low.inputs['From Max'].default_value = -250.0
    low.inputs['To Min'].default_value = 1.0
    low.inputs['To Max'].default_value = 0.0
    mixc = m.node('ShaderNodeMix', -250, 100, data_type='RGBA')
    links.new(low.outputs['Result'], mixc.inputs['Factor'])
    links.new(ramp.outputs['Color'], mixc.inputs[6])
    mixc.inputs[7].default_value = (0.05, 0.10, 0.06, 1.0)
    links.new(mixc.outputs[2], m.bsdf.inputs['Base Color'])

    # aerial perspective: blend toward the sky colour with distance travelled by the camera ray
    lp = m.node('ShaderNodeLightPath', -450, -350)
    sc_ = m.node('ShaderNodeMath', -250, -350, operation='MULTIPLY')
    sc_.inputs[1].default_value = -1.0 / 42000.0
    links.new(lp.outputs['Ray Length'], sc_.inputs[0])
    ex = m.node('ShaderNodeMath', -80, -350, operation='EXPONENT')
    links.new(sc_.outputs['Value'], ex.inputs[0])
    inv = m.node('ShaderNodeMath', 80, -350, operation='SUBTRACT')
    inv.inputs[0].default_value = 1.0
    links.new(ex.outputs['Value'], inv.inputs[1])
    inc = m.node('ShaderNodeNewGeometry', -450, -520)
    vm = m.node('ShaderNodeVectorMath', -250, -520, operation='SCALE')
    vm.inputs['Scale'].default_value = -1.0
    links.new(inc.outputs['Incoming'], vm.inputs[0])
    sep2 = m.node('ShaderNodeSeparateXYZ', -80, -520)
    links.new(vm.outputs['Vector'], sep2.inputs['Vector'])
    zc = m.node('ShaderNodeMath', 80, -520, operation='MINIMUM')
    zc.inputs[1].default_value = 0.10
    links.new(sep2.outputs['Z'], zc.inputs[0])
    zc2 = m.node('ShaderNodeMath', 220, -520, operation='MAXIMUM')
    zc2.inputs[1].default_value = 0.0
    links.new(zc.outputs['Value'], zc2.inputs[0])
    comb = m.node('ShaderNodeCombineXYZ', 360, -520)
    links.new(sep2.outputs['X'], comb.inputs['X'])
    links.new(sep2.outputs['Y'], comb.inputs['Y'])
    links.new(zc2.outputs['Value'], comb.inputs['Z'])
    hz = m.node('ShaderNodeTexSky', 500, -520, sky_type='NISHITA')
    hz.sun_disc = False
    hz.sun_elevation = sun_elev_global
    hz.sun_rotation = sun_rot_global
    hz.altitude = altitude
    hz.air_density = 0.8
    hz.dust_density = 0.06
    hz.ground_albedo = 0.8
    links.new(comb.outputs['Vector'], hz.inputs['Vector'])
    emit = m.node('ShaderNodeEmission', 700, -520)
    links.new(hz.outputs['Color'], emit.inputs['Color'])
    mix = m.node('ShaderNodeMixShader', 900, 0)
    links.new(inv.outputs['Value'], mix.inputs['Fac'])
    links.new(m.bsdf.outputs['BSDF'], mix.inputs[1])
    links.new(emit.outputs['Emission'], mix.inputs[2])
    links.new(mix.outputs['Shader'], m.out.inputs['Surface'])
    return m


sun_rot_global = 0.0
sun_elev_global = 0.4


def save_hdr(arr, path, clamp=6.0e4):
    arr = np.clip(arr[..., :3], 0.0, clamp)
    img = C.numpy_to_image('out', arr, 'Linear Rec.709')
    img.filepath_raw = path
    img.file_format = 'HDR'
    img.save()
    bpy.data.images.remove(img)
    print(f"wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def main():
    global sun_rot_global, sun_elev_global
    args = sys.argv[1:]
    res = 4096
    samples = 64
    if '--res' in args:
        res = int(args[args.index('--res') + 1])
    if '--samples' in args:
        samples = int(args[args.index('--samples') + 1])
    if '--quick' in args:
        res, samples = 1024, 24

    C.reset_scene()
    C.setup_cycles(samples=samples, denoise=True, res=(res, res // 2))
    pano_camera()

    rot, elev = calibrate_sun()
    sun_rot_global, sun_elev_global = rot, elev
    e_sky, e_sun = probe_irradiance(rot, elev)

    ob = far_mountains()
    ob.data.materials.append(far_material().mat)

    with C.Timer('IBL probe (sun hidden from camera)'):
        for w in list(bpy.data.worlds):
            bpy.data.worlds.remove(w)
        build_world(rot, elev, False)
        ibl = render_pixels(os.path.join(C.BUILD, 'sky_ibl_raw.hdr'), max(512, res // 8), max(256, res // 16), max(32, samples))
        save_hdr(ibl, os.path.join(C.ASSETS, 'tex', 'sky_ibl.hdr'))

    with C.Timer('background panorama'):
        for w in list(bpy.data.worlds):
            bpy.data.worlds.remove(w)
        build_world(rot, elev, True)
        pano = render_pixels(os.path.join(C.BUILD, 'sky_raw.hdr'), res, res // 2, samples)
        save_hdr(pano, os.path.join(C.ASSETS, 'tex', 'sky.hdr'))

    # ---- atmosphere numbers for the game
    h, w = ibl.shape[:2]
    band = ibl[int(h * 0.44):int(h * 0.50), :, :3]           # just above the horizon
    lon_t, lat_t = sun_target()
    fog = band.reshape(-1, 3).mean(axis=0)
    zen = ibl[:int(h * 0.12), :, :3].reshape(-1, 3).mean(axis=0)
    sun_px = pano[..., :3]
    lum = sun_px.sum(axis=2)
    j, i = np.unravel_index(np.argmax(lum), lum.shape)
    sun_col = e_sun / max(e_sun.max(), 1e-6)
    info = dict(sunIrradiance=[float(v) for v in e_sun], skyIrradiance=[float(v) for v in e_sky],
                sunLuminance=float(e_sun @ [0.2126, 0.7152, 0.0722]), skyLuminance=float(e_sky @ [0.2126, 0.7152, 0.0722]),
                fogColor=[float(v) for v in fog], zenithColor=[float(v) for v in zen],
                sunColor=[float(v) for v in sun_col], sunPixel=[int(i), int(j)],
                iblAverage=[float(v) for v in ibl[..., :3].reshape(-1, 3).mean(axis=0)],
                iblUpper=[float(v) for v in ibl[:h // 2, :, :3].reshape(-1, 3).mean(axis=0)],
                iblLower=[float(v) for v in ibl[h // 2:, :, :3].reshape(-1, 3).mean(axis=0)])
    with open(os.path.join(C.ASSETS, 'world', 'atmosphere.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info))


if __name__ == '__main__':
    main()
