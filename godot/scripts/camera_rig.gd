class_name CameraRig
extends Node3D

const MIN_ZOOM_MULT: float = 0.42
const MAX_ZOOM_MULT: float = 2.35

var camera: Camera3D = null
var yaw: float = 0.0
var pitch: float = 0.30
var zoom_mult: float = 1.0
var menu_orbit_mode: bool = true

var _menu_angle: float = 0.65
var _shake_strength: float = 0.0
var _cur_focus := Vector3(-25.0, 6.0, 45.0)
var _cur_dist: float = 8.5

func _ready() -> void:
	camera = Camera3D.new()
	camera.fov = 60.0
	camera.near = 0.15
	camera.far = 2600.0
	var center := Vector3(-24.0, 10.0, 36.0)
	camera.position = center + Vector3(cos(_menu_angle) * 68.0, 24.0, sin(_menu_angle) * 68.0)
	add_child(camera)
	camera.look_at(center, Vector3.UP)
	camera.make_current()

func zoom_in() -> void:
	zoom_mult = clampf(zoom_mult - 0.14, MIN_ZOOM_MULT, MAX_ZOOM_MULT)

func zoom_out() -> void:
	zoom_mult = clampf(zoom_mult + 0.14, MIN_ZOOM_MULT, MAX_ZOOM_MULT)

func zoom_reset() -> void:
	zoom_mult = 1.0

func add_shake(amount: float) -> void:
	_shake_strength = maxf(_shake_strength, amount)

func apply_mouse_delta(relative: Vector2) -> void:
	if menu_orbit_mode:
		return
	yaw -= relative.x * 0.0032
	pitch = clampf(pitch + relative.y * 0.0028, -0.78, 1.18)

func step_camera(delta: float, target_pos: Vector3, base_dist: float, height_offset: float) -> void:
	if menu_orbit_mode:
		_menu_angle += delta * 0.18
		var orbit_r := 68.0
		var center := Vector3(-24.0, 10.0, 36.0)
		var cam_p := center + Vector3(cos(_menu_angle) * orbit_r, 24.0 + sin(_menu_angle * 0.8) * 6.0, sin(_menu_angle) * orbit_r)
		camera.global_position = camera.global_position.lerp(cam_p, minf(1.0, 5.0 * delta))
		camera.look_at(center, Vector3.UP)
		return

	var focus := target_pos + Vector3(0.0, height_offset, 0.0)
	_cur_focus = _cur_focus.lerp(focus, minf(1.0, 14.0 * delta))

	var desired_dist := base_dist * zoom_mult
	_cur_dist = lerpf(_cur_dist, desired_dist, minf(1.0, 10.0 * delta))

	var dir := Vector3(
		-sin(yaw) * cos(pitch),
		sin(pitch),
		-cos(yaw) * cos(pitch)
	).normalized()

	var desired_cam := _cur_focus + dir * _cur_dist
	var min_ground_y := WorldTerrain.surface_at(desired_cam.x, desired_cam.z) + 0.65
	if desired_cam.y < min_ground_y:
		desired_cam.y = min_ground_y

	if _shake_strength > 0.01:
		var shake_off := Vector3(
			sin(Time.get_ticks_msec() * 0.07) * _shake_strength,
			cos(Time.get_ticks_msec() * 0.09) * _shake_strength,
			0.0
		)
		desired_cam += shake_off
		_shake_strength = move_toward(_shake_strength, 0.0, 3.2 * delta)

	camera.global_position = desired_cam
	camera.look_at(_cur_focus, Vector3.UP)
