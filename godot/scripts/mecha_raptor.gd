class_name MechaRaptorController
extends CharacterBody3D

signal mode_changed(new_mode: String)
signal impact_landed(origin: Vector3, strength: float, is_meteor: bool)

const WALK_SPEED: float = 13.0
const SPRINT_SPEED: float = 22.0
const JUMP_VEL: float = 19.0
const RUN_JUMP_VEL: float = 26.8
const FLY_SPEED: float = 24.0
const FLY_BOOST_SPEED: float = 44.0
const RACE_TOP: float = 42.0
const RACE_BOOST: float = 66.0
const MAX_ALTITUDE: float = 900.0
const METEOR_THRESHOLD: float = 48.0
const METEOR_MAX_FALL: float = 108.0

var mode: String = "walk" # "walk", "flight", "race" (Boat mode removed!)
var ridden: bool = false
var following: bool = false
var summoning: bool = false
var boosting: bool = false
var drifting: bool = false
var sprint_latched: bool = false
var heading: float = 0.0
var race_speed: float = 0.0

var thruster_energy: float = 100.0
var thruster_overheated: bool = false
var water_tank: float = 100.0

var body_root: Node3D = null
var pelvis: Node3D = null
var neck: Node3D = null
var head_node: Node3D = null
var jaw: Node3D = null
var turret: Node3D = null
var muzzle: Node3D = null
var saddle: Node3D = null

var leg_l_thigh: Node3D = null
var leg_l_shin: Node3D = null
var leg_l_foot: Node3D = null
var leg_r_thigh: Node3D = null
var leg_r_shin: Node3D = null
var leg_r_foot: Node3D = null

var wing_l: Node3D = null
var wing_r: Node3D = null
var tail_segments: Array[Node3D] = []
var wheel_holders: Array[Node3D] = []
var wheel_spins: Array[Node3D] = []

var jet_flames: Node3D = null
var vtol_flames: Node3D = null
var meteor_corona: MeshInstance3D = null
var _meteor_mat: StandardMaterial3D = null

var _walk_phase: float = 0.0
var _anim_time: float = 0.0
var _w_flight: float = 0.0
var _w_race: float = 0.0
var _prev_vy: float = 0.0
var _boost_cooldown: float = 0.0
var _steer_visual: float = 0.0

func _ready() -> void:
	collision_layer = 2
	collision_mask = 1 | 4 | 8
	floor_max_angle = deg_to_rad(52.0)
	floor_snap_length = 0.45

	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.95
	cap.height = 2.6
	cs.shape = cap
	cs.position = Vector3(0.0, 1.3, 0.0)
	add_child(cs)

	_build_model()

func _build_model() -> void:
	var hull := "#2a9d8f"
	var hull_dark := "#1d6f66"
	var accent := "#f4a261"
	var metal := "#8d99ae"
	var dark := "#2b2d42"

	body_root = Node3D.new()
	add_child(body_root)

	pelvis = Node3D.new()
	pelvis.position = Vector3(0.0, 1.65, 0.0)
	body_root.add_child(pelvis)

	# 1) Torso / Chassis Armor (Teal Hull + Dark Flank Plates + Metallic Belly + Orange Dorsal Spines)
	_part_box(pelvis, Vector3(0.0, 0.20, 0.0), Vector3(1.40, 1.00, 2.30), hull)
	_part_box(pelvis, Vector3(0.0, 0.25, 1.25), Vector3(1.10, 0.90, 0.90), hull)
	_part_box(pelvis, Vector3(0.0, -0.45, 0.10), Vector3(1.00, 0.35, 2.00), metal)
	for sx in [-1.0, 1.0]:
		_part_box(pelvis, Vector3(sx * 0.73, 0.10, 0.0), Vector3(0.12, 0.60, 1.80), hull_dark)
	for i in range(4):
		_part_box(pelvis, Vector3(0.0, 0.78, -0.90 + float(i) * 0.55), Vector3(0.16, 0.22, 0.28), accent)

	# 2) Cockpit Saddle & Handlebars for the Professor
	_part_box(pelvis, Vector3(0.0, 0.76, 0.05), Vector3(0.95, 0.22, 0.95), "#6c584c")
	_part_box(pelvis, Vector3(0.0, 0.98, -0.38), Vector3(0.95, 0.45, 0.18), "#6c584c")
	_part_box(pelvis, Vector3(0.0, 1.05, 0.65), Vector3(0.90, 0.10, 0.10), dark)
	saddle = Node3D.new()
	saddle.position = Vector3(0.0, 0.85, 0.05)
	pelvis.add_child(saddle)

	# 3) Back-mounted Cylindrical Water Tank + Swiveling Water Cannon Turret
	_part_cyl(pelvis, Vector3(0.0, 0.85, -0.82), 0.36, 0.36, 1.10, "#3a86ff", Vector3(PI * 0.5, 0.0, 0.0))
	_part_box(pelvis, Vector3(0.0, 1.23, -0.82), Vector3(0.20, 0.06, 0.90), "#90e0ef", Vector3.ZERO, true)

	turret = Node3D.new()
	turret.position = Vector3(0.0, 1.26, -0.60)
	pelvis.add_child(turret)
	_part_cyl(turret, Vector3(0.0, 0.08, 0.0), 0.22, 0.26, 0.22, metal)
	_part_cyl(turret, Vector3(0.0, 0.18, 0.45), 0.09, 0.13, 0.90, dark, Vector3(PI * 0.5, 0.0, 0.0))
	_part_cyl(turret, Vector3(0.0, 0.18, 0.92), 0.12, 0.12, 0.12, "#5ef2ff", Vector3(PI * 0.5, 0.0, 0.0), true)
	muzzle = Node3D.new()
	muzzle.position = Vector3(0.0, 0.18, 1.02)
	turret.add_child(muzzle)

	# 4) Swept 3-Feather Mecha Wings + Leading Edge Spars + VTOL & Rear Thrusters
	wing_l = Node3D.new()
	wing_l.position = Vector3(-0.72, 0.55, 0.20)
	pelvis.add_child(wing_l)
	_build_wing_side(wing_l, -1.0, hull, hull_dark, accent)

	wing_r = Node3D.new()
	wing_r.position = Vector3(0.72, 0.55, 0.20)
	pelvis.add_child(wing_r)
	_build_wing_side(wing_r, 1.0, hull, hull_dark, accent)

	vtol_flames = Node3D.new()
	vtol_flames.visible = false
	pelvis.add_child(vtol_flames)
	for sx in [-0.85, 0.85]:
		_part_cyl(vtol_flames, Vector3(sx, -0.15, 0.10), 0.02, 0.24, 0.95, "#ff9f1c", Vector3.ZERO, true)

	# Dual Rear Jet Thruster Pods + Boost Flames
	for sx in [-0.40, 0.40]:
		_part_cyl(pelvis, Vector3(sx, 0.20, -1.15), 0.22, 0.28, 0.50, dark, Vector3(PI * 0.5, 0.0, 0.0))
		_part_cyl(pelvis, Vector3(sx, 0.20, -1.41), 0.17, 0.17, 0.04, "#ff9f1c", Vector3(PI * 0.5, 0.0, 0.0), true)

	jet_flames = Node3D.new()
	jet_flames.position = Vector3(0.0, 0.20, -1.42)
	jet_flames.visible = false
	pelvis.add_child(jet_flames)
	for sx in [-0.40, 0.40]:
		_part_cyl(jet_flames, Vector3(sx, 0.0, -0.85), 0.02, 0.22, 1.70, "#ff6b35", Vector3(-PI * 0.5, 0.0, 0.0), true)

	# 5) 4 Round Cylindrical Retractable Race Wheels (with steering holders & spinning hubs!)
	var wheel_coords: Array[Vector2] = [
		Vector2(-0.95, 0.95), Vector2(0.95, 0.95),
		Vector2(-0.95, -0.85), Vector2(0.95, -0.85)
	]
	for wc in wheel_coords:
		var holder := Node3D.new()
		holder.position = Vector3(wc.x, -0.55, wc.y)
		holder.visible = false
		pelvis.add_child(holder)
		wheel_holders.append(holder)

		var spin := Node3D.new()
		holder.add_child(spin)
		wheel_spins.append(spin)
		# Round tire cylinder rotated 90 deg on Z + Orange alloy hubcap!
		_part_cyl(spin, Vector3.ZERO, 0.50, 0.50, 0.40, dark, Vector3(0.0, 0.0, PI * 0.5))
		_part_cyl(spin, Vector3.ZERO, 0.28, 0.28, 0.43, accent, Vector3(0.0, 0.0, PI * 0.5))
		_part_box(spin, Vector3(0.0, 0.0, 0.0), Vector3(0.45, 0.12, 0.48), metal)

	# 6) Articulated Neck + Head + Glowing Visor Eyes + Hinged Jaw + Teeth + Forearms
	neck = Node3D.new()
	neck.position = Vector3(0.0, 0.85, 1.25)
	pelvis.add_child(neck)
	_part_box(neck, Vector3(0.0, 0.35, 0.40), Vector3(0.60, 0.60, 1.10), hull, Vector3(-0.60, 0.0, 0.0))

	head_node = Node3D.new()
	head_node.position = Vector3(0.0, 0.80, 0.95)
	neck.add_child(head_node)
	_part_box(head_node, Vector3(0.0, 0.05, 0.35), Vector3(0.75, 0.60, 1.10), hull)
	_part_box(head_node, Vector3(0.0, 0.38, 0.25), Vector3(0.80, 0.12, 0.90), accent)
	for sx in [-0.30, 0.30]:
		_part_box(head_node, Vector3(sx, 0.18, 0.55), Vector3(0.20, 0.12, 0.22), "#5ef2ff", Vector3.ZERO, true)

	jaw = Node3D.new()
	jaw.position = Vector3(0.0, -0.20, 0.0)
	head_node.add_child(jaw)
	_part_box(jaw, Vector3(0.0, -0.05, 0.40), Vector3(0.65, 0.18, 1.00), hull_dark)
	for i in range(4):
		var tx := -0.27 + float(i % 2) * 0.54
		var tz := 0.60 + float(int(i / 2)) * 0.20
		_part_box(head_node, Vector3(tx, -0.28, tz), Vector3(0.06, 0.10, 0.06), "#ffffff")

	# Tucked Raptor Forearms with Claws
	for sx in [-1.0, 1.0]:
		var arm := Node3D.new()
		arm.position = Vector3(sx * 0.65, -0.05, 1.10)
		arm.rotation.x = 0.60
		pelvis.add_child(arm)
		_part_box(arm, Vector3(0.0, -0.25, 0.0), Vector3(0.18, 0.55, 0.18), metal)
		_part_box(arm, Vector3(0.0, -0.55, 0.08), Vector3(0.22, 0.12, 0.30), dark)

	# 7) 5-Segment Articulated Wagging Tail + Orange Tip Cone
	var tail_parent: Node3D = pelvis
	var tail_z := -1.15
	for i in range(5):
		var seg := Node3D.new()
		seg.position = Vector3(0.0, 0.45 if i == 0 else 0.0, tail_z)
		var w := 0.80 - float(i) * 0.13
		var seg_col := hull_dark if (i % 2 == 1) else hull
		_part_box(seg, Vector3(0.0, 0.0, -0.40), Vector3(w, w * 0.80, 0.80), seg_col)
		tail_parent.add_child(seg)
		tail_segments.append(seg)
		tail_parent = seg
		tail_z = -0.80
	_part_cyl(tail_parent, Vector3(0.0, 0.0, -0.95), 0.02, 0.16, 0.50, accent, Vector3(-PI * 0.5, 0.0, 0.0))

	# 8) Digitigrade 3-Joint Mecha Legs (Thigh + Hip Sphere + Shin + Knee Guard + 3-Toed Clawed Foot)
	var left_leg := _build_digitigrade_leg(-1.0, hull, accent, metal, dark)
	leg_l_thigh = left_leg[0]
	leg_l_shin = left_leg[1]
	leg_l_foot = left_leg[2]

	var right_leg := _build_digitigrade_leg(1.0, hull, accent, metal, dark)
	leg_r_thigh = right_leg[0]
	leg_r_shin = right_leg[1]
	leg_r_foot = right_leg[2]

	# 9) Meteor Fall Corona (Raptor Only!)
	meteor_corona = MeshInstance3D.new()
	var m_sph := SphereMesh.new()
	m_sph.radius = 2.6
	m_sph.height = 5.2
	meteor_corona.mesh = m_sph
	_meteor_mat = StandardMaterial3D.new()
	_meteor_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_meteor_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_meteor_mat.albedo_color = Color(1.0, 0.38, 0.05, 0.0)
	meteor_corona.material_override = _meteor_mat
	meteor_corona.visible = false
	pelvis.add_child(meteor_corona)

func _build_wing_side(wing_node: Node3D, side_sign: float, hull: String, hull_dark: String, accent: String) -> void:
	for f in range(3):
		var span := 2.40 - float(f) * 0.45
		var feather_col := hull if f < 2 else hull_dark
		_part_box(
			wing_node,
			Vector3(side_sign * (0.90 + float(f) * 0.55), -float(f) * 0.04, -float(f) * 0.25),
			Vector3(span, 0.10, 1.10 - float(f) * 0.22),
			feather_col,
			Vector3(0.0, side_sign * (-0.18 - float(f) * 0.08), 0.0)
		)
	_part_box(wing_node, Vector3(side_sign * 1.40, 0.04, 0.45), Vector3(2.80, 0.14, 0.18), accent)

func _build_digitigrade_leg(side_sign: float, hull: String, accent: String, metal: String, dark: String) -> Array[Node3D]:
	var thigh := Node3D.new()
	thigh.position = Vector3(side_sign * 0.62, -0.05, -0.10)
	pelvis.add_child(thigh)
	_part_box(thigh, Vector3(0.0, -0.45, 0.0), Vector3(0.50, 1.00, 0.65), hull)
	_part_sphere(thigh, Vector3.ZERO, 0.30, 0.60, metal)

	var shin := Node3D.new()
	shin.position = Vector3(0.0, -0.95, 0.0)
	thigh.add_child(shin)
	_part_box(shin, Vector3(0.0, -0.45, 0.0), Vector3(0.32, 0.95, 0.35), metal)
	_part_box(shin, Vector3(0.0, -0.10, 0.05), Vector3(0.36, 0.30, 0.40), accent)

	var foot := Node3D.new()
	foot.position = Vector3(0.0, -0.92, 0.0)
	shin.add_child(foot)
	_part_box(foot, Vector3(0.0, -0.08, 0.25), Vector3(0.50, 0.18, 0.85), dark)
	for tx in [-0.16, 0.0, 0.16]:
		_part_cyl(foot, Vector3(tx, -0.08, 0.78), 0.01, 0.06, 0.26, "#e5e5e5", Vector3(PI * 0.5, 0.0, 0.0))

	return [thigh, shin, foot]

func set_mode(new_mode: String) -> void:
	if new_mode == mode:
		return
	if new_mode != "walk" and new_mode != "flight" and new_mode != "race":
		return
	var prev := mode
	mode = new_mode
	if mode == "flight":
		velocity.y = maxf(velocity.y, 10.5)
	elif mode == "race":
		race_speed = velocity.x * sin(heading) + velocity.z * cos(heading)
	elif prev == "flight":
		velocity.y = minf(velocity.y, 0.0)
	mode_changed.emit(mode)

func cycle_mode() -> void:
	match mode:
		"walk": set_mode("flight")
		"flight": set_mode("race")
		_: set_mode("walk")

func summon_to(target_pos: Vector3) -> void:
	summoning = true
	following = true
	set_mode("flight")
	if global_position.distance_to(target_pos) > 85.0:
		global_position = target_pos + Vector3(-18.0, 24.0, -18.0)

func step_ridden(delta: float, move_input: Vector2, cam_yaw: float, cam_pitch: float, jump_just_pressed: bool, ascend_held: bool, descend_held: bool, sprint_just_pressed: bool, sprint_held: bool) -> void:
	if sprint_just_pressed:
		sprint_latched = not sprint_latched

	var grounded := is_on_floor()
	var can_boost := GameSettings.unlimited_turbo or (not thruster_overheated and thruster_energy > 0.5)
	boosting = false
	drifting = false
	_steer_visual = move_toward(_steer_visual, -move_input.x * 0.48, 8.0 * delta)

	# Double-Space mode transitions: Walk -> Flight in mid-air; Race -> Walk
	if jump_just_pressed and not grounded and mode == "walk":
		set_mode("flight")
		jump_just_pressed = false
	elif jump_just_pressed and mode == "race":
		set_mode("walk")
		jump_just_pressed = false

	match mode:
		"walk":
			_step_walk(delta, move_input, cam_yaw, grounded, jump_just_pressed)
		"flight":
			_step_flight(delta, move_input, cam_yaw, cam_pitch, ascend_held, descend_held, (sprint_latched or sprint_held) and can_boost)
		"race":
			_step_race(delta, move_input, grounded, descend_held, (sprint_latched or sprint_held) and can_boost)

	_update_thruster(delta)
	_prev_vy = velocity.y
	move_and_slide()
	_handle_collisions_and_impacts(grounded)
	_animate_model(delta, is_on_floor())

func step_autonomous(delta: float, prof_pos: Vector3, prof_in_water_or_boat: bool) -> void:
	boosting = false
	drifting = false
	_steer_visual = move_toward(_steer_visual, 0.0, 6.0 * delta)
	_update_thruster(delta)
	var grounded := is_on_floor()

	if summoning or following:
		var offset_dist := 4.8
		var to_prof := prof_pos - global_position
		var h_dist := Vector2(to_prof.x, to_prof.z).length()

		# If Professor is in deep water / on a boat, or far/high away, Raptor follows in Flight mode!
		if prof_in_water_or_boat or absf(to_prof.y) > 8.0 or h_dist > 28.0:
			if mode != "flight":
				set_mode("flight")
		elif summoning and h_dist < 6.5 and absf(to_prof.y) < 3.5:
			summoning = false
			set_mode("walk")

		if h_dist > offset_dist:
			var dir := Vector3(to_prof.x, 0.0, to_prof.z).normalized()
			heading = lerp_angle(heading, atan2(dir.x, dir.z), minf(1.0, 8.0 * delta))
			var spd := FLY_SPEED if mode == "flight" else SPRINT_SPEED
			velocity.x = dir.x * spd
			velocity.z = dir.z * spd
		else:
			velocity.x = move_toward(velocity.x, 0.0, 28.0 * delta)
			velocity.z = move_toward(velocity.z, 0.0, 28.0 * delta)

		if mode == "flight":
			var target_y := prof_pos.y + (3.8 if prof_in_water_or_boat else 1.8)
			velocity.y = clampf((target_y - global_position.y) * 4.5, -18.0, 22.0)
		else:
			velocity.y -= WorldTerrain.gravity_at(global_position.y) * delta
	else:
		if mode == "flight":
			set_mode("walk")
		velocity.x = move_toward(velocity.x, 0.0, 25.0 * delta)
		velocity.z = move_toward(velocity.z, 0.0, 25.0 * delta)
		velocity.y -= WorldTerrain.gravity_at(global_position.y) * delta

	_prev_vy = velocity.y
	move_and_slide()
	_handle_collisions_and_impacts(grounded)
	body_root.rotation.y = heading
	_animate_model(delta, is_on_floor())

func _step_walk(delta: float, move_input: Vector2, cam_yaw: float, grounded: bool, jump_just_pressed: bool) -> void:
	var forward := Vector3(sin(cam_yaw), 0.0, cos(cam_yaw))
	var right := Vector3(cos(cam_yaw), 0.0, -sin(cam_yaw))
	var wish := right * move_input.x + forward * move_input.y
	if wish.length() > 1.0:
		wish = wish.normalized()
	if wish.length() < 0.12:
		sprint_latched = false

	var top := SPRINT_SPEED if sprint_latched else WALK_SPEED
	if WorldTerrain.water_depth(global_position.x, global_position.z) > 0.5:
		top *= 0.55

	velocity.x = move_toward(velocity.x, wish.x * top, 55.0 * delta)
	velocity.z = move_toward(velocity.z, wish.z * top, 55.0 * delta)

	if grounded and jump_just_pressed:
		var h_spd := Vector2(velocity.x, velocity.z).length()
		velocity.y = RUN_JUMP_VEL if h_spd > WALK_SPEED + 2.5 else JUMP_VEL
	else:
		var grav := WorldTerrain.gravity_at(global_position.y)
		velocity.y = maxf(velocity.y - grav * delta, -METEOR_MAX_FALL)

	if wish.length() > 0.1:
		heading = lerp_angle(heading, atan2(wish.x, wish.z), minf(1.0, 10.0 * delta))
	body_root.rotation.y = heading

func _step_flight(delta: float, move_input: Vector2, cam_yaw: float, cam_pitch: float, ascend_held: bool, descend_held: bool, want_boost: bool) -> void:
	var forward := Vector3(sin(cam_yaw), 0.0, cos(cam_yaw))
	var right := Vector3(cos(cam_yaw), 0.0, -sin(cam_yaw))
	var wish := right * move_input.x + forward * move_input.y
	if wish.length() > 1.0:
		wish = wish.normalized()

	boosting = want_boost and (wish.length() > 0.1 or ascend_held)
	var top := FLY_BOOST_SPEED if boosting else FLY_SPEED
	velocity.x = move_toward(velocity.x, wish.x * top, 48.0 * delta)
	velocity.z = move_toward(velocity.z, wish.z * top, 48.0 * delta)

	var vy_target := 0.0
	if ascend_held:
		vy_target += (28.0 if boosting else 16.0)
	if descend_held:
		vy_target -= 18.0
	if move_input.y > 0.15:
		var pitch_delta := clampf((0.28 - cam_pitch) * 1.65, -0.85, 0.85)
		vy_target += pitch_delta * top * 0.72
	if global_position.y >= MAX_ALTITUDE and vy_target > 0.0:
		vy_target = 0.0

	velocity.y = move_toward(velocity.y, vy_target, 42.0 * delta)
	if wish.length() > 0.1:
		heading = lerp_angle(heading, atan2(wish.x, wish.z), minf(1.0, 8.5 * delta))
	body_root.rotation.y = heading

func _step_race(delta: float, move_input: Vector2, grounded: bool, drift_held: bool, want_boost: bool) -> void:
	drifting = drift_held and absf(race_speed) > 10.0
	boosting = want_boost and move_input.y >= -0.05
	var top := RACE_BOOST if boosting else RACE_TOP
	if WorldTerrain.water_depth(global_position.x, global_position.z) > 0.5:
		top *= 0.35

	if move_input.y > 0.05:
		race_speed = move_toward(race_speed, top * move_input.y, (46.0 if boosting else 28.0) * delta)
	elif move_input.y < -0.05:
		race_speed = move_toward(race_speed, -16.0, 38.0 * delta)
	else:
		race_speed = move_toward(race_speed, 0.0, 18.0 * delta)

	var turn_rate := (3.4 if drifting else 2.2) * clampf(absf(race_speed) / 14.0, 0.25, 1.0)
	var steer_sign := -1.0 if race_speed < -0.5 else 1.0
	heading -= move_input.x * turn_rate * steer_sign * delta

	var fwd := Vector3(sin(heading), 0.0, cos(heading))
	var grip := 4.5 if drifting else 14.0
	velocity.x = lerpf(velocity.x, fwd.x * race_speed, minf(1.0, grip * delta))
	velocity.z = lerpf(velocity.z, fwd.z * race_speed, minf(1.0, grip * delta))

	if not grounded:
		velocity.y = maxf(velocity.y - WorldTerrain.gravity_at(global_position.y) * delta, -METEOR_MAX_FALL)
	else:
		velocity.y = -1.5
	body_root.rotation.y = heading

func _update_thruster(delta: float) -> void:
	if GameSettings.unlimited_turbo:
		thruster_energy = 100.0
		thruster_overheated = false
		return
	if boosting:
		var drain := (8.5 if mode == "race" else 24.0) * delta
		thruster_energy = maxf(0.0, thruster_energy - drain)
		_boost_cooldown = 0.65
		if thruster_energy <= 0.01:
			thruster_overheated = true
	else:
		_boost_cooldown = maxf(0.0, _boost_cooldown - delta)
		if _boost_cooldown <= 0.0:
			thruster_energy = minf(100.0, thruster_energy + 15.0 * delta)
			if thruster_overheated and thruster_energy >= 30.0:
				thruster_overheated = false

func _handle_collisions_and_impacts(was_grounded: bool) -> void:
	var h_spd := Vector2(velocity.x, velocity.z).length()
	var is_ramming := (mode == "race" and (boosting or h_spd > RACE_TOP * 0.92)) or h_spd > 20.0
	for i in range(get_slide_collision_count()):
		var col := get_slide_collision(i)
		var collider := col.get_collider()
		if collider is Node3D and collider.has_method("apply_raptor_hit"):
			var collider_3d := collider as Node3D
			var push_dir: Vector3 = (collider_3d.global_position - global_position).normalized()
			push_dir.y = 0.0
			collider.call("apply_raptor_hit", push_dir, maxf(h_spd, 8.0), is_ramming)

	if not was_grounded and is_on_floor() and _prev_vy < -21.0:
		var fall_spd := absf(_prev_vy)
		var is_meteor := fall_spd >= METEOR_THRESHOLD and mode != "flight"
		impact_landed.emit(global_position, fall_spd, is_meteor)

func _animate_model(delta: float, grounded: bool) -> void:
	_anim_time += delta
	_w_flight = move_toward(_w_flight, 1.0 if mode == "flight" else 0.0, 5.0 * delta)
	_w_race = move_toward(_w_race, 1.0 if mode == "race" else 0.0, 5.0 * delta)
	var w_folded := maxf(_w_flight, _w_race)
	var h_spd := Vector2(velocity.x, velocity.z).length()

	# 1) Wings unfold & flap gently in Flight mode; fold neatly against flanks in Walk/Race
	var wing_scale := lerpf(0.08, 1.0, _w_flight)
	wing_l.scale = Vector3.ONE * wing_scale
	wing_r.scale = Vector3.ONE * wing_scale
	var flap := sin(_anim_time * (9.5 if boosting else 6.0)) * 0.22 * _w_flight
	wing_l.rotation.z = lerpf(1.2, flap, _w_flight)
	wing_r.rotation.z = lerpf(-1.2, -flap, _w_flight)

	# 2) Round Cylindrical Wheels deploy, spin, and steer in Race mode
	for i in range(wheel_holders.size()):
		var wh := wheel_holders[i]
		wh.visible = _w_race > 0.04
		wh.scale = Vector3.ONE * maxf(0.01, _w_race)
		if i < 2:
			wh.rotation.y = _steer_visual
		wheel_spins[i].rotate_x((race_speed * delta) / 0.50)

	# 3) Pelvis height & pitch/bank
	var walk_bob := absf(sin(_walk_phase * 2.0)) * 0.08 * (1.0 - w_folded) if (grounded and h_spd > 0.5) else 0.0
	pelvis.position.y = lerpf(1.65, 1.05, _w_race) + walk_bob
	var pitch_target := clampf(-velocity.y * 0.025, -0.45, 0.45) * _w_flight
	pelvis.rotation.x = lerpf(pelvis.rotation.x, pitch_target, minf(1.0, 8.0 * delta))

	# 4) Digitigrade Legs stride in Walk mode and tuck up into wheel wells in Flight/Race
	if w_folded < 0.25 and grounded and h_spd > 0.4:
		_walk_phase += delta * (3.6 + h_spd * 0.52)
		var s_l := sin(_walk_phase)
		var s_r := sin(_walk_phase + PI)
		var stride := clampf(h_spd / WALK_SPEED, 0.25, 1.35)
		leg_l_thigh.rotation.x = s_l * 0.65 * stride
		leg_r_thigh.rotation.x = s_r * 0.65 * stride
		leg_l_shin.rotation.x = maxf(0.0, -s_l) * 0.85 * stride + 0.15
		leg_r_shin.rotation.x = maxf(0.0, -s_r) * 0.85 * stride + 0.15
		leg_l_foot.rotation.x = -leg_l_thigh.rotation.x - leg_l_shin.rotation.x * 0.5
		leg_r_foot.rotation.x = -leg_r_thigh.rotation.x - leg_r_shin.rotation.x * 0.5
	else:
		leg_l_thigh.rotation.x = lerpf(leg_l_thigh.rotation.x, -1.35 * w_folded, minf(1.0, 10.0 * delta))
		leg_r_thigh.rotation.x = lerpf(leg_r_thigh.rotation.x, -1.35 * w_folded, minf(1.0, 10.0 * delta))
		leg_l_shin.rotation.x = lerpf(leg_l_shin.rotation.x, 2.30 * w_folded, minf(1.0, 10.0 * delta))
		leg_r_shin.rotation.x = lerpf(leg_r_shin.rotation.x, 2.30 * w_folded, minf(1.0, 10.0 * delta))
		leg_l_foot.rotation.x = lerpf(leg_l_foot.rotation.x, -0.80 * w_folded, minf(1.0, 10.0 * delta))
		leg_r_foot.rotation.x = lerpf(leg_r_foot.rotation.x, -0.80 * w_folded, minf(1.0, 10.0 * delta))

	# 5) 5-Segment Tail travelling wave wag
	var wag_amp := (0.14 if h_spd > 1.0 else 0.05) * (1.0 - 0.65 * w_folded)
	for i in range(tail_segments.size()):
		tail_segments[i].rotation.y = sin(_anim_time * 5.0 - float(i) * 0.55) * wag_amp

	# 6) Neck & Jaw breathing / roar motion
	neck.rotation.x = sin(_anim_time * 2.5) * 0.04 - 0.22 * w_folded
	jaw.rotation.x = 0.08 + maxf(0.0, sin(_anim_time * 2.2)) * 0.08 + (0.22 if boosting else 0.0)

	# 7) VTOL & Rear Boost Flames
	vtol_flames.visible = _w_flight > 0.15
	if vtol_flames.visible:
		vtol_flames.scale = Vector3(1.0, (1.25 if boosting else 0.78) * _w_flight, 1.0)

	jet_flames.visible = boosting or mode == "flight"
	if jet_flames.visible:
		jet_flames.scale = Vector3(1.0, 1.0, 1.45 if boosting else 0.65)

	# 8) Meteor Fall Corona (Raptor Only!)
	var falling_fast := not grounded and mode != "flight" and velocity.y < -METEOR_THRESHOLD
	meteor_corona.visible = falling_fast
	if falling_fast:
		var m_t := clampf((absf(velocity.y) - METEOR_THRESHOLD) / 45.0, 0.15, 0.88)
		_meteor_mat.albedo_color = Color(1.0, 0.42, 0.06, m_t)
		meteor_corona.scale = Vector3.ONE * (1.0 + m_t * 0.6)

func _part_box(parent: Node3D, pos: Vector3, size: Vector3, color: String, rot := Vector3.ZERO, unshaded: bool = false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.rotation = rot
	mi.material_override = GameSettings.mat(color, 0.45, 1.0, unshaded)
	parent.add_child(mi)
	return mi

func _part_cyl(parent: Node3D, pos: Vector3, top_r: float, bot_r: float, h: float, color: String, rot := Vector3.ZERO, unshaded: bool = false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = top_r
	cm.bottom_radius = bot_r
	cm.height = h
	cm.radial_segments = 14
	mi.mesh = cm
	mi.position = pos
	mi.rotation = rot
	mi.material_override = GameSettings.mat(color, 0.45, 1.0, unshaded)
	parent.add_child(mi)
	return mi

func _part_sphere(parent: Node3D, pos: Vector3, r: float, h: float, color: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = r
	sm.height = h
	sm.radial_segments = 12
	sm.rings = 6
	mi.mesh = sm
	mi.position = pos
	mi.material_override = GameSettings.mat(color, 0.45)
	parent.add_child(mi)
	return mi
