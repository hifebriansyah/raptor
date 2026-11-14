extends Node3D

var sky_space: SkySpaceController = null
var terrain: WorldTerrain = null
var city_life: CityLifeManager = null
var professor: ProfessorController = null
var raptor: MechaRaptorController = null
var cam_rig: CameraRig = null
var ui: UIController = null

var in_menu: bool = true
var active_vehicle: WorldActor = null
var active_dialogue_npc: WorldActor = null
var sugar_rush_timer: float = 0.0

var _water_drops: Array[Dictionary] = []
var _drop_mesh: SphereMesh = null
var _prev_space: bool = false
var _prev_shift: bool = false

func _ready() -> void:
	sky_space = SkySpaceController.new()
	add_child(sky_space)

	terrain = WorldTerrain.new()
	add_child(terrain)

	city_life = CityLifeManager.new()
	add_child(city_life)

	raptor = MechaRaptorController.new()
	raptor.position = terrain.lab_pad_pos + Vector3(0.0, 0.25, 0.0)
	add_child(raptor)

	professor = ProfessorController.new()
	professor.position = terrain.professor_spawn + Vector3(0.0, 0.2, 0.0)
	add_child(professor)

	cam_rig = CameraRig.new()
	add_child(cam_rig)

	ui = UIController.new()
	add_child(ui)

	_drop_mesh = SphereMesh.new()
	_drop_mesh.radius = 0.16
	_drop_mesh.height = 0.32

	ui.start_game_requested.connect(_on_start_game)
	ui.zoom_in_pressed.connect(func() -> void: cam_rig.zoom_in())
	ui.zoom_out_pressed.connect(func() -> void: cam_rig.zoom_out())
	ui.zoom_reset_pressed.connect(func() -> void: cam_rig.zoom_reset())
	sky_space.island_discovered.connect(func(isl_name: String) -> void:
		ui.show_toast("Discovered %s! (+25 Lab Points)" % isl_name, 4.0)
	)
	raptor.impact_landed.connect(_on_raptor_impact)

func _on_start_game() -> void:
	in_menu = false
	cam_rig.menu_orbit_mode = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	ui.show_toast("Welcome to Mecha Raptor City! Press E near your Raptor, a Car, or Family!", 4.2)

func _on_raptor_impact(origin: Vector3, strength: float, is_meteor: bool) -> void:
	var radius := 22.0 if is_meteor else 11.0
	var force := clampf(strength * 0.75, 18.0, 46.0)
	city_life.trigger_shockwave(origin, radius, force, is_meteor)
	cam_rig.add_shake(1.35 if is_meteor else 0.55)
	if is_meteor:
		ui.show_toast("METEOR IMPACT!", 2.4)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var k: InputEventKey = event
		if k.keycode == KEY_ESCAPE:
			in_menu = not in_menu
			cam_rig.menu_orbit_mode = in_menu
			ui.set_menu_visible(in_menu)
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if in_menu else Input.MOUSE_MODE_CAPTURED
			return

		if in_menu:
			return

		# Camera Zoom keyboard shortcuts (+ / - / 0)
		if k.keycode == KEY_EQUAL or k.keycode == KEY_KP_ADD:
			cam_rig.zoom_in()
		elif k.keycode == KEY_MINUS or k.keycode == KEY_KP_SUBTRACT:
			cam_rig.zoom_out()
		elif k.keycode == KEY_0 or k.keycode == KEY_BACKSPACE:
			cam_rig.zoom_reset()

		# Raptor mode switching (1 = Walk, 2 = Flight, 3 or V = Race, Q = Cycle — No Boat Mode!)
		if raptor.ridden:
			if k.keycode == KEY_1:
				raptor.set_mode("walk")
			elif k.keycode == KEY_2:
				raptor.set_mode("flight")
			elif k.keycode == KEY_3 or k.keycode == KEY_V:
				raptor.set_mode("race")
			elif k.keycode == KEY_Q:
				raptor.cycle_mode()

		# Follow (F) & Call Raptor (R) & Feed Treat (T)
		if k.keycode == KEY_F and not raptor.ridden:
			raptor.following = not raptor.following
			ui.show_toast("Raptor Follow: %s" % ("ON" if raptor.following else "STAY"), 2.0)
		elif k.keycode == KEY_R and not raptor.ridden:
			var target_p := active_vehicle.global_position if active_vehicle != null else professor.global_position
			raptor.summon_to(target_p)
			ui.show_toast("Calling Mecha Raptor!", 2.2)
		elif k.keycode == KEY_T:
			_feed_treat_to_raptor()
		elif k.keycode == KEY_E:
			_handle_interact()

	elif event is InputEventMouseButton and event.pressed and not in_menu:
		var mb: InputEventMouseButton = event
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			cam_rig.zoom_in()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			cam_rig.zoom_out()
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			cam_rig.zoom_reset()
		elif mb.button_index == MOUSE_BUTTON_LEFT and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

	elif event is InputEventMouseMotion and not in_menu:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
			cam_rig.apply_mouse_delta(event.relative)

func _feed_treat_to_raptor() -> void:
	if GameSettings.treats_count <= 0:
		ui.show_toast("Out of Treats! Visit Grandma Evelyn on Hillside Terrace for more!", 2.8)
		return
	GameSettings.treats_count -= 1
	raptor.thruster_energy = 100.0
	raptor.thruster_overheated = false
	sugar_rush_timer = 30.0
	ui.show_toast("Fed Raptor a Cookie Treat! Thruster 100% + 30s Sugar Rush!", 3.0)

func _handle_interact() -> void:
	if active_dialogue_npc != null:
		active_dialogue_npc = null
		ui.hide_dialogue()
		return

	# 1) If currently riding the Mecha Raptor -> Dismount!
	if raptor.ridden:
		raptor.ridden = false
		var ground_y := WorldTerrain.surface_at(raptor.global_position.x, raptor.global_position.z)
		var high_in_air := (raptor.global_position.y - ground_y) > 7.5
		var dismount_pos := raptor.global_position + Vector3(cos(raptor.heading) * 2.1, 0.4, -sin(raptor.heading) * 2.1)
		professor.dismount_to(self, dismount_pos, raptor.heading, high_in_air)
		if high_in_air:
			ui.show_toast("Parachute Open! Press SPACE to cut parachute into LEGO 2 Skydive!", 3.8)
		return

	# 2) If currently driving a car or sailing a boat -> Exit vehicle!
	if active_vehicle != null:
		var v := active_vehicle
		active_vehicle = null
		v.player_driving = false
		if v.driver_visual != null:
			v.driver_visual.visible = true
		var exit_pos := v.global_position + Vector3(cos(v.rotation.y) * 2.4, 0.5, -sin(v.rotation.y) * 2.4)
		professor.dismount_to(self, exit_pos, v.rotation.y, false)
		return

	# 3) Check nearby Family NPC for conversation (with 2D portrait placeholder + Grandma refills treats!)
	for npc in city_life.family_npcs:
		if is_instance_valid(npc) and professor.global_position.distance_to(npc.global_position) < 4.5:
			active_dialogue_npc = npc
			ui.show_dialogue(npc.actor_name, npc.actor_role, npc.dialogue_line, npc.portrait_color)
			if npc.actor_name.begins_with("Grandma"):
				GameSettings.treats_count = max(GameSettings.treats_count, 5)
			return

	# 4) Check if close to the Mecha Raptor -> Mount up!
	if professor.global_position.distance_to(raptor.global_position) < 5.2:
		raptor.ridden = true
		raptor.summoning = false
		professor.mount_onto(raptor.saddle)
		return

	# 5) Check nearby Car or Roaming Sea Boat -> Board and sit visibly inside the glass cabin!
	var best_v: WorldActor = null
	var best_d: float = 5.5
	for group in [city_life.cars, city_life.boats]:
		for v: WorldActor in group:
			if not is_instance_valid(v):
				continue
			var d := professor.global_position.distance_to(v.global_position)
			if d < best_d:
				best_d = d
				best_v = v
	if best_v != null:
		active_vehicle = best_v
		best_v.player_driving = true
		if best_v.driver_visual != null:
			best_v.driver_visual.visible = false
		professor.mount_onto(best_v.seat_node if best_v.seat_node != null else best_v)
		if best_v.actor_kind == "boat" and raptor.following:
			raptor.set_mode("flight")
			ui.show_toast("Sailing %s! Mecha Raptor is following in Flight Mode!" % best_v.actor_name, 3.5)
		else:
			ui.show_toast("Driving %s! (Visible through glass cabin)" % best_v.actor_name, 2.8)

func _physics_process(delta: float) -> void:
	if sugar_rush_timer > 0.0:
		sugar_rush_timer = maxf(0.0, sugar_rush_timer - delta)

	var move_in := Vector2.ZERO
	var jump_just := false
	var ascend_held := false
	var descend_held := false
	var sprint_just := false
	var sprint_held := false
	var fire_held := false

	if not in_menu:
		move_in.x = (1.0 if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT) else 0.0) - (1.0 if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT) else 0.0)
		move_in.y = (1.0 if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP) else 0.0) - (1.0 if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN) else 0.0)
		ascend_held = Input.is_key_pressed(KEY_SPACE)
		jump_just = ascend_held and not _prev_space
		_prev_space = ascend_held
		descend_held = Input.is_key_pressed(KEY_CTRL) or Input.is_key_pressed(KEY_C)
		sprint_held = Input.is_key_pressed(KEY_SHIFT)
		sprint_just = sprint_held and not _prev_shift
		_prev_shift = sprint_held
		fire_held = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or Input.is_key_pressed(KEY_J)
	else:
		_prev_space = false
		_prev_shift = false

	var active_pos := professor.global_position
	var cam_base_dist := 7.2
	var cam_height := 1.45
	var hud_mode := "Professor (On Foot)"

	if raptor.ridden:
		raptor.step_ridden(delta, move_in, cam_rig.yaw, cam_rig.pitch, jump_just, ascend_held, descend_held, sprint_just, sprint_held)
		active_pos = raptor.global_position
		cam_base_dist = 11.5 if raptor.mode == "flight" else (10.5 if raptor.mode == "race" else 9.2)
		cam_height = 2.1
		hud_mode = "Raptor · %s%s" % [raptor.mode.capitalize(), " (SUGAR RUSH)" if sugar_rush_timer > 0.0 else ""]
	elif active_vehicle != null:
		_step_driven_vehicle(active_vehicle, delta, move_in, sprint_held)
		var on_boat := active_vehicle.actor_kind == "boat"
		raptor.step_autonomous(delta, active_vehicle.global_position, on_boat)
		active_pos = active_vehicle.global_position
		cam_base_dist = 10.0
		cam_height = 1.8
		hud_mode = "Driving · %s" % active_vehicle.actor_name
	else:
		professor.aiming = fire_held
		professor.step_controller(delta, move_in, cam_rig.yaw, jump_just, sprint_just)
		var in_water := professor.swimming
		raptor.step_autonomous(delta, professor.global_position, in_water)
		active_pos = professor.global_position
		if professor.skydiving:
			hud_mode = "Professor · LEGO 2 SKYDIVE"
			cam_base_dist = 8.4
		elif professor.parachuting:
			hud_mode = "Professor · Parachute (SPACE to Cut!)"
			cam_base_dist = 9.0

	# Refill water tank near hydrants, fountains, or the Lab Pad
	for rp in terrain.refill_points:
		if raptor.global_position.distance_to(rp) < 6.0:
			raptor.water_tank = minf(100.0, raptor.water_tank + 40.0 * delta)

	# Water spray stream
	if fire_held and not in_menu:
		_emit_water_spray(delta)
	_step_water_drops(delta)

	city_life.step_world(delta)
	cam_rig.step_camera(delta, active_pos, cam_base_dist, cam_height)
	sky_space.update_altitude(cam_rig.camera.global_position, active_pos, delta)

	var prompt := _compute_interaction_prompt()
	ui.update_hud(hud_mode, active_pos.y, raptor.thruster_energy, raptor.thruster_overheated, raptor.water_tank, raptor.following, cam_rig.zoom_mult, prompt)
	var active_yaw := raptor.heading if raptor.ridden else (active_vehicle.rotation.y if active_vehicle != null else professor.heading)
	ui.update_minimap(active_pos, active_yaw, raptor.global_position, city_life.cars, city_life.boats)

func _step_driven_vehicle(v: WorldActor, delta: float, move_in: Vector2, boost: bool) -> void:
	var top := v.cruise_speed * (1.85 if boost else 1.45)
	var fwd_spd := move_in.y * top
	if absf(fwd_spd) > 0.2:
		v.rotation.y -= move_in.x * 2.4 * signf(fwd_spd) * delta
	var fwd := Vector3(sin(v.rotation.y), 0.0, cos(v.rotation.y))
	v.velocity.x = lerpf(v.velocity.x, fwd.x * fwd_spd, minf(1.0, 8.0 * delta))
	v.velocity.z = lerpf(v.velocity.z, fwd.z * fwd_spd, minf(1.0, 8.0 * delta))
	if v.actor_kind == "boat":
		v.global_position += v.velocity * delta
		v.global_position.y = WorldTerrain.WATER_Y + 0.18
	else:
		var gy := WorldTerrain.floor_at(v.global_position.x, v.global_position.z)
		v.velocity.y = (gy - v.global_position.y) * 14.0
		v.move_and_slide()

func _emit_water_spray(delta: float) -> void:
	if raptor.ridden and not GameSettings.unlimited_water:
		if raptor.water_tank <= 0.2:
			return
		raptor.water_tank = maxf(0.0, raptor.water_tank - 14.0 * delta)

	var origin := raptor.muzzle.global_position if raptor.ridden else professor.nozzle.global_position
	var heading := raptor.heading if raptor.ridden else professor.heading
	var dir := Vector3(sin(heading), 0.12, cos(heading)).normalized()

	var drop := MeshInstance3D.new()
	drop.mesh = _drop_mesh
	drop.position = origin
	drop.material_override = GameSettings.mat("#4cc9f0", 0.2, 0.85, true)
	add_child(drop)
	_water_drops.append({"node": drop, "vel": dir * (34.0 if raptor.ridden else 20.0), "age": 0.0})

func _step_water_drops(delta: float) -> void:
	for i in range(_water_drops.size() - 1, -1, -1):
		var d: Dictionary = _water_drops[i]
		d["age"] = float(d["age"]) + delta
		var node: MeshInstance3D = d["node"]
		if float(d["age"]) > 0.75 or not is_instance_valid(node):
			if is_instance_valid(node):
				node.queue_free()
			_water_drops.remove_at(i)
		else:
			var vel: Vector3 = d["vel"]
			vel.y -= 18.0 * delta
			d["vel"] = vel
			node.position += vel * delta

func _compute_interaction_prompt() -> String:
	if active_dialogue_npc != null:
		return "[E] Close Conversation"
	if raptor.ridden:
		return "[1/2/3/Q] Walk / Flight / Race  |  [Shift] Boost  |  [Space] Jump/Climb  |  [E] Dismount"
	if active_vehicle != null:
		return "Driving %s — [WASD] Steer  |  [Shift] Boost  |  [E] Exit Vehicle" % active_vehicle.actor_name
	if professor.parachuting:
		return "[SPACE] Cut Parachute -> LEGO 2 Freefall Skydive!"
	if professor.skydiving:
		return "LEGO 2 SKYDIVE! [SPACE] Re-Deploy Parachute"
	for npc in city_life.family_npcs:
		if is_instance_valid(npc) and professor.global_position.distance_to(npc.global_position) < 4.5:
			return "[E] Talk to %s" % npc.actor_name
	if professor.global_position.distance_to(raptor.global_position) < 5.2:
		return "[E] Ride Mecha Raptor  |  [F] Toggle Follow  |  [T] Feed Cookie Treat"
	for group in [city_life.cars, city_life.boats]:
		for v: WorldActor in group:
			if is_instance_valid(v) and professor.global_position.distance_to(v.global_position) < 5.2:
				return "[E] Board %s" % v.actor_name
	return "[R] Call Mecha Raptor  |  [T] Feed Treat  |  [Wheel/+/-/0] Zoom  |  [Esc] Menu & Options"
