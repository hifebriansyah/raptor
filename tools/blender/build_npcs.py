import math
import os
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector


def to_bl(v):
    """Convert Three.js (x, y_up, z_fwd) coordinates to Blender (x, y_back, z_up)."""
    return Vector((v[0], -v[2], v[1]))


def three_rot_to_bl_euler(rx, ry, rz):
    """Convert Three.js XYZ Euler rotation into Blender Euler in Z-up space."""
    c_mat = Matrix((
        (1.0, 0.0, 0.0),
        (0.0, 0.0, -1.0),
        (0.0, 1.0, 0.0),
    ))
    r_three = Euler((rx, ry, rz), "XYZ").to_matrix()
    r_bl = c_mat @ r_three @ c_mat.inverted()
    return r_bl.to_euler("XYZ")


def make_mat(name, hex_color, roughness=0.48, metallic=0.04, emit_hex=None, emit_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    rgb = tuple(int(hex_color.lstrip("#")[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    lin = tuple(pow(c, 2.2) for c in rgb)
    bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emit_hex:
        ergb = tuple(int(emit_hex.lstrip("#")[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
        elin = tuple(pow(c, 2.2) for c in ergb)
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*elin, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emit_strength
    return mat


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_empty(name, parent=None, pos_three=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.07
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = to_bl(pos_three)
    return obj


def _finalize_mesh_obj(name, mesh, parent, pos_three, mat, rot_three=(0.0, 0.0, 0.0), bevel=0.015):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = to_bl(pos_three)
    obj.rotation_euler = three_rot_to_bl_euler(*rot_three)
    if mat is not None:
        obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if bevel > 0.0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = bevel
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(32)
        bev.harden_normals = True
    wn = obj.modifiers.new(name="WeightedNormal", type="WEIGHTED_NORMAL")
    wn.keep_sharp = True
    return obj


def add_box(parent, name, size_three, pos_three, mat, rot_three=(0.0, 0.0, 0.0), bevel=0.014, taper_top=1.0, taper_front=1.0):
    sx, sy, sz = size_three
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        vx = v.co.x * sx
        vy = v.co.y * sz
        vz = v.co.z * sy
        if vz > 0 and taper_top != 1.0:
            vx *= taper_top
            vy *= taper_top
        if vy < 0 and taper_front != 1.0:
            vx *= taper_front
            vz *= taper_front
        v.co = Vector((vx, vy, vz))
    bm.to_mesh(mesh)
    bm.free()
    return _finalize_mesh_obj(name, mesh, parent, pos_three, mat, rot_three, bevel)


def add_cyl(parent, name, radius_top, radius_bot, height, segs, pos_three, mat, rot_three=(0.0, 0.0, 0.0), bevel=0.008):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=max(radius_bot, 0.001),
        radius2=max(radius_top, 0.001),
        depth=height,
    )
    bm.to_mesh(mesh)
    bm.free()
    return _finalize_mesh_obj(name, mesh, parent, pos_three, mat, rot_three, bevel)


def add_ico(parent, name, radius, subdivs, pos_three, mat, scale_three=(1.0, 1.0, 1.0), rot_three=(0.0, 0.0, 0.0)):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivs, radius=radius)
    sx, sy, sz = scale_three
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    bm.to_mesh(mesh)
    bm.free()
    return _finalize_mesh_obj(name, mesh, parent, pos_three, mat, rot_three, bevel=0.0)


def build_base_rig(root_name):
    """Create Humanoid.ts compatible pivot empties: LegL/LegR/Body -> ArmL/ArmR/Head."""
    root = make_empty(root_name, None, (0.0, 0.0, 0.0))
    leg_l = make_empty("LegL", root, (-0.12, 0.90, 0.0))
    leg_r = make_empty("LegR", root, (0.12, 0.90, 0.0))
    body = make_empty("Body", root, (0.0, 0.90, 0.0))
    arm_l = make_empty("ArmL", body, (-0.30, 0.56, 0.0))
    arm_r = make_empty("ArmR", body, (0.30, 0.56, 0.0))
    head = make_empty("Head", body, (0.0, 0.78, 0.0))
    return root, leg_l, leg_r, body, arm_l, arm_r, head


def add_face_details(head, m_skin, m_eye, m_hair, brow_tilt=0.0, smile=True):
    """Shared stylized humanoid face: neck, beveled cranium, nose, ears, eyes, brows, mouth."""
    add_cyl(head, "Neck", 0.075, 0.085, 0.11, 10, (0.0, -0.04, 0.0), m_skin, bevel=0.008)
    add_box(head, "Cranium", (0.32, 0.34, 0.30), (0.0, 0.10, 0.0), m_skin, bevel=0.04, taper_top=0.96)
    add_box(head, "Nose", (0.048, 0.058, 0.052), (0.0, 0.085, 0.155), m_skin, bevel=0.015, taper_top=0.75)
    for sx in (-1.0, 1.0):
        add_box(head, f"Ear_{sx}", (0.04, 0.085, 0.06), (sx * 0.165, 0.095, -0.01), m_skin, bevel=0.012)
        add_box(head, f"Eye_{sx}", (0.045, 0.050, 0.022), (sx * 0.068, 0.118, 0.148), m_eye, bevel=0.006)
        add_box(head, f"Brow_{sx}", (0.066, 0.022, 0.022), (sx * 0.070, 0.160, 0.148), m_hair, rot_three=(0.0, 0.0, sx * brow_tilt), bevel=0.005)
    if smile:
        add_box(head, "Mouth", (0.075, 0.016, 0.015), (0.0, 0.022, 0.150), m_hair, bevel=0.004)


def add_sneaker(leg, prefix, m_shoe, m_sole, accent_mat=None):
    add_box(leg, f"{prefix}_ShoeUpper", (0.185, 0.095, 0.27), (0.0, -0.825, 0.035), m_shoe, bevel=0.022, taper_top=0.86, taper_front=0.88)
    add_box(leg, f"{prefix}_ShoeToe", (0.165, 0.065, 0.10), (0.0, -0.845, 0.145), m_shoe, bevel=0.018, taper_top=0.78)
    add_box(leg, f"{prefix}_ShoeSole", (0.195, 0.04, 0.30), (0.0, -0.88, 0.042), m_sole, bevel=0.01)
    if accent_mat:
        add_box(leg, f"{prefix}_ShoeStripe", (0.192, 0.03, 0.16), (0.0, -0.825, 0.01), accent_mat, bevel=0.005)


def export_glb(filename):
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../public/models"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, filename)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )
    print(f"Exported {filename}: {out_path} ({os.path.getsize(out_path)} bytes)")
    return out_path


# ---------------------------------------------------------------------------
# 1) Generic Modular Humanoid (pedestrians, Sam, Bruno, Cora, drivers)
# ---------------------------------------------------------------------------
def build_generic_humanoid():
    clear_scene()
    m_skin = make_mat("Skin", "#f2c9a0", roughness=0.58, metallic=0.0)
    m_shirt = make_mat("Shirt", "#457b9d", roughness=0.52, metallic=0.02)
    m_pants = make_mat("Pants", "#264653", roughness=0.60, metallic=0.02)
    m_hair = make_mat("Hair", "#2b1d14", roughness=0.68, metallic=0.0)
    m_hat = make_mat("Hat", "#e63946", roughness=0.50, metallic=0.04)
    m_shoe = make_mat("Shoe", "#3b3b48", roughness=0.50, metallic=0.04)
    m_sole = make_mat("ShoeSole", "#e2e8f0", roughness=0.55, metallic=0.02)
    m_eye = make_mat("Eye", "#1f242d", roughness=0.22, metallic=0.05)
    m_glass_frame = make_mat("GlassesFrame", "#4a4e5e", roughness=0.35, metallic=0.20)
    m_glass_lens = make_mat("GlassesLens", "#bde0fe", roughness=0.12, metallic=0.10, emit_hex="#9ad7ff", emit_strength=0.12)

    root, leg_l, leg_r, body, arm_l, arm_r, head = build_base_rig("HumanoidRoot")

    for leg_node, prefix in ((leg_l, "LegL"), (leg_r, "LegR")):
        add_box(leg_node, f"{prefix}_Leg", (0.175, 0.78, 0.195), (0.0, -0.40, 0.0), m_pants, bevel=0.022, taper_top=1.06)
        add_sneaker(leg_node, prefix, m_shoe, m_sole)

    # Torso + toggled Skirt vs Pelvis
    add_box(body, "TorsoChest", (0.46, 0.58, 0.28), (0.0, 0.31, 0.0), m_shirt, bevel=0.028, taper_top=0.95)
    add_box(body, "TorsoCollar", (0.24, 0.06, 0.18), (0.0, 0.61, 0.01), m_shirt, bevel=0.014)
    add_box(body, "PelvisBlock", (0.46, 0.17, 0.285), (0.0, -0.04, 0.0), m_pants, bevel=0.02)
    add_cyl(body, "DressSkirt", 0.25, 0.37, 0.58, 14, (0.0, -0.20, 0.0), m_shirt, bevel=0.015)

    for arm_node, ax, prefix in ((arm_l, -1.0, "ArmL"), (arm_r, 1.0, "ArmR")):
        add_ico(arm_node, f"{prefix}_Shoulder", 0.088, 2, (0.0, 0.0, 0.0), m_shirt, scale_three=(1.0, 0.9, 1.05))
        add_box(arm_node, f"{prefix}_Sleeve", (0.13, 0.45, 0.15), (0.0, -0.225, 0.0), m_shirt, bevel=0.022, taper_top=0.92)
        add_box(arm_node, f"{prefix}_Hand", (0.105, 0.105, 0.11), (0.0, -0.52, 0.0), m_skin, bevel=0.022)
        add_box(arm_node, f"{prefix}_Thumb", (0.04, 0.05, 0.05), (-0.045 if ax > 0 else 0.045, -0.50, 0.04), m_skin, bevel=0.008)

    add_face_details(head, m_skin, m_eye, m_hair)

    # Toggled hairstyle & accessory meshes
    hair_base = make_empty("HairBase", head, (0.0, 0.0, 0.0))
    add_box(hair_base, "HairTop", (0.345, 0.11, 0.325), (0.0, 0.295, -0.01), m_hair, bevel=0.028)
    add_box(hair_base, "HairBack", (0.34, 0.23, 0.09), (0.0, 0.165, -0.135), m_hair, bevel=0.022)
    for sx in (-1.0, 1.0):
        add_box(hair_base, f"HairSide_{sx}", (0.05, 0.14, 0.22), (sx * 0.165, 0.20, -0.02), m_hair, bevel=0.015)

    hair_long = make_empty("HairLong", head, (0.0, 0.0, 0.0))
    add_box(hair_long, "HairLongCurtain", (0.37, 0.44, 0.11), (0.0, 0.02, -0.145), m_hair, bevel=0.025, taper_top=0.92)
    for sx in (-1.0, 1.0):
        add_box(hair_long, f"HairLongLock_{sx}", (0.07, 0.30, 0.14), (sx * 0.165, 0.06, -0.04), m_hair, bevel=0.018)

    hair_bun = make_empty("HairBun", head, (0.0, 0.0, 0.0))
    add_ico(hair_bun, "BunSphere", 0.115, 2, (0.0, 0.355, -0.115), m_hair, scale_three=(1.05, 0.9, 1.0))

    hair_cap = make_empty("HairCap", head, (0.0, 0.0, 0.0))
    add_box(hair_cap, "CapCrown", (0.36, 0.11, 0.34), (0.0, 0.315, 0.0), m_hat, bevel=0.032, taper_top=0.88)
    add_box(hair_cap, "CapBrim", (0.30, 0.035, 0.17), (0.0, 0.27, 0.21), m_hat, rot_three=(0.08, 0.0, 0.0), bevel=0.012, taper_front=0.85)
    add_cyl(hair_cap, "CapButton", 0.022, 0.022, 0.02, 8, (0.0, 0.375, 0.0), m_hat, bevel=0.004)

    glasses = make_empty("Glasses", head, (0.0, 0.0, 0.0))
    add_box(glasses, "GlassBridge", (0.06, 0.018, 0.018), (0.0, 0.125, 0.165), m_glass_frame, bevel=0.004)
    for sx in (-0.07, 0.07):
        add_box(glasses, f"GlassRim_{sx}", (0.105, 0.068, 0.022), (sx, 0.12, 0.164), m_glass_frame, bevel=0.006)
        add_box(glasses, f"GlassLens_{sx}", (0.08, 0.046, 0.014), (sx, 0.12, 0.166), m_glass_lens, bevel=0.003)

    export_glb("humanoid.glb")


# ---------------------------------------------------------------------------
# 2) Leo (11-year-old junior scientist son, scaled 0.68 in game)
# ---------------------------------------------------------------------------
def build_leo():
    clear_scene()
    m_skin = make_mat("Skin", "#e0ac7e", roughness=0.58, metallic=0.0)
    m_shirt = make_mat("Shirt", "#4cc9f0", roughness=0.48, metallic=0.02)
    m_hood_trim = make_mat("HoodTrim", "#f8f9fa", roughness=0.50, metallic=0.02)
    m_pants = make_mat("Pants", "#264653", roughness=0.60, metallic=0.02)
    m_hair = make_mat("Hair", "#5a3825", roughness=0.68, metallic=0.0)
    m_cap = make_mat("CapRed", "#ef476f", roughness=0.48, metallic=0.04)
    m_shoe = make_mat("Shoe", "#1d3557", roughness=0.45, metallic=0.04)
    m_sole = make_mat("Sole", "#ffffff", roughness=0.52, metallic=0.02)
    m_pack = make_mat("Backpack", "#3d405b", roughness=0.55, metallic=0.05)
    m_accent = make_mat("AccentOrange", "#f4a261", roughness=0.42, metallic=0.08)
    m_eye = make_mat("Eye", "#1f242d", roughness=0.22, metallic=0.05)

    root, leg_l, leg_r, body, arm_l, arm_r, head = build_base_rig("LeoRoot")

    for leg_node, prefix in ((leg_l, "LegL"), (leg_r, "LegR")):
        add_box(leg_node, f"{prefix}_Shorts", (0.185, 0.45, 0.21), (0.0, -0.22, 0.0), m_pants, bevel=0.022, taper_top=1.06)
        add_box(leg_node, f"{prefix}_Shin", (0.135, 0.36, 0.145), (0.0, -0.60, 0.0), m_skin, bevel=0.018)
        add_sneaker(leg_node, prefix, m_shoe, m_sole, m_shirt)

    add_box(body, "HoodieTorso", (0.46, 0.58, 0.29), (0.0, 0.31, 0.0), m_shirt, bevel=0.032, taper_top=0.94)
    add_box(body, "ShortsWaist", (0.46, 0.16, 0.285), (0.0, -0.04, 0.0), m_pants, bevel=0.02)
    add_box(body, "KangarooPocket", (0.32, 0.18, 0.05), (0.0, 0.16, 0.15), m_hood_trim, bevel=0.014, taper_top=0.82)
    add_box(body, "DrapedHood", (0.34, 0.14, 0.16), (0.0, 0.58, -0.14), m_shirt, rot_three=(-0.35, 0.0, 0.0), bevel=0.025)
    # Science Mini-Backpack
    add_box(body, "BackpackMain", (0.34, 0.42, 0.16), (0.0, 0.31, -0.21), m_pack, bevel=0.028, taper_top=0.90)
    add_box(body, "BackpackPouch", (0.26, 0.18, 0.07), (0.0, 0.21, -0.30), m_accent, bevel=0.016)
    for sx in (-0.13, 0.13):
        add_box(body, f"PackStrap_{sx}", (0.055, 0.50, 0.04), (sx, 0.33, 0.14), m_pack, bevel=0.01)

    for arm_node, ax, prefix in ((arm_l, -1.0, "ArmL"), (arm_r, 1.0, "ArmR")):
        add_ico(arm_node, f"{prefix}_Shoulder", 0.088, 2, (0.0, 0.0, 0.0), m_shirt, scale_three=(1.0, 0.9, 1.05))
        add_box(arm_node, f"{prefix}_Sleeve", (0.13, 0.42, 0.145), (0.0, -0.21, 0.0), m_shirt, bevel=0.022)
        add_box(arm_node, f"{prefix}_Cuff", (0.135, 0.06, 0.15), (0.0, -0.42, 0.0), m_hood_trim, bevel=0.012)
        add_box(arm_node, f"{prefix}_Hand", (0.105, 0.105, 0.11), (0.0, -0.52, 0.0), m_skin, bevel=0.022)

    add_face_details(head, m_skin, m_eye, m_hair, brow_tilt=-0.12)
    add_box(head, "HairBack", (0.33, 0.20, 0.09), (0.0, 0.16, -0.135), m_hair, bevel=0.02)
    add_box(head, "CapCrown", (0.36, 0.12, 0.34), (0.0, 0.305, 0.0), m_cap, bevel=0.032, taper_top=0.88)
    add_box(head, "CapFrontPanel", (0.20, 0.08, 0.04), (0.0, 0.30, 0.16), m_hood_trim, bevel=0.01)
    add_box(head, "CapBrim", (0.30, 0.035, 0.17), (0.0, 0.265, 0.215), m_cap, rot_three=(0.08, 0.0, 0.0), bevel=0.012, taper_front=0.85)
    # Messy brown bangs peeking below the cap brim
    add_ico(head, "BangsL", 0.07, 1, (-0.08, 0.24, 0.155), m_hair, scale_three=(1.3, 0.7, 0.7))
    add_ico(head, "BangsR", 0.075, 1, (0.07, 0.245, 0.15), m_hair, scale_three=(1.2, 0.75, 0.7))

    export_glb("leo.glb")


# ---------------------------------------------------------------------------
# 3) Max (9 3/4-year-old star-loving son, scaled 0.60 in game)
# ---------------------------------------------------------------------------
def build_max():
    clear_scene()
    m_skin = make_mat("Skin", "#e0ac7e", roughness=0.58, metallic=0.0)
    m_shirt = make_mat("Shirt", "#06d6a0", roughness=0.48, metallic=0.02)
    m_pants = make_mat("Pants", "#3d405b", roughness=0.60, metallic=0.02)
    m_hair = make_mat("Hair", "#5a3825", roughness=0.68, metallic=0.0)
    m_star = make_mat("StarGold", "#ffd166", roughness=0.30, metallic=0.12, emit_hex="#ffd166", emit_strength=0.20)
    m_shoe = make_mat("Shoe", "#2b2d42", roughness=0.45, metallic=0.04)
    m_sole = make_mat("Sole", "#ffffff", roughness=0.52, metallic=0.02)
    m_eye = make_mat("Eye", "#1f242d", roughness=0.22, metallic=0.05)

    root, leg_l, leg_r, body, arm_l, arm_r, head = build_base_rig("MaxRoot")

    for leg_node, prefix in ((leg_l, "LegL"), (leg_r, "LegR")):
        add_box(leg_node, f"{prefix}_Jogger", (0.18, 0.76, 0.20), (0.0, -0.39, 0.0), m_pants, bevel=0.022, taper_top=1.08)
        add_sneaker(leg_node, prefix, m_shoe, m_sole, m_shirt)

    add_box(body, "MintHoodie", (0.47, 0.59, 0.29), (0.0, 0.31, 0.0), m_shirt, bevel=0.032, taper_top=0.95)
    add_box(body, "JoggerWaist", (0.46, 0.16, 0.285), (0.0, -0.04, 0.0), m_pants, bevel=0.02)
    add_box(body, "HoodBack", (0.34, 0.15, 0.16), (0.0, 0.57, -0.14), m_shirt, rot_three=(-0.35, 0.0, 0.0), bevel=0.025)
    # Star Emblem on Chest
    add_box(body, "ChestStarA", (0.14, 0.14, 0.03), (0.0, 0.36, 0.152), m_star, rot_three=(0.0, 0.0, 0.0), bevel=0.006)
    add_box(body, "ChestStarB", (0.14, 0.14, 0.03), (0.0, 0.36, 0.152), m_star, rot_three=(0.0, 0.0, math.pi * 0.25), bevel=0.006)

    for arm_node, prefix in ((arm_l, "ArmL"), (arm_r, "ArmR")):
        add_ico(arm_node, f"{prefix}_Shoulder", 0.088, 2, (0.0, 0.0, 0.0), m_shirt, scale_three=(1.0, 0.9, 1.05))
        add_box(arm_node, f"{prefix}_Sleeve", (0.135, 0.45, 0.15), (0.0, -0.225, 0.0), m_shirt, bevel=0.022)
        add_box(arm_node, f"{prefix}_Hand", (0.105, 0.105, 0.11), (0.0, -0.52, 0.0), m_skin, bevel=0.022)

    add_face_details(head, m_skin, m_eye, m_hair, brow_tilt=-0.10)
    add_box(head, "HairCap", (0.35, 0.11, 0.33), (0.0, 0.295, -0.01), m_hair, bevel=0.028)
    add_box(head, "HairBack", (0.34, 0.23, 0.09), (0.0, 0.165, -0.14), m_hair, bevel=0.022)
    for t_idx, (pos, scl, rot) in enumerate([
        ((-0.09, 0.37, 0.05), (1.0, 1.35, 1.0), (0.25, 0.0, 0.25)),
        ((0.08, 0.38, 0.02), (1.05, 1.4, 1.0), (0.1, 0.0, -0.25)),
        ((0.0, 0.36, 0.13), (1.15, 1.2, 1.0), (0.45, 0.0, 0.0)),
        ((-0.02, 0.35, -0.10), (1.1, 1.25, 1.1), (-0.35, 0.0, 0.1)),
    ]):
        add_ico(head, f"HairSpike_{t_idx}", 0.095, 1, pos, m_hair, scale_three=scl, rot_three=rot)

    export_glb("max.glb")


# ---------------------------------------------------------------------------
# 4) Gwen (Wife in Godzilla Kaiju Costume with wagging KaijuTail)
# ---------------------------------------------------------------------------
def build_gwen():
    clear_scene()
    m_skin = make_mat("Skin", "#f7d7c4", roughness=0.56, metallic=0.0)
    m_suit = make_mat("KaijuGreen", "#4caf50", roughness=0.52, metallic=0.04)
    m_belly = make_mat("KaijuBelly", "#81c784", roughness=0.48, metallic=0.04)
    m_spine = make_mat("KaijuSpine", "#a5d6a7", roughness=0.42, metallic=0.06)
    m_claw = make_mat("KaijuClaw", "#f8f9fa", roughness=0.35, metallic=0.05)
    m_hair = make_mat("Hair", "#7b3f00", roughness=0.65, metallic=0.0)
    m_eye = make_mat("Eye", "#1f242d", roughness=0.22, metallic=0.05)
    m_kaiju_eye = make_mat("KaijuEye", "#ffd166", roughness=0.18, metallic=0.06, emit_hex="#ffd166", emit_strength=0.6)

    root, leg_l, leg_r, body, arm_l, arm_r, head = build_base_rig("GwenRoot")

    # Stompy Godzilla costume legs & clawed dino feet
    for leg_node, prefix in ((leg_l, "LegL"), (leg_r, "LegR")):
        add_box(leg_node, f"{prefix}_SuitLeg", (0.19, 0.78, 0.21), (0.0, -0.40, 0.0), m_suit, bevel=0.025, taper_top=1.06)
        add_box(leg_node, f"{prefix}_DinoFoot", (0.21, 0.12, 0.30), (0.0, -0.84, 0.05), m_suit, bevel=0.025, taper_top=0.85)
        for tx in (-0.06, 0.0, 0.06):
            add_cyl(leg_node, f"{prefix}_ToeClaw_{tx}", 0.005, 0.028, 0.08, 6, (tx, -0.87, 0.22), m_claw, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.0)

    # Cozy onesie torso + ribbed belly scales + dorsal spikes
    add_box(body, "SuitTorso", (0.48, 0.62, 0.30), (0.0, 0.29, 0.0), m_suit, bevel=0.035, taper_top=0.92)
    add_box(body, "SuitPelvis", (0.48, 0.18, 0.30), (0.0, -0.05, 0.0), m_suit, bevel=0.028)
    for b_i in range(4):
        add_box(body, f"BellyScale_{b_i}", (0.28, 0.11, 0.05), (0.0, 0.44 - b_i * 0.13, 0.155), m_belly, bevel=0.015, taper_top=0.88)
    for s_i in range(4):
        add_cyl(body, f"BackSpine_{s_i}", 0.008, 0.085 - s_i * 0.01, 0.22, 6, (0.0, 0.56 - s_i * 0.17, -0.20), m_spine, rot_three=(-math.pi * 0.42, 0.0, 0.0), bevel=0.0)

    # Kaiju padded arms + mitten claws
    for arm_node, prefix in ((arm_l, "ArmL"), (arm_r, "ArmR")):
        add_ico(arm_node, f"{prefix}_Shoulder", 0.092, 2, (0.0, 0.0, 0.0), m_suit, scale_three=(1.0, 0.9, 1.05))
        add_box(arm_node, f"{prefix}_Sleeve", (0.145, 0.45, 0.16), (0.0, -0.225, 0.0), m_suit, bevel=0.025)
        add_box(arm_node, f"{prefix}_Mitten", (0.13, 0.12, 0.14), (0.0, -0.51, 0.01), m_suit, bevel=0.025)
        for cx in (-0.035, 0.035):
            add_cyl(arm_node, f"{prefix}_Claw_{cx}", 0.004, 0.02, 0.06, 6, (cx, -0.58, 0.06), m_claw, rot_three=(math.pi * 0.65, 0.0, 0.0), bevel=0.0)

    # Wagging KaijuTail pivot matching NPCManager (0, -0.05, -0.15)
    kaiju_tail = make_empty("KaijuTail", body, (0.0, -0.05, -0.15))
    for i in range(5):
        w = 0.30 - i * 0.048
        h = 0.26 - i * 0.04
        z = -0.16 - i * 0.28
        y = -i * 0.045
        add_box(kaiju_tail, f"TailSeg_{i}", (w, h, 0.30), (0.0, y, z), m_suit, bevel=0.025, taper_top=0.86)
        add_cyl(kaiju_tail, f"TailSpine_{i}", 0.006, 0.055 - i * 0.008, 0.14, 6, (0.0, y + h * 0.55, z), m_spine, rot_three=(-0.25, 0.0, 0.0), bevel=0.0)

    # Gwen's face + long hair inside the open Godzilla dino hood!
    add_face_details(head, m_skin, m_eye, m_hair, brow_tilt=-0.10)
    add_box(head, "HairBangs", (0.30, 0.08, 0.08), (0.0, 0.25, 0.12), m_hair, bevel=0.02)
    for sx in (-1.0, 1.0):
        add_box(head, f"HairTress_{sx}", (0.07, 0.28, 0.12), (sx * 0.16, 0.06, -0.02), m_hair, bevel=0.018)

    # Sculpted Godzilla hood: upper skull, snout, fangs, glowing eyes, chin-strap jaw
    add_box(head, "HoodCrown", (0.44, 0.19, 0.44), (0.0, 0.34, 0.01), m_suit, bevel=0.035, taper_top=0.88)
    add_box(head, "HoodBack", (0.42, 0.36, 0.12), (0.0, 0.15, -0.18), m_suit, bevel=0.03)
    add_box(head, "HoodSnout", (0.36, 0.12, 0.24), (0.0, 0.35, 0.27), m_suit, bevel=0.028, taper_front=0.78)
    add_box(head, "HoodLowerJaw", (0.38, 0.08, 0.24), (0.0, -0.08, 0.08), m_suit, bevel=0.02)
    for sx in (-0.11, 0.11):
        add_box(head, f"DinoEye_{sx}", (0.065, 0.065, 0.06), (sx, 0.42, 0.24), m_kaiju_eye, bevel=0.012)
        add_cyl(head, f"HoodNostril_{sx}", 0.015, 0.02, 0.03, 6, (sx * 0.65, 0.39, 0.38), m_spine, bevel=0.0)
    for f_i in range(4):
        add_cyl(head, f"HoodTooth_{f_i}", 0.004, 0.032, 0.075, 6, (-0.12 + f_i * 0.08, 0.27, 0.34), m_claw, rot_three=(math.pi, 0.0, 0.0), bevel=0.0)
    add_cyl(head, "HoodCrest", 0.008, 0.065, 0.16, 6, (0.0, 0.48, -0.08), m_spine, rot_three=(-0.3, 0.0, 0.0), bevel=0.0)

    export_glb("gwen.glb")


# ---------------------------------------------------------------------------
# 5) Grandma (Lavender cardigan, floral/mauve skirt, silver bun, round glasses)
# ---------------------------------------------------------------------------
def build_grandma():
    clear_scene()
    m_skin = make_mat("Skin", "#f2d0b5", roughness=0.58, metallic=0.0)
    m_cardigan = make_mat("Cardigan", "#b8a1e3", roughness=0.58, metallic=0.02)
    m_dress = make_mat("DressPlum", "#6d597a", roughness=0.58, metallic=0.02)
    m_lace = make_mat("LaceWhite", "#f8f9fa", roughness=0.50, metallic=0.02)
    m_hair = make_mat("HairSilver", "#e5e5e5", roughness=0.60, metallic=0.02)
    m_shoe = make_mat("Shoe", "#5c3b30", roughness=0.50, metallic=0.04)
    m_sole = make_mat("Sole", "#3b2822", roughness=0.55, metallic=0.02)
    m_eye = make_mat("Eye", "#1f242d", roughness=0.22, metallic=0.05)
    m_gold_rim = make_mat("GlassGold", "#e9c46a", roughness=0.25, metallic=0.35)
    m_glass = make_mat("GlassLens", "#bde0fe", roughness=0.10, metallic=0.08, emit_hex="#dff1ff", emit_strength=0.12)

    root, leg_l, leg_r, body, arm_l, arm_r, head = build_base_rig("GrandmaRoot")

    for leg_node, prefix in ((leg_l, "LegL"), (leg_r, "LegR")):
        add_box(leg_node, f"{prefix}_Leg", (0.145, 0.74, 0.155), (0.0, -0.39, 0.0), m_skin, bevel=0.02)
        add_sneaker(leg_node, prefix, m_shoe, m_sole)

    # Cozy cardigan + flared mauve skirt + collar + pearl necklace
    add_box(body, "CardiganBody", (0.47, 0.58, 0.29), (0.0, 0.31, 0.0), m_cardigan, bevel=0.032, taper_top=0.94)
    add_box(body, "CardiganBlouse", (0.16, 0.44, 0.04), (0.0, 0.36, 0.145), m_lace, bevel=0.01)
    add_cyl(body, "GrandmaSkirt", 0.26, 0.39, 0.62, 16, (0.0, -0.21, 0.0), m_dress, bevel=0.018)
    add_box(body, "ApronPocket", (0.28, 0.22, 0.03), (0.0, -0.10, 0.28), m_lace, bevel=0.012)
    for p_i in range(5):
        ang = (p_i - 2) * 0.28
        add_ico(body, f"Pearl_{p_i}", 0.022, 1, (math.sin(ang) * 0.11, 0.56 - math.cos(ang) * 0.02, 0.145 + math.cos(ang) * 0.01), m_lace)

    for arm_node, prefix in ((arm_l, "ArmL"), (arm_r, "ArmR")):
        add_ico(arm_node, f"{prefix}_Shoulder", 0.086, 2, (0.0, 0.0, 0.0), m_cardigan, scale_three=(1.0, 0.9, 1.05))
        add_box(arm_node, f"{prefix}_Sleeve", (0.13, 0.44, 0.145), (0.0, -0.22, 0.0), m_cardigan, bevel=0.022)
        add_box(arm_node, f"{prefix}_Hand", (0.10, 0.10, 0.105), (0.0, -0.51, 0.0), m_skin, bevel=0.022)

    add_face_details(head, m_skin, m_eye, m_hair, brow_tilt=-0.10)
    # Silver-white swept hair + sculpted back bun + wire glasses
    add_box(head, "SilverHairTop", (0.345, 0.11, 0.325), (0.0, 0.295, -0.01), m_hair, bevel=0.03)
    add_box(head, "SilverHairBack", (0.34, 0.23, 0.09), (0.0, 0.165, -0.135), m_hair, bevel=0.022)
    add_ico(head, "SilverBun", 0.125, 2, (0.0, 0.35, -0.13), m_hair, scale_three=(1.05, 0.92, 0.95))
    add_cyl(head, "BunPin", 0.012, 0.012, 0.22, 6, (0.0, 0.35, -0.13), m_gold_rim, rot_three=(0.0, 0.0, math.pi * 0.42), bevel=0.0)
    # Round reading glasses
    add_box(head, "RoundBridge", (0.05, 0.014, 0.014), (0.0, 0.125, 0.165), m_gold_rim, bevel=0.003)
    for sx in (-0.072, 0.072):
        add_cyl(head, f"RoundRim_{sx}", 0.052, 0.052, 0.018, 14, (sx, 0.12, 0.162), m_gold_rim, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.003)
        add_cyl(head, f"RoundLens_{sx}", 0.042, 0.042, 0.022, 14, (sx, 0.12, 0.163), m_glass, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.002)

    export_glb("grandma.glb")


# ---------------------------------------------------------------------------
# 6) Street Thug / Mystery Thief (Bandit eye-mask, beanie cap, bomber jacket)
# ---------------------------------------------------------------------------
def build_thug():
    clear_scene()
    m_skin = make_mat("Skin", "#e0ac7e", roughness=0.58, metallic=0.0)
    m_shirt = make_mat("Shirt", "#2b2d42", roughness=0.50, metallic=0.05)
    m_inner = make_mat("InnerTee", "#e5e5e5", roughness=0.55, metallic=0.0)
    m_pants = make_mat("Pants", "#1b1b1b", roughness=0.58, metallic=0.04)
    m_hair = make_mat("Hair", "#111111", roughness=0.65, metallic=0.0)
    m_hat = make_mat("Hat", "#111111", roughness=0.55, metallic=0.04)
    m_mask = make_mat("BanditMask", "#111111", roughness=0.45, metallic=0.08)
    m_boot = make_mat("Shoe", "#151519", roughness=0.42, metallic=0.08)
    m_sole = make_mat("Sole", "#3d405b", roughness=0.50, metallic=0.05)
    m_metal = make_mat("Metal", "#8d99ae", roughness=0.30, metallic=0.25)
    m_eye = make_mat("Eye", "#ffffff", roughness=0.22, metallic=0.05)

    root, leg_l, leg_r, body, arm_l, arm_r, head = build_base_rig("ThugRoot")

    for leg_node, prefix in ((leg_l, "LegL"), (leg_r, "LegR")):
        add_box(leg_node, f"{prefix}_Trouser", (0.185, 0.78, 0.205), (0.0, -0.40, 0.0), m_pants, bevel=0.022, taper_top=1.08)
        add_sneaker(leg_node, prefix, m_boot, m_sole)

    # Bomber / Hoodie jacket + open collar + utility sash + belt
    add_box(body, "JacketTorso", (0.49, 0.60, 0.30), (0.0, 0.31, 0.0), m_shirt, bevel=0.032, taper_top=0.95)
    add_box(body, "TeeCollar", (0.16, 0.44, 0.035), (0.0, 0.35, 0.145), m_inner, bevel=0.01)
    add_box(body, "JacketCollar", (0.36, 0.11, 0.24), (0.0, 0.60, -0.02), m_hat, bevel=0.02)
    add_box(body, "Pelvis", (0.47, 0.17, 0.29), (0.0, -0.04, 0.0), m_pants, bevel=0.02)
    add_box(body, "Belt", (0.49, 0.065, 0.305), (0.0, 0.04, 0.0), m_hat, bevel=0.01)
    add_box(body, "BeltBuckle", (0.09, 0.075, 0.035), (0.0, 0.04, 0.155), m_metal, bevel=0.008)
    add_box(body, "ShoulderStrap", (0.07, 0.64, 0.33), (0.0, 0.31, 0.0), m_mask, rot_three=(0.0, 0.0, 0.55), bevel=0.008)

    for arm_node, ax, prefix in ((arm_l, -1.0, "ArmL"), (arm_r, 1.0, "ArmR")):
        add_ico(arm_node, f"{prefix}_Shoulder", 0.095, 2, (0.0, 0.0, 0.0), m_shirt, scale_three=(1.05, 0.92, 1.05))
        add_box(arm_node, f"{prefix}_Sleeve", (0.145, 0.45, 0.16), (0.0, -0.225, 0.0), m_shirt, bevel=0.024)
        add_box(arm_node, f"{prefix}_Glove", (0.115, 0.09, 0.12), (0.0, -0.50, 0.0), m_mask, bevel=0.02)
        add_box(arm_node, f"{prefix}_Fingers", (0.105, 0.055, 0.11), (0.0, -0.555, 0.0), m_skin, bevel=0.015)

    add_face_details(head, m_skin, m_eye, m_hair, brow_tilt=0.18, smile=False)
    # Bandit Eye Mask + Low Beanie Cap
    add_box(head, "BanditMask", (0.345, 0.095, 0.325), (0.0, 0.12, 0.008), m_mask, bevel=0.018)
    add_box(head, "BeanieBase", (0.36, 0.125, 0.34), (0.0, 0.30, -0.01), m_hat, bevel=0.034, taper_top=0.84)
    add_box(head, "BeanieFold", (0.375, 0.065, 0.355), (0.0, 0.245, -0.005), m_shirt, bevel=0.018)
    add_box(head, "CapBrim", (0.28, 0.032, 0.15), (0.0, 0.24, 0.205), m_hat, rot_three=(0.14, 0.0, 0.0), bevel=0.01, taper_front=0.84)

    export_glb("thug.glb")


# ---------------------------------------------------------------------------
# 7) Optional All-Cast Showcase .blend for quick inspection in Blender.app
# ---------------------------------------------------------------------------
def build_showcase_blend():
    clear_scene()
    models = [
        ("humanoid.glb", -4.5),
        ("leo.glb", -2.7),
        ("max.glb", -1.1),
        ("gwen.glb", 0.7),
        ("grandma.glb", 2.5),
        ("thug.glb", 4.3),
    ]
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../public/models"))
    for fname, x_off in models:
        bpy.ops.import_scene.gltf(filepath=os.path.join(out_dir, fname))
        for obj in bpy.context.selected_objects:
            if obj.parent is None:
                obj.location.x += x_off

    bpy.ops.object.light_add(type="SUN", location=(3.0, -5.0, 8.0))
    bpy.context.active_object.data.energy = 3.0
    blend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "npcs_showcase.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved cast showcase blend to: {blend_path}")


if __name__ == "__main__":
    build_generic_humanoid()
    build_leo()
    build_max()
    build_gwen()
    build_grandma()
    build_thug()
    build_showcase_blend()
