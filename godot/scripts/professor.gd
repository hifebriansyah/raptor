class_name ProfessorController
extends CharacterBody3D

const WALK_SPEED: float = 5.2
const SPRINT_SPEED: float = 9.2
const JUMP_VEL: float = 11.2
const CHUTE_SINK: float = 3.6
const CHUTE_GLIDE: float = 7.5
const SKYDIVE_GLIDE: float = 14.0
const SKYDIVE_MAX_FALL: float = 48.0
const SWIM_DEPTH: float = 1.3

var riding: bool = false
var swimming: bool = false
var parachuting: bool = false
var skydiving: bool = false
var sprint_latched: bool = false
var heading: float = 0.0
var aiming: bool = false

var body_root: Node3D = null
var torso: Node3D = null
var head_group: Node3D = null
var arm_l: Node3D = null
var arm_r: Node3D = null
var leg_l: Node3D = null
var leg_r: Node3D = null
var chute_group: Node3D = null
var nozzle: Node3D = null

var _col_shape: CollisionShape3D = null
var _walk_phase: float = 0.0
var _skydive_flutter: float = 0.0
var _still_timer: float = 0.0
var _auto_chute_armed: bool = true

func _ready() -> void:
	collision_layer = 2
	collision_mask = 1 | 4 | 8
	floor_max_angle = deg_to_rad(52.0)
	floor_snap_length = 0.35

	_col_shape = CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.36
	cap.height = 1.75
	_col_shape.shape = cap
	_col_shape.position = Vector3(0.0, 0.875, 0.0)
	add_child(_col_shape)

	_build_model()

func _build_model() -> void:
	body_root = Node3D.new()
	add_child(body_root)

	torso = Node3D.new()
	torso.position = Vector3(0.0, 0.92, 0.0)
	body_root.add_child(torso)

	# Stylized non-minifigure 36yo Professor: athletic human proportions (~1.75m total height)
	# Teal inner shirt + white open Lab Coat panels + belt
	_part(torso, Vector3(0.0, 0.14, 0.0), Vector3(0.42, 0.54, 0.24), "#118ab2")
	_part(torso, Vector3(-0.15, 0.10, 0.01), Vector3(0.16, 0.62, 0.27), "#f8f9fa")
	_part(torso, Vector3(0.15, 0.10, 0.01), Vector3(0.16, 0.62, 0.27), "#f8f9fa")
	_part(torso, Vector3(0.0, 0.10, -0.11), Vector3(0.44, 0.62, 0.06), "#f8f9fa")
	_part(torso, Vector3(0.0, -0.14, 0.0), Vector3(0.43, 0.08, 0.25), "#2b2d42")

	# Neck + natural proportioned head + 36yo swept dark hair + glasses (no yellow cylinder head!)
	head_group = Node3D.new()
	head_group.position = Vector3(0.0, 0.46, 0.0)
	torso.add_child(head_group)
	_part(head_group, Vector3(0.0, 0.04, 0.0), Vector3(0.14, 0.10, 0.14), "#f4cbb2")
	_part_sphere(head_group, Vector3(0.0, 0.22, 0.0), 0.17, 0.36, "#f4cbb2")
	# Youthful 36yo dark chestnut hair with front sweep
	_part(head_group, Vector3(0.0, 0.36, -0.02), Vector3(0.34, 0.12, 0.34), "#3d2618")
	_part(head_group, Vector3(0.04, 0.39, 0.12), Vector3(0.26, 0.08, 0.14), "#4a2e1d", Vector3(deg_to_rad(-15.0), 0.0, deg_to_rad(8.0)))
	_part(head_group, Vector3(0.0, 0.24, -0.14), Vector3(0.33, 0.22, 0.10), "#3d2618")
	# Glasses + eyes
	_part(head_group, Vector3(-0.065, 0.23, 0.155), Vector3(0.08, 0.055, 0.03), "#1d3557")
	_part(head_group, Vector3(0.065, 0.23, 0.155), Vector3(0.08, 0.055, 0.03), "#1d3557")
	_part(head_group, Vector3(0.0, 0.23, 0.155), Vector3(0.05, 0.02, 0.03), "#1d3557")

	# Articulated Arms (upper sleeve + forearm + natural hand — no minifigure claws)
	arm_l = Node3D.new()
	arm_l.position = Vector3(-0.29, 0.36, 0.0)
	torso.add_child(arm_l)
	_part(arm_l, Vector3(0.0, -0.14, 0.0), Vector3(0.13, 0.30, 0.13), "#f8f9fa")
	_part(arm_l, Vector3(0.0, -0.35, 0.0), Vector3(0.11, 0.20, 0.11), "#f4cbb2")
	_part_sphere(arm_l, Vector3(0.0, -0.47, 0.0), 0.065, 0.13, "#f4cbb2")

	arm_r = Node3D.new()
	arm_r.position = Vector3(0.29, 0.36, 0.0)
	torso.add_child(arm_r)
	_part(arm_r, Vector3(0.0, -0.14, 0.0), Vector3(0.13, 0.30, 0.13), "#f8f9fa")
	_part(arm_r, Vector3(0.0, -0.35, 0.0), Vector3(0.11, 0.20, 0.11), "#f4cbb2")
	_part_sphere(arm_r, Vector3(0.0, -0.47, 0.0), 0.065, 0.13, "#f4cbb2")

	# Handheld Water Blaster in right hand
	_part(arm_r, Vector3(0.0, -0.47, 0.14), Vector3(0.08, 0.11, 0.26), "#4cc9f0")
	_part(arm_r, Vector3(0.0, -0.43, 0.08), Vector3(0.10, 0.12, 0.14), "#ffbe0b")
	nozzle = Node3D.new()
	nozzle.position = Vector3(0.0, -0.47, 0.30)
	arm_r.add_child(nozzle)

	# Articulated Legs (trousers + sneakers)
	leg_l = Node3D.new()
	leg_l.position = Vector3(-0.11, 0.74, 0.0)
	body_root.add_child(leg_l)
	_part(leg_l, Vector3(0.0, -0.32, 0.0), Vector3(0.16, 0.62, 0.16), "#2b2d42")
	_part(leg_l, Vector3(0.0, -0.68, 0.04), Vector3(0.17, 0.12, 0.26), "#ef233c")

	leg_r = Node3D.new()
	leg_r.position = Vector3(0.11, 0.74, 0.0)
	body_root.add_child(leg_r)
	_part(leg_r, Vector3(0.0, -0.32, 0.0), Vector3(0.16, 0.62, 0.16), "#2b2d42")
	_part(leg_r, Vector3(0.0, -0.68, 0.04), Vector3(0.17, 0.12, 0.26), "#ef233c")

	# Parachute Canopy Group
	chute_group = Node3D.new()
	chute_group.position = Vector3(0.0, 2.35, 0.0)
	chute_group.visible = false
	body_root.add_child(chute_group)
	_part_sphere(chute_group, Vector3(0.0, 0.75, 0.0), 1.85, 1.35, "#ff9f1c")
	_part_sphere(chute_group, Vector3(0.0, 0.80, 0.0), 1.65, 1.25, "#2ec4b6")
	_part(chute_group, Vector3(-0.9, 0.0, 0.0), Vector3(0.03, 1.3, 0.03), "#f8f9fa", Vector3(0.0, 0.0, deg_to_rad(-28.0)))
	_part(chute_group, Vector3(0.9, 0.0, 0.0), Vector3(0.03, 1.3, 0.03), "#f8f9fa", Vector3(0.0, 0.0, deg_to_rad(28.0)))

func deploy_parachute() -> void:
	if is_on_floor() or swimming:
		return
	parachuting = true
	skydiving = false
	_auto_chute_armed = false

func step_controller(delta: float, move_input: Vector2, cam_yaw: float, jump_just_pressed: bool, sprint_just_pressed: bool, face_override: Variant = null) -> void:
	if riding:
		return

	if sprint_just_pressed:
		sprint_latched = not sprint_latched

	var depth := WorldTerrain.water_depth(global_position.x, global_position.z)
	swimming = depth > SWIM_DEPTH

	var ground_y := WorldTerrain.surface_at(global_position.x, global_position.z)
	var height_above_surface := global_position.y - ground_y
	var grounded := is_on_floor() or (swimming and global_position.y <= WorldTerrain.WATER_Y + 0.15)

	if grounded:
		parachuting = false
		skydiving = false
		_auto_chute_armed = true

	# Parachute / LEGO Marvel 2 Skydive toggle with Space!
	if not grounded and not swimming:
		if jump_just_pressed:
			if parachuting:
				# Press Space on parachute -> remove parachute and enter LEGO 2 freefall skydive pose!
				parachuting = false
				skydiving = true
				_auto_chute_armed = false
				jump_just_pressed = false
			elif skydiving and height_above_surface > 4.0:
				# Press Space again during skydive -> re-open parachute!
				parachuting = true
				skydiving = false
				jump_just_pressed = false
		# Auto-open parachute on a long fall from space/sky if not manually cut into skydive
		if _auto_chute_armed and not parachuting and not skydiving and velocity.y < -9.5 and height_above_surface > 16.0 and global_position.y < WorldTerrain.SPACE_Y - 10.0:
			parachuting = true

	# Camera-relative horizontal direction
	var forward := Vector3(sin(cam_yaw), 0.0, cos(cam_yaw))
	var right := Vector3(cos(cam_yaw), 0.0, -sin(cam_yaw))
	var wish_dir := (right * move_input.x + forward * move_input.y)
	if wish_dir.length() > 1.0:
		wish_dir = wish_dir.normalized()

	if wish_dir.length() < 0.12:
		_still_timer += delta
		if _still_timer > 0.32:
			sprint_latched = false
	else:
		_still_timer = 0.0

	var top_speed := WALK_SPEED
	if parachuting:
		top_speed = CHUTE_GLIDE
	elif skydiving:
		top_speed = SKYDIVE_GLIDE
	elif sprint_latched:
		top_speed = SPRINT_SPEED
	if swimming:
		top_speed *= 0.48
	elif depth > 0.35:
		top_speed *= 0.72

	var target_vel := wish_dir * top_speed
	var accel := 14.0 if grounded else (5.5 if (parachuting or skydiving) else 3.5)
	velocity.x = move_toward(velocity.x, target_vel.x, accel * top_speed * delta)
	velocity.z = move_toward(velocity.z, target_vel.z, accel * top_speed * delta)

	# Vertical physics (NO meteor fall on Professor solo!)
	var grav := WorldTerrain.gravity_at(global_position.y)
	if swimming:
		var target_y := WorldTerrain.WATER_Y - 0.95
		velocity.y = clampf((target_y - global_position.y) * 6.0, -3.0, 3.0)
	elif grounded and jump_just_pressed:
		velocity.y = JUMP_VEL
	else:
		velocity.y -= grav * delta
		if parachuting:
			var sink := clampf(height_above_surface * 0.07, CHUTE_SINK, 20.0)
			velocity.y = move_toward(velocity.y, -sink, 55.0 * delta)
		elif skydiving:
			velocity.y = maxf(velocity.y, -SKYDIVE_MAX_FALL)
		else:
			velocity.y = maxf(velocity.y, -50.0)

	move_and_slide()

	# Push rigid / character vehicles gently when bumping into them
	if face_override != null:
		heading = lerp_angle(heading, float(face_override), minf(1.0, 12.0 * delta))
	elif wish_dir.length() > 0.1:
		var target_h := atan2(wish_dir.x, wish_dir.z)
		heading = lerp_angle(heading, target_h, minf(1.0, 14.0 * delta))

	body_root.rotation.y = heading
	_animate_limbs(delta, grounded)

func mount_onto(saddle_node: Node3D) -> void:
	riding = true
	parachuting = false
	skydiving = false
	chute_group.visible = false
	_col_shape.disabled = true
	velocity = Vector3.ZERO
	get_parent().remove_child(self)
	saddle_node.add_child(self)
	position = Vector3.ZERO
	rotation = Vector3.ZERO
	body_root.rotation = Vector3.ZERO
	torso.position = Vector3(0.0, 0.72, 0.0)
	leg_l.rotation = Vector3(deg_to_rad(-65.0), 0.0, deg_to_rad(-12.0))
	leg_r.rotation = Vector3(deg_to_rad(-65.0), 0.0, deg_to_rad(12.0))
	arm_l.rotation = Vector3(deg_to_rad(-38.0), 0.0, 0.0)
	arm_r.rotation = Vector3(deg_to_rad(-38.0), 0.0, 0.0)

func dismount_to(world_parent: Node3D, feet_pos: Vector3, new_heading: float, open_chute: bool = false) -> void:
	riding = false
	get_parent().remove_child(self)
	world_parent.add_child(self)
	global_position = feet_pos
	heading = new_heading
	_col_shape.disabled = false
	torso.position = Vector3(0.0, 0.92, 0.0)
	if open_chute:
		deploy_parachute()

func _animate_limbs(delta: float, grounded: bool) -> void:
	chute_group.visible = parachuting

	if skydiving:
		# LEGO Marvel 2 spread-eagle belly-down freefall pose!
		_skydive_flutter += delta * 26.0
		var flutter := sin(_skydive_flutter) * 0.09
		torso.position = Vector3(0.0, 0.95, 0.0)
		torso.rotation = Vector3(deg_to_rad(86.0), 0.0, sin(_skydive_flutter * 0.4) * 0.06)
		head_group.rotation = Vector3(deg_to_rad(-52.0), 0.0, 0.0)
		arm_l.rotation = Vector3(deg_to_rad(-15.0) + flutter, 0.0, deg_to_rad(-112.0))
		arm_r.rotation = Vector3(deg_to_rad(-15.0) - flutter, 0.0, deg_to_rad(112.0))
		leg_l.position = Vector3(-0.14, 0.85, -0.25)
		leg_r.position = Vector3(0.14, 0.85, -0.25)
		leg_l.rotation = Vector3(deg_to_rad(72.0) - flutter, 0.0, deg_to_rad(-26.0))
		leg_r.rotation = Vector3(deg_to_rad(72.0) + flutter, 0.0, deg_to_rad(26.0))
		return

	# Reset from skydive orientation
	torso.rotation = torso.rotation.lerp(Vector3.ZERO, minf(1.0, 12.0 * delta))
	head_group.rotation = head_group.rotation.lerp(Vector3.ZERO, minf(1.0, 12.0 * delta))
	leg_l.position = Vector3(-0.11, 0.74, 0.0)
	leg_r.position = Vector3(0.11, 0.74, 0.0)

	if parachuting:
		arm_l.rotation = Vector3(deg_to_rad(-155.0), 0.0, deg_to_rad(-16.0))
		arm_r.rotation = Vector3(deg_to_rad(-155.0), 0.0, deg_to_rad(16.0))
		leg_l.rotation = Vector3(deg_to_rad(14.0), 0.0, deg_to_rad(-5.0))
		leg_r.rotation = Vector3(deg_to_rad(-10.0), 0.0, deg_to_rad(5.0))
		return

	var h_speed := Vector2(velocity.x, velocity.z).length()
	if grounded and h_speed > 0.25:
		_walk_phase += delta * (4.0 + h_speed * 1.35)
		var swing := sin(_walk_phase) * clampf(h_speed / SPRINT_SPEED, 0.25, 1.0) * 0.78
		leg_l.rotation = Vector3(swing, 0.0, 0.0)
		leg_r.rotation = Vector3(-swing, 0.0, 0.0)
		arm_l.rotation = Vector3(-swing * 0.75, 0.0, 0.0)
		arm_r.rotation = Vector3(deg_to_rad(-75.0) if aiming else swing * 0.75, 0.0, 0.0)
		torso.position.y = 0.92 + absf(sin(_walk_phase * 2.0)) * 0.04
	else:
		leg_l.rotation = leg_l.rotation.lerp(Vector3.ZERO, minf(1.0, 10.0 * delta))
		leg_r.rotation = leg_r.rotation.lerp(Vector3.ZERO, minf(1.0, 10.0 * delta))
		arm_l.rotation = arm_l.rotation.lerp(Vector3.ZERO, minf(1.0, 10.0 * delta))
		var target_r := Vector3(deg_to_rad(-75.0), 0.0, 0.0) if aiming else Vector3.ZERO
		arm_r.rotation = arm_r.rotation.lerp(target_r, minf(1.0, 10.0 * delta))
		torso.position.y = lerpf(torso.position.y, 0.92, minf(1.0, 10.0 * delta))

func _part(parent: Node3D, pos: Vector3, size: Vector3, color: String, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.rotation = rot
	mi.material_override = GameSettings.mat(color)
	parent.add_child(mi)
	return mi

func _part_sphere(parent: Node3D, pos: Vector3, radius: float, height: float, color: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = radius
	sm.height = height
	sm.radial_segments = 12
	sm.rings = 6
	mi.mesh = sm
	mi.position = pos
	mi.material_override = GameSettings.mat(color)
	parent.add_child(mi)
	return mi
