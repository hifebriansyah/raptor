import math
import os
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

# Coordinate conversion: Three.js (+X, +Y up, +Z forward) -> Blender (+X, -Z forward, +Y up)
# With Blender's default glTF export (export_yup=True), Blender (x, -z, y) exports cleanly back to (x, y, z).
def to_bl(x: float, y: float, z: float) -> Vector:
    return Vector((x, -z, y))


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name: str, hex_col: str, roughness: float = 0.42, metallic: float = 0.0, emissive: bool = False):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name=name)
    if not mat.use_nodes:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    hex_str = hex_col.lstrip("#")
    r = int(hex_str[0:2], 16) / 255.0
    g = int(hex_str[2:4], 16) / 255.0
    b = int(hex_str[4:6], 16) / 255.0
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    col = (lin(r), lin(g), lin(b), 1.0)
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emissive:
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = 1.6
    return mat


def make_empty(name: str, parent=None, pos_three=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.25
    bpy.context.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = to_bl(*pos_three)
    return obj


def _finalize_mesh(bm: bmesh.types.BMesh, name: str, mat, parent, loc_three=(0.0, 0.0, 0.0), rot_three=(0.0, 0.0, 0.0), bevel_amt: float = 0.0):
    if rot_three != (0.0, 0.0, 0.0):
        # Convert Three.js XYZ Euler into Blender axes cleanly via 3x3 matrix
        m_t = Euler((rot_three[0], rot_three[1], rot_three[2]), "XYZ").to_matrix()
        # Basis change P: v_bl = P * v_three, where P = [[1,0,0],[0,0,-1],[0,1,0]]
        p = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
        m_bl = p @ m_t @ p.inverted()
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0.0, 0.0, 0.0), matrix=m_bl)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = to_bl(*loc_three)

    if bevel_amt > 0.0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = bevel_amt
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(32.0)
        bev.harden_normals = True
        wn = obj.modifiers.new(name="WeightedNormal", type="WEIGHTED_NORMAL")
        wn.keep_sharp = True

    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def add_box(parent, name: str, size_three, loc_three=(0.0, 0.0, 0.0), mat=None, rot_three=(0.0, 0.0, 0.0), bevel: float = 0.035, taper_top: float = 1.0, taper_front: float = 1.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size_three
    for v in bm.verts:
        vx = v.co.x * sx
        vy = -v.co.y * sz  # Blender Y maps to -Z_three
        vz = v.co.z * sy
        if vz > 0.0 and taper_top != 1.0:
            vx *= taper_top
            vy *= taper_top
        if vy < 0.0 and taper_front != 1.0:
            vx *= taper_front
            vz *= taper_front
        v.co = Vector((vx, vy, vz))
    return _finalize_mesh(bm, name, mat, parent, loc_three, rot_three, bevel)


def add_cyl(parent, name: str, r_top: float, r_bot: float, height: float, segs: int, loc_three=(0.0, 0.0, 0.0), mat=None, rot_three=(0.0, 0.0, 0.0), bevel: float = 0.015):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r_bot, radius2=r_top, depth=height)
    return _finalize_mesh(bm, name, mat, parent, loc_three, rot_three, bevel)


def add_sphere(parent, name: str, radius: float, segs: int, rings: int, loc_three=(0.0, 0.0, 0.0), mat=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    return _finalize_mesh(bm, name, mat, parent, loc_three, (0.0, 0.0, 0.0), 0.0)


def build_mecha_raptor() -> None:
    clear_scene()

    # Keep metallic low (0.0-0.15) so surfaces stay bright under Three.js directional/hemisphere lights without an IBL env map
    m_hull = make_mat("HullTeal", "#2a9d8f", roughness=0.40, metallic=0.05)
    m_hull_dark = make_mat("HullDarkTeal", "#1d6f66", roughness=0.46, metallic=0.05)
    m_accent = make_mat("AccentOrange", "#f4a261", roughness=0.35, metallic=0.08)
    m_metal = make_mat("MetalSteel", "#a3b1c6", roughness=0.32, metallic=0.15)
    m_dark = make_mat("DarkFrame", "#2b2d42", roughness=0.50, metallic=0.08)
    m_leather = make_mat("SaddleLeather", "#6d4c41", roughness=0.74, metallic=0.0)
    m_tank = make_mat("WaterTankCyan", "#4cc9f0", roughness=0.20, metallic=0.05)
    m_white = make_mat("ClawToothWhite", "#f8f9fa", roughness=0.30, metallic=0.05)
    m_eye = make_mat("EyeVisor", "#5ef2ff", roughness=0.15, metallic=0.0, emissive=True)
    m_glow_orange = make_mat("ThrusterGlow", "#ff9f1c", roughness=0.20, metallic=0.0, emissive=True)

    root = make_empty("MechaRaptorRoot", None, (0.0, 0.0, 0.0))

    # 1) Pelvis (at y = 1.95 to match MechaRaptor.ts standing height)
    pelvis = make_empty("Pelvis", root, (0.0, 1.95, 0.0))

    # Main sculpted bevelled fuselage armor + tapered forward chest + ribbed steel underbelly
    add_box(pelvis, "TorsoHull", (1.48, 1.24, 2.35), (0.0, 0.34, 0.08), m_hull, bevel=0.07, taper_top=0.88, taper_front=0.92)
    add_box(pelvis, "ChestProw", (1.16, 0.86, 0.90), (0.0, 0.24, 1.05), m_hull_dark, bevel=0.05, taper_front=0.78)
    add_box(pelvis, "BellySkid", (1.16, 0.44, 1.92), (0.0, -0.34, 0.16), m_metal, bevel=0.04, taper_front=0.85)
    add_box(pelvis, "DorsalCowl", (1.58, 0.24, 1.62), (0.0, 1.02, -0.18), m_hull_dark, bevel=0.04)

    # Side cooling louver plates
    for sx in (-1.0, 1.0):
        for v_i in range(3):
            add_box(pelvis, f"Vent_{sx}_{v_i}", (0.14, 0.20, 0.34), (sx * 0.72, 0.18, 0.45 - v_i * 0.44), m_dark, rot_three=(0.0, 0.0, sx * 0.18), bevel=0.02)

    # 4 swept dorsal spine fins
    for i in range(4):
        add_box(pelvis, f"Spine_{i}", (0.20, 0.34, 0.32), (0.0, 1.22, 0.52 - i * 0.48), m_accent, rot_three=(-0.22, 0.0, 0.0), bevel=0.025, taper_top=0.45)

    # Saddle + padded backrest + handlebar post & grips
    add_box(pelvis, "SaddleSeat", (0.76, 0.16, 0.92), (0.0, 1.18, 0.54), m_leather, bevel=0.04, taper_top=0.90)
    add_box(pelvis, "SaddleBack", (0.78, 0.36, 0.14), (0.0, 1.36, 0.10), m_leather, rot_three=(-0.15, 0.0, 0.0), bevel=0.03)
    add_cyl(pelvis, "HandleStem", 0.045, 0.055, 0.42, 10, (0.0, 1.35, 1.15), m_dark, rot_three=(0.25, 0.0, 0.0))
    add_cyl(pelvis, "HandleBar", 0.045, 0.045, 0.96, 10, (0.0, 1.55, 1.19), m_dark, rot_three=(0.0, 0.0, math.pi * 0.5))
    for sx in (-0.48, 0.48):
        add_cyl(pelvis, f"GripCap_{sx}", 0.06, 0.06, 0.12, 10, (sx, 1.55, 1.19), m_accent, rot_three=(0.0, 0.0, math.pi * 0.5))

    # 2) Swiveling Water Cannon Turret + Pitching Barrel + Tank
    turret = make_empty("Turret", pelvis, (0.0, 1.25, -0.75))
    add_cyl(turret, "TurretRing", 0.36, 0.42, 0.28, 16, (0.0, 0.0, 0.0), m_metal)
    add_cyl(turret, "WaterTank", 0.30, 0.30, 0.82, 16, (0.0, 0.22, -0.35), m_tank, rot_three=(math.pi * 0.5, 0.0, 0.0))
    for tz in (-0.15, -0.55):
        add_cyl(turret, f"TankStrap_{tz}", 0.32, 0.32, 0.08, 16, (0.0, 0.22, tz), m_dark, rot_three=(math.pi * 0.5, 0.0, 0.0))

    turret_barrel = make_empty("TurretBarrel", turret, (0.0, 0.25, 0.0))
    add_cyl(turret_barrel, "BarrelShroud", 0.11, 0.14, 1.12, 12, (0.0, 0.0, 0.52), m_dark, rot_three=(math.pi * 0.5, 0.0, 0.0))
    add_cyl(turret_barrel, "BarrelJacket", 0.15, 0.15, 0.42, 12, (0.0, 0.0, 0.30), m_metal, rot_three=(math.pi * 0.5, 0.0, 0.0))
    add_cyl(turret_barrel, "MuzzleCollar", 0.15, 0.13, 0.14, 12, (0.0, 0.0, 1.07), m_accent, rot_three=(math.pi * 0.5, 0.0, 0.0))

    # 3) Side Wing Pods, VTOL Thrusters & Swept Feathered Wings
    for sx, w_name in ((-1.0, "WingL"), (1.0, "WingR")):
        add_box(pelvis, f"WingPod_{w_name}", (0.24, 0.68, 1.62), (sx * 0.85, 0.55, -0.10), m_hull_dark, rot_three=(0.0, 0.0, sx * 0.15), bevel=0.04)
        add_box(pelvis, f"WingPodStripe_{w_name}", (0.08, 0.46, 1.24), (sx * 0.97, 0.60, -0.10), m_accent, bevel=0.02)
        add_cyl(pelvis, f"VTOLBell_{w_name}", 0.18, 0.25, 0.26, 12, (sx * 0.85, 0.14, -0.10), m_dark)

        wing = make_empty(w_name, pelvis, (sx * 0.95, 0.85, -0.10))
        add_box(wing, f"{w_name}_Spar", (3.65, 0.16, 0.22), (sx * 1.82, 0.05, 0.25), m_metal, bevel=0.03, taper_top=0.85)
        add_box(wing, f"{w_name}_Tip", (0.45, 0.18, 0.32), (sx * 3.55, 0.05, 0.18), m_accent, bevel=0.03)
        for f_i in range(3):
            plate_len = 3.45 - f_i * 0.68
            plate_col = m_accent if f_i == 1 else (m_hull if f_i == 0 else m_hull_dark)
            add_box(
                wing,
                f"{w_name}_Feather_{f_i}",
                (plate_len, 0.09, 0.68),
                (sx * (1.70 - f_i * 0.34), -0.02 * f_i, -0.20 - f_i * 0.55),
                plate_col,
                rot_three=(0.0, sx * 0.12 * f_i, 0.0),
                bevel=0.02,
                taper_front=0.92,
            )

    # Rear Jet Thrusters
    for sx in (-0.40, 0.40):
        add_cyl(pelvis, f"JetHousing_{sx}", 0.23, 0.29, 0.54, 14, (sx, 0.20, -1.16), m_dark, rot_three=(math.pi * 0.5, 0.0, 0.0))
        add_cyl(pelvis, f"JetGlow_{sx}", 0.17, 0.17, 0.05, 14, (sx, 0.20, -1.43), m_glow_orange, rot_three=(math.pi * 0.5, 0.0, 0.0))

    # 4) 4 Race Mode Wheels (Holder -> Spin with sculpted tire + 5-spoke orange alloy rim)
    wheel_specs = [
        ("WheelFL", (-0.95, -0.55, 0.95)),
        ("WheelFR", (0.95, -0.55, 0.95)),
        ("WheelRL", (-0.95, -0.55, -0.85)),
        ("WheelRR", (0.95, -0.55, -0.85)),
    ]
    for w_name, w_pos in wheel_specs:
        holder = make_empty(w_name, pelvis, w_pos)
        spin = make_empty(f"{w_name}_Spin", holder, (0.0, 0.0, 0.0))
        add_cyl(spin, f"{w_name}_Tire", 0.50, 0.50, 0.40, 20, (0.0, 0.0, 0.0), m_dark, rot_three=(0.0, 0.0, math.pi * 0.5), bevel=0.03)
        add_cyl(spin, f"{w_name}_RimDish", 0.31, 0.31, 0.42, 14, (0.0, 0.0, 0.0), m_metal, rot_three=(0.0, 0.0, math.pi * 0.5))
        add_cyl(spin, f"{w_name}_Hub", 0.14, 0.14, 0.46, 10, (0.0, 0.0, 0.0), m_accent, rot_three=(0.0, 0.0, math.pi * 0.5))
        for sp in range(5):
            ang = sp * (math.tau / 5.0)
            add_box(spin, f"{w_name}_Spoke_{sp}", (0.44, 0.09, 0.30), (0.0, math.sin(ang) * 0.16, math.cos(ang) * 0.16), m_accent, rot_three=(ang, 0.0, 0.0), bevel=0.01)

    # 5) Articulated Neck, Sculpted Head, Glowing Eyes & Hinged Jaw
    neck = make_empty("Neck", pelvis, (0.0, 0.85, 1.25))
    add_box(neck, "NeckArmor", (0.60, 0.58, 1.12), (0.0, 0.36, 0.40), m_hull, rot_three=(-0.60, 0.0, 0.0), bevel=0.05, taper_top=0.86)
    add_box(neck, "NeckSpine", (0.16, 0.22, 0.72), (0.0, 0.58, 0.28), m_accent, rot_three=(-0.60, 0.0, 0.0), bevel=0.02)

    head = make_empty("Head", neck, (0.0, 0.80, 0.95))
    add_box(head, "Cranium", (0.76, 0.58, 1.12), (0.0, 0.06, 0.36), m_hull, bevel=0.06, taper_top=0.84, taper_front=0.72)
    add_box(head, "HeadCrest", (0.78, 0.14, 0.92), (0.0, 0.38, 0.26), m_accent, rot_three=(0.08, 0.0, 0.0), bevel=0.03, taper_top=0.72)
    for sx in (-0.31, 0.31):
        add_box(head, f"EyeSocket_{sx}", (0.12, 0.18, 0.28), (sx * 0.96, 0.18, 0.54), m_dark, bevel=0.015)
        add_box(head, f"EyeLens_{sx}", (0.14, 0.12, 0.22), (sx, 0.18, 0.55), m_eye, bevel=0.01)

    # Upper teeth along snout edge
    for sx in (-0.26, 0.26):
        for tz in (0.54, 0.72, 0.88):
            add_cyl(head, f"UpperTooth_{sx}_{tz}", 0.005, 0.042, 0.12, 6, (sx, -0.25, tz), m_white, rot_three=(math.pi, 0.0, 0.0), bevel=0.0)

    jaw = make_empty("Jaw", head, (0.0, -0.20, 0.0))
    add_box(jaw, "LowerJaw", (0.64, 0.18, 1.00), (0.0, -0.05, 0.42), m_hull_dark, bevel=0.04, taper_front=0.72)
    for sx in (-0.22, 0.22):
        for tz in (0.60, 0.78):
            add_cyl(jaw, f"LowerTooth_{sx}_{tz}", 0.005, 0.036, 0.10, 6, (sx, 0.06, tz), m_white, bevel=0.0)

    # Forearms with curved claws
    for sx in (-1.0, 1.0):
        arm = make_empty(f"Forearm_{sx}", pelvis, (sx * 0.65, -0.05, 1.10))
        add_box(arm, f"UpperArm_{sx}", (0.20, 0.54, 0.20), (0.0, -0.24, 0.15), m_metal, rot_three=(0.55, 0.0, 0.0), bevel=0.03)
        add_box(arm, f"ClawPalm_{sx}", (0.24, 0.12, 0.32), (0.0, -0.44, 0.36), m_dark, rot_three=(0.45, 0.0, 0.0), bevel=0.02)
        for cx in (-0.07, 0.07):
            add_cyl(arm, f"ArmClaw_{sx}_{cx}", 0.005, 0.035, 0.20, 6, (cx, -0.50, 0.56), m_white, rot_three=(1.35, 0.0, 0.0), bevel=0.0)

    # 6) 5-Segment Tapered Armored Tail
    tail_parent = pelvis
    tail_z = -1.15
    for i in range(5):
        seg = make_empty(f"Tail{i}", tail_parent, (0.0, 0.45 if i == 0 else 0.0, tail_z))
        w = 0.80 - i * 0.13
        seg_mat = m_hull_dark if (i % 2 == 1) else m_hull
        add_box(seg, f"TailSegMesh_{i}", (w, w * 0.78, 0.82), (0.0, 0.0, -0.40), seg_mat, bevel=0.04, taper_top=0.88)
        add_box(seg, f"TailFin_{i}", (0.12, 0.18, 0.34), (0.0, w * 0.45, -0.38), m_accent, bevel=0.02, taper_top=0.50)
        tail_parent = seg
        tail_z = -0.80
    add_cyl(tail_parent, "TailBlade", 0.01, 0.18, 0.58, 6, (0.0, 0.0, -0.98), m_accent, rot_three=(-math.pi * 0.5, 0.0, 0.0))

    # 7) Digitigrade Legs (Thigh -> Shin -> Foot + Talons)
    for sx, side_lbl in ((-1.0, "LegL"), (1.0, "LegR")):
        thigh = make_empty(f"{side_lbl}_Thigh", pelvis, (sx * 0.62, -0.05, -0.10))
        add_sphere(thigh, f"{side_lbl}_HipBall", 0.32, 12, 8, (0.0, 0.0, 0.0), m_metal)
        add_box(thigh, f"{side_lbl}_ThighArmor", (0.52, 1.00, 0.68), (0.0, -0.45, 0.0), m_hull, bevel=0.05, taper_top=0.95)
        add_cyl(thigh, f"{side_lbl}_Piston", 0.07, 0.07, 0.75, 8, (0.0, -0.45, -0.32), m_accent)

        shin = make_empty(f"{side_lbl}_Shin", thigh, (0.0, -0.95, 0.0))
        add_box(shin, f"{side_lbl}_ShinStrut", (0.34, 0.96, 0.38), (0.0, -0.45, 0.0), m_metal, bevel=0.03)
        add_box(shin, f"{side_lbl}_KneeGuard", (0.40, 0.34, 0.44), (0.0, -0.10, 0.06), m_accent, bevel=0.03, taper_top=0.80)

        foot = make_empty(f"{side_lbl}_Foot", shin, (0.0, -0.92, 0.0))
        add_box(foot, f"{side_lbl}_FootPad", (0.54, 0.20, 0.88), (0.0, -0.08, 0.26), m_dark, bevel=0.03, taper_top=0.85)
        for tx in (-0.17, 0.0, 0.17):
            add_cyl(foot, f"{side_lbl}_Talon_{tx}", 0.008, 0.068, 0.28, 6, (tx, -0.08, 0.78), m_white, rot_three=(math.pi * 0.5, 0.0, 0.0), bevel=0.0)

    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../public/models"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "mecha_raptor.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
    )
    print(f"Exported Mecha Raptor GLB to: {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == "__main__":
    build_mecha_raptor()
