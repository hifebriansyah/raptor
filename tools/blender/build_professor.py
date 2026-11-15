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


def make_mat(name, hex_color, roughness=0.42, metallic=0.05, emit_hex=None, emit_strength=0.0):
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
    obj.empty_display_size = 0.08
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


def add_box(parent, name, size_three, pos_three, mat, rot_three=(0.0, 0.0, 0.0), bevel=0.015, taper_top=1.0, taper_front=1.0):
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


def build_professor():
    clear_scene()

    # Materials matched to Professor.ts palette
    m_coat = make_mat("CoatWhite", "#f5f7fa", roughness=0.52, metallic=0.02)
    m_coat_trim = make_mat("CoatTrim", "#dfe6ef", roughness=0.50, metallic=0.04)
    m_pants = make_mat("PantsSlate", "#4a5568", roughness=0.62, metallic=0.02)
    m_shoe = make_mat("ShoeDark", "#2d3748", roughness=0.50, metallic=0.04)
    m_sole = make_mat("ShoeSole", "#e2e8f0", roughness=0.55, metallic=0.02)
    m_skin = make_mat("Skin", "#f2c9a0", roughness=0.58, metallic=0.0)
    m_hair = make_mat("HairBrown", "#6b4226", roughness=0.68, metallic=0.0)
    m_shirt = make_mat("ShirtBlue", "#6fb1fc", roughness=0.55, metallic=0.0)
    m_tie = make_mat("TieRed", "#e63946", roughness=0.45, metallic=0.05)
    m_belt = make_mat("BeltDark", "#2b2d42", roughness=0.45, metallic=0.12)
    m_metal = make_mat("MetalTrim", "#8d99ae", roughness=0.30, metallic=0.22)
    m_eye = make_mat("EyeDark", "#1f242d", roughness=0.22, metallic=0.05)
    m_goggle_frame = make_mat("GoggleFrame", "#3d405b", roughness=0.38, metallic=0.14)
    m_goggle_lens = make_mat("GoggleLens", "#ffd166", roughness=0.18, metallic=0.08, emit_hex="#ffbe0b", emit_strength=0.65)
    m_blaster_body = make_mat("BlasterOrange", "#ff9f1c", roughness=0.30, metallic=0.08)
    m_blaster_tank = make_mat("BlasterTank", "#4cc9f0", roughness=0.18, metallic=0.06, emit_hex="#4cc9f0", emit_strength=0.25)

    root = make_empty("ProfessorRoot", None, (0.0, 0.0, 0.0))

    # 1) Legs (LegL, LegR pivoted at hips y = 0.95)
    for leg_name, lx in (("LegL", -0.14), ("LegR", 0.14)):
        leg = make_empty(leg_name, root, (lx, 0.95, 0.0))
        add_box(leg, f"{leg_name}_Trouser", (0.19, 0.80, 0.21), (0.0, -0.41, 0.0), m_pants, bevel=0.025, taper_top=1.08)
        add_box(leg, f"{leg_name}_Cuff", (0.205, 0.08, 0.225), (0.0, -0.78, 0.0), m_coat_trim, bevel=0.015)
        # Sculpted sneaker/boot
        add_box(leg, f"{leg_name}_ShoeUpper", (0.20, 0.10, 0.30), (0.0, -0.87, 0.04), m_shoe, bevel=0.025, taper_top=0.86, taper_front=0.88)
        add_box(leg, f"{leg_name}_ShoeToe", (0.18, 0.07, 0.12), (0.0, -0.89, 0.16), m_shoe, bevel=0.02, taper_top=0.78)
        add_box(leg, f"{leg_name}_ShoeSole", (0.21, 0.045, 0.34), (0.0, -0.93, 0.05), m_sole, bevel=0.012)
        add_box(leg, f"{leg_name}_ShoeTongue", (0.12, 0.06, 0.06), (0.0, -0.81, 0.09), m_shirt, rot_three=(-0.3, 0.0, 0.0), bevel=0.01)

    # 2) Torso (pivoted at hips y = 0.95)
    torso = make_empty("Torso", root, (0.0, 0.95, 0.0))
    # Main lab coat chest + flared lower coat skirt
    add_box(torso, "CoatChest", (0.50, 0.62, 0.31), (0.0, 0.33, 0.0), m_coat, bevel=0.03, taper_top=0.94)
    add_box(torso, "CoatSkirt", (0.55, 0.34, 0.34), (0.0, -0.02, 0.0), m_coat, bevel=0.03, taper_top=0.92)
    add_box(torso, "CoatCollarBack", (0.34, 0.08, 0.14), (0.0, 0.64, -0.04), m_coat_trim, bevel=0.015)
    # Lapels framing the open lab coat
    for sx in (-1.0, 1.0):
        add_box(torso, f"CoatLapel_{sx}", (0.10, 0.32, 0.06), (sx * 0.11, 0.48, 0.155), m_coat_trim, rot_three=(0.0, 0.0, sx * -0.18), bevel=0.012)
        add_box(torso, f"CoatPocket_{sx}", (0.14, 0.14, 0.03), (sx * 0.16, 0.04, 0.165), m_coat_trim, bevel=0.008)
    # Breast pocket + clipped pen caps on left chest
    add_box(torso, "BreastPocket", (0.11, 0.10, 0.025), (-0.15, 0.44, 0.16), m_coat_trim, bevel=0.006)
    add_cyl(torso, "PocketPenBlue", 0.012, 0.012, 0.07, 8, (-0.17, 0.50, 0.165), m_blaster_tank, bevel=0.0)
    add_cyl(torso, "PocketPenOrange", 0.012, 0.012, 0.07, 8, (-0.13, 0.50, 0.165), m_blaster_body, bevel=0.0)

    # Shirt, knot & tapered crimson tie
    add_box(torso, "ShirtFront", (0.18, 0.52, 0.04), (0.0, 0.35, 0.15), m_shirt, bevel=0.01)
    add_box(torso, "TieKnot", (0.065, 0.065, 0.04), (0.0, 0.57, 0.175), m_tie, bevel=0.012, taper_top=1.2)
    add_box(torso, "TieBlade", (0.06, 0.30, 0.025), (0.0, 0.39, 0.175), m_tie, bevel=0.008, taper_top=0.72)

    # Belt & metallic buckle peeking under jacket
    add_box(torso, "WaistBelt", (0.52, 0.07, 0.33), (0.0, 0.08, 0.005), m_belt, bevel=0.012)
    add_box(torso, "BeltBuckle", (0.10, 0.08, 0.04), (0.0, 0.08, 0.17), m_metal, bevel=0.01)

    # 3) Arms (ArmL, ArmR pivoted at shoulders ±0.32, 0.58, 0)
    for arm_name, ax in (("ArmL", -0.32), ("ArmR", 0.32)):
        arm = make_empty(arm_name, torso, (ax, 0.58, 0.0))
        add_ico(arm, f"{arm_name}_Shoulder", 0.095, 2, (0.0, 0.0, 0.0), m_coat, scale_three=(1.0, 0.9, 1.05))
        add_box(arm, f"{arm_name}_Sleeve", (0.145, 0.48, 0.16), (0.0, -0.24, 0.0), m_coat, bevel=0.025, taper_top=0.92)
        add_box(arm, f"{arm_name}_Cuff", (0.155, 0.07, 0.17), (0.0, -0.47, 0.0), m_coat_trim, bevel=0.015)
        add_box(arm, f"{arm_name}_Hand", (0.115, 0.115, 0.12), (0.0, -0.57, 0.0), m_skin, bevel=0.025)
        add_box(arm, f"{arm_name}_Thumb", (0.045, 0.055, 0.06), (-0.05 if ax > 0 else 0.05, -0.55, 0.05), m_skin, bevel=0.01)

        if arm_name == "ArmR":
            # Handheld Water Blaster: nozzle stays aligned at (0, -0.60, 0.32)
            add_box(arm, "BlasterBody", (0.115, 0.14, 0.34), (0.0, -0.60, 0.12), m_blaster_body, bevel=0.02, taper_front=0.88)
            add_box(arm, "BlasterGrip", (0.075, 0.12, 0.09), (0.0, -0.57, 0.02), m_belt, rot_three=(0.15, 0.0, 0.0), bevel=0.012)
            add_cyl(arm, "BlasterTank", 0.072, 0.072, 0.18, 14, (0.0, -0.49, 0.03), m_blaster_tank, bevel=0.012)
            add_cyl(arm, "BlasterTankCap", 0.055, 0.068, 0.035, 12, (0.0, -0.39, 0.03), m_metal, bevel=0.008)
            add_cyl(arm, "BlasterBarrel", 0.042, 0.050, 0.11, 12, (0.0, -0.60, 0.28), m_metal, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.008)
            add_cyl(arm, "BlasterNozzleTip", 0.055, 0.046, 0.045, 12, (0.0, -0.60, 0.325), m_blaster_body, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.008)

    # 4) Head (pivoted at neck base y = 0.82 on torso)
    head = make_empty("Head", torso, (0.0, 0.82, 0.0))
    add_cyl(head, "Neck", 0.085, 0.095, 0.12, 12, (0.0, -0.04, 0.0), m_skin, bevel=0.01)
    add_box(head, "HeadCranium", (0.34, 0.36, 0.32), (0.0, 0.10, 0.0), m_skin, bevel=0.045, taper_top=0.96)
    add_box(head, "Nose", (0.055, 0.065, 0.06), (0.0, 0.08, 0.165), m_skin, bevel=0.018, taper_top=0.75)
    for sx in (-1.0, 1.0):
        add_box(head, f"Ear_{sx}", (0.045, 0.095, 0.07), (sx * 0.175, 0.09, -0.01), m_skin, bevel=0.015)
        add_box(head, f"Eye_{sx}", (0.048, 0.055, 0.025), (sx * 0.075, 0.115, 0.158), m_eye, bevel=0.008)
        add_box(head, f"Brow_{sx}", (0.072, 0.024, 0.025), (sx * 0.078, 0.162, 0.158), m_hair, rot_three=(0.0, 0.0, sx * -0.14), bevel=0.006)
    # Determined smirk/mouth line
    add_box(head, "Mouth", (0.09, 0.018, 0.018), (0.0, 0.015, 0.16), m_hair, bevel=0.004)

    # Sculpted messy scientist hair
    add_box(head, "HairCrown", (0.37, 0.12, 0.35), (0.0, 0.30, -0.01), m_hair, bevel=0.03)
    add_box(head, "HairBack", (0.36, 0.22, 0.08), (0.0, 0.18, -0.15), m_hair, bevel=0.025)
    for sx in (-1.0, 1.0):
        add_box(head, f"HairSide_{sx}", (0.065, 0.17, 0.28), (sx * 0.175, 0.20, -0.02), m_hair, bevel=0.02)
    hair_tufts = [
        ("Tuft_0", 0.115, (-0.10, 0.38, 0.06), (1.1, 1.25, 0.9), (0.2, 0.0, 0.3)),
        ("Tuft_1", 0.125, (0.08, 0.40, -0.05), (1.15, 1.3, 0.95), (-0.25, 0.2, -0.2)),
        ("Tuft_2", 0.105, (-0.01, 0.37, 0.13), (1.2, 1.05, 1.1), (0.4, 0.0, 0.1)),
        ("Tuft_3", 0.095, (0.13, 0.35, 0.08), (1.0, 1.15, 1.0), (0.25, -0.2, -0.35)),
        ("Tuft_4", 0.100, (-0.12, 0.33, -0.11), (1.1, 1.1, 1.15), (-0.4, 0.15, 0.2)),
    ]
    for t_name, rad, pos, scl, rot in hair_tufts:
        add_ico(head, t_name, rad, 1, pos, m_hair, scale_three=scl, rot_three=rot)

    # Forehead Inventor Goggles (strap + dual beveled housings + glowing amber lenses)
    add_box(head, "GoggleStrap", (0.375, 0.055, 0.355), (0.0, 0.235, 0.0), m_goggle_frame, bevel=0.015)
    add_box(head, "GoggleBridge", (0.06, 0.04, 0.04), (0.0, 0.245, 0.17), m_goggle_frame, bevel=0.008)
    for sx in (-0.082, 0.082):
        add_cyl(head, f"GoggleRim_{sx}", 0.072, 0.074, 0.055, 16, (sx, 0.245, 0.168), m_goggle_frame, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.008)
        add_cyl(head, f"GoggleLens_{sx}", 0.054, 0.054, 0.062, 14, (sx, 0.245, 0.172), m_goggle_lens, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.004)

    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../public/models"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "professor.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )
    print(f"Exported Professor GLB to: {out_path} ({os.path.getsize(out_path)} bytes)")

    # Add a sun light and save an inspectable .blend scene after GLB export
    bpy.ops.object.light_add(type="SUN", location=(3.0, -4.0, 6.0))
    bpy.context.active_object.data.energy = 3.0
    blend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "professor.blend"))
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved Professor blend to: {blend_path}")


if __name__ == "__main__":
    build_professor()
