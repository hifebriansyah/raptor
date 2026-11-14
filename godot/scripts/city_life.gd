class_name CityLifeManager
extends Node3D

const VEHICLE_SPECS: Array[Dictionary] = [
	{"type": "sedan", "name": "City Sedan", "w": 2.0, "h": 1.55, "l": 4.3, "speed": 11.5, "color": "#457b9d"},
	{"type": "race_car", "name": "Apex GT Racer", "w": 2.15, "h": 1.25, "l": 4.6, "speed": 18.0, "color": "#e63946"},
	{"type": "roadster", "name": "Sunburst Roadster", "w": 2.0, "h": 1.22, "l": 4.2, "speed": 16.0, "color": "#ffbe0b"},
	{"type": "city_bus", "name": "Metro Transit Bus", "w": 2.6, "h": 2.85, "l": 8.4, "speed": 9.5, "color": "#2a9d8f"},
	{"type": "fire_truck", "name": "Engine #4 Fire Truck", "w": 2.5, "h": 2.65, "l": 7.6, "speed": 12.5, "color": "#d62828"},
	{"type": "police_car", "name": "Metro Patrol Cruiser", "w": 2.05, "h": 1.55, "l": 4.4, "speed": 14.5, "color": "#1d3557"},
]

var cars: Array[WorldActor] = []
var boats: Array[WorldActor] = []
var pedestrians: Array[WorldActor] = []
var family_npcs: Array[WorldActor] = []
var shockwave_rings: Array[Dictionary] = []

var _rng := RandomNumberGenerator.new()
var _time_of_day: float = 0.0

func _ready() -> void:
	_rng.seed = 9001
	_spawn_family_npcs()
	_rebuild_crowd()
	GameSettings.crowdness_changed.connect(func(_lvl: String) -> void: _rebuild_crowd())

func _rebuild_crowd() -> void:
	for c in cars:
		if not c.player_driving and is_instance_valid(c):
			c.queue_free()
	cars.assign(cars.filter(func(c: WorldActor) -> bool: return is_instance_valid(c) and c.player_driving))

	for b in boats:
		if not b.player_driving and is_instance_valid(b):
			b.queue_free()
	boats.assign(boats.filter(func(b: WorldActor) -> bool: return is_instance_valid(b) and b.player_driving))

	for p in pedestrians:
		if is_instance_valid(p):
			p.queue_free()
	pedestrians.clear()

	var mult := GameSettings.get_crowdness_multiplier()
	var target_cars := int(round(16.0 * mult))
	var target_boats := int(round(5.0 * mult))
	var target_peds := int(round(24.0 * mult))

	for i in range(target_cars):
		_spawn_traffic_car(i)
	for i in range(target_boats):
		_spawn_roaming_boat(i)
	for i in range(target_peds):
		_spawn_pedestrian(i)

func _spawn_family_npcs() -> void:
	# 1) Professor's Wife in her goofy Godzilla / LEGO T-Rex-style mascot costume!
	var wife := _create_actor("family", "Maya (Prof's Wife)", "Godzilla Costume Enthusiast", "#52b788", 0.45, 1.85)
	wife.dialogue_line = "RAWR! How do you like my new Godzilla suit, honey? The boys said it looks fiercer than your Mecha Raptor!"
	wife.position = Vector3(-16.0, WorldTerrain.floor_at(-16.0, 44.0), 44.0)
	_build_wife_godzilla_model(wife)
	add_child(wife)
	family_npcs.append(wife)

	# 2) Older Son (Leo, age 11)
	var son11 := _create_actor("family", "Leo (Son, Age 11)", "Older Son · Aspiring Co-Pilot", "#4cc9f0", 0.32, 1.45)
	son11.dialogue_line = "Dad! Me and Max raced bikes up to Observatory Hill—try hitting that cliff ramp in Race Mode!"
	son11.position = Vector3(-12.0, WorldTerrain.floor_at(-12.0, 46.0), 46.0)
	_build_stylized_human(son11, 0.82, "#3a86ff", "#1d3557", "#3d2618")
	add_child(son11)
	family_npcs.append(son11)

	# 3) Younger Son (Max, age 9)
	var son9 := _create_actor("family", "Max (Son, Age 9)", "Younger Son · Cookie Scout", "#ffbe0b", 0.30, 1.28)
	son9.dialogue_line = "Dad! Grandma baked a fresh batch of treats up on Hillside Terrace. Don't forget to feed the Raptor!"
	son9.position = Vector3(-10.0, WorldTerrain.floor_at(-10.0, 43.0), 43.0)
	_build_stylized_human(son9, 0.73, "#ff9f1c", "#2b2d42", "#5c3d2e")
	add_child(son9)
	family_npcs.append(son9)

	# 4) Grandma (Professor's Mother!) at Hillside Estate
	var gm := _create_actor("family", "Grandma Evelyn (Prof's Mom)", "Your Mother · Mystic Baker", "#e75480", 0.35, 1.68)
	gm.dialogue_line = "You still call me 'Grandma' just because Leo and Max do! Here, take some warm cookies for the Raptor, dear."
	gm.position = Vector3(91.5, WorldTerrain.floor_at(91.5, -80.0), -80.0)
	_build_stylized_human(gm, 0.94, "#e75480", "#6d597a", "#e5e5e5")
	add_child(gm)
	family_npcs.append(gm)

func _build_wife_godzilla_model(actor: WorldActor) -> void:
	var root := Node3D.new()
	actor.add_child(root)
	var suit_green := "#2d6a4f"
	var belly_mint := "#95d5b2"
	var spine_teal := "#52b788"

	# Chunky Godzilla mascot torso + ribbed pale-green belly scales
	_box(root, Vector3(0.0, 0.90, 0.0), Vector3(0.68, 0.94, 0.58), suit_green)
	for b_i in range(4):
		_box(root, Vector3(0.0, 0.56 + float(b_i) * 0.20, 0.28), Vector3(0.46, 0.15, 0.08), belly_mint)

	# Sculpted Godzilla Mascot Head / Snout Hood + Glowing Dino Eyes + White Teeth Rows
	_box(root, Vector3(0.0, 1.58, 0.02), Vector3(0.64, 0.54, 0.62), suit_green)
	_box(root, Vector3(0.0, 1.72, 0.36), Vector3(0.56, 0.24, 0.42), suit_green)
	for sx in [-0.29, 0.29]:
		_box(root, Vector3(sx, 1.76, 0.22), Vector3(0.06, 0.10, 0.12), "#ffd166", Vector3.ZERO, true)
	for t_i in range(-2, 3):
		_box(root, Vector3(float(t_i) * 0.10, 1.58, 0.52), Vector3(0.05, 0.09, 0.05), "#ffffff")
		_box(root, Vector3(float(t_i) * 0.10, 1.36, 0.44), Vector3(0.05, 0.07, 0.05), "#ffffff")

	# Wife Maya's real smiling face peeking out through the open Godzilla jaws!
	_sphere(root, Vector3(0.0, 1.52, 0.20), 0.17, 0.34, "#f4cbb2")
	_box(root, Vector3(-0.06, 1.54, 0.35), Vector3(0.04, 0.04, 0.03), "#1d3557")
	_box(root, Vector3(0.06, 1.54, 0.35), Vector3(0.04, 0.04, 0.03), "#1d3557")
	_box(root, Vector3(0.0, 1.46, 0.35), Vector3(0.08, 0.025, 0.03), "#e63946")

	# Stubby Godzilla Mascot Arms with White Claws
	for sx in [-0.40, 0.40]:
		_box(root, Vector3(sx, 1.02, 0.12), Vector3(0.18, 0.36, 0.22), suit_green, Vector3(deg_to_rad(-28.0), 0.0, 0.0))
		_box(root, Vector3(sx, 0.88, 0.26), Vector3(0.16, 0.08, 0.12), "#ffffff")

	# 5 Jagged Godzilla Dorsal Fins down the back + Sweeping Dino Tail
	for i in range(5):
		_box(root, Vector3(0.0, 1.72 - float(i) * 0.25, -0.34), Vector3(0.12, 0.22, 0.26), spine_teal, Vector3(deg_to_rad(18.0), 0.0, 0.0))
	_box(root, Vector3(0.0, 0.56, -0.58), Vector3(0.44, 0.38, 0.78), suit_green, Vector3(deg_to_rad(-14.0), 0.0, 0.0))
	_box(root, Vector3(0.0, 0.42, -1.12), Vector3(0.28, 0.24, 0.62), suit_green, Vector3(deg_to_rad(8.0), 0.0, 0.0))

	# Articulated Mascot Legs with Clawed Dino Boots
	var leg_l := Node3D.new()
	leg_l.name = "LegL"
	leg_l.position = Vector3(-0.18, 0.48, 0.0)
	root.add_child(leg_l)
	_box(leg_l, Vector3(0.0, -0.22, 0.02), Vector3(0.24, 0.46, 0.34), suit_green)

	var leg_r := Node3D.new()
	leg_r.name = "LegR"
	leg_r.position = Vector3(0.18, 0.48, 0.0)
	root.add_child(leg_r)
	_box(leg_r, Vector3(0.0, -0.22, 0.02), Vector3(0.24, 0.46, 0.34), suit_green)
	actor.set_meta("leg_l", leg_l)
	actor.set_meta("leg_r", leg_r)

func _build_stylized_human(actor: WorldActor, scale_f: float, shirt_col: String, pants_col: String, hair_col: String) -> void:
	var root := Node3D.new()
	root.scale = Vector3.ONE * scale_f
	actor.add_child(root)

	# Expressive non-minifigure human torso + collar + natural spherical head + hair + eyes
	_box(root, Vector3(0.0, 1.05, 0.0), Vector3(0.40, 0.54, 0.24), shirt_col)
	_sphere(root, Vector3(0.0, 1.52, 0.0), 0.17, 0.35, "#f4cbb2")
	_box(root, Vector3(0.0, 1.66, -0.02), Vector3(0.35, 0.13, 0.35), hair_col)
	_box(root, Vector3(0.0, 1.54, -0.14), Vector3(0.33, 0.22, 0.10), hair_col)
	_box(root, Vector3(-0.06, 1.53, 0.155), Vector3(0.04, 0.04, 0.02), "#1d3557")
	_box(root, Vector3(0.06, 1.53, 0.155), Vector3(0.04, 0.04, 0.02), "#1d3557")

	# Articulated Arms + Natural Hands
	var arm_l := Node3D.new()
	arm_l.position = Vector3(-0.27, 1.28, 0.0)
	root.add_child(arm_l)
	_box(arm_l, Vector3(0.0, -0.22, 0.0), Vector3(0.12, 0.44, 0.12), shirt_col)
	_sphere(arm_l, Vector3(0.0, -0.46, 0.0), 0.06, 0.12, "#f4cbb2")

	var arm_r := Node3D.new()
	arm_r.position = Vector3(0.27, 1.28, 0.0)
	root.add_child(arm_r)
	_box(arm_r, Vector3(0.0, -0.22, 0.0), Vector3(0.12, 0.44, 0.12), shirt_col)
	_sphere(arm_r, Vector3(0.0, -0.46, 0.0), 0.06, 0.12, "#f4cbb2")

	# Articulated Legs + Sneakers
	var leg_l := Node3D.new()
	leg_l.position = Vector3(-0.11, 0.76, 0.0)
	root.add_child(leg_l)
	_box(leg_l, Vector3(0.0, -0.34, 0.0), Vector3(0.15, 0.66, 0.15), pants_col)
	_box(leg_l, Vector3(0.0, -0.70, 0.04), Vector3(0.16, 0.10, 0.24), "#f8f9fa")

	var leg_r := Node3D.new()
	leg_r.position = Vector3(0.11, 0.76, 0.0)
	root.add_child(leg_r)
	_box(leg_r, Vector3(0.0, -0.34, 0.0), Vector3(0.15, 0.66, 0.15), pants_col)
	_box(leg_r, Vector3(0.0, -0.70, 0.04), Vector3(0.16, 0.10, 0.24), "#f8f9fa")

	actor.set_meta("leg_l", leg_l)
	actor.set_meta("leg_r", leg_r)
	actor.set_meta("arm_l", arm_l)
	actor.set_meta("arm_r", arm_r)

func _spawn_traffic_car(idx: int) -> void:
	var spec: Dictionary = VEHICLE_SPECS[idx % VEHICLE_SPECS.size()]
	var v_type := String(spec["type"])
	var w := float(spec["w"])
	var h := float(spec["h"])
	var l := float(spec["l"])
	var col := String(spec["color"])

	var car := _create_actor("car", String(spec["name"]), v_type, col, w * 0.5, h)
	car.collision_layer = 4
	car.collision_mask = 1 | 2 | 4
	car.cruise_speed = float(spec["speed"])
	car.road_axis = "x" if (idx % 2 == 0) else "z"
	car.road_coord = WorldTerrain.ROAD_COORDS[idx % WorldTerrain.ROAD_COORDS.size()]
	car.move_dir = 1.0 if (idx % 4 < 2) else -1.0
	var four := WorldTerrain.is_four_lane(car.road_coord)
	var base_lane := (4.4 if idx % 3 == 0 else 2.0) if four else 2.3
	car.lane_offset = base_lane * car.move_dir

	var s_pos := -210.0 + fmod(float(idx) * 47.0, 420.0)
	var cx := s_pos if car.road_axis == "x" else (car.road_coord + car.lane_offset)
	var cz := (car.road_coord + car.lane_offset) if car.road_axis == "x" else s_pos
	car.position = Vector3(cx, WorldTerrain.floor_at(cx, cz) + 0.1, cz)

	_build_car_mesh_with_glass(car, v_type, w, h, l, col)
	add_child(car)
	cars.append(car)

func _build_car_mesh_with_glass(car: WorldActor, v_type: String, w: float, h: float, l: float, col: String) -> void:
	var root := Node3D.new()
	car.add_child(root)

	var body_h := h * 0.46
	var chassis_y := 0.36 + body_h * 0.5

	# 1) Lower Sculpted Vehicle Body + Bumpers + Grille + Headlights + Taillights
	_box(root, Vector3(0.0, chassis_y, 0.0), Vector3(w, body_h, l), col)
	if v_type == "police_car":
		# Classic white side doors on Police Cruiser
		_box(root, Vector3(0.0, chassis_y, 0.0), Vector3(w + 0.03, body_h * 0.88, l * 0.48), "#f8f9fa")
	elif v_type == "race_car":
		# White racing stripe along hood & roof
		_box(root, Vector3(0.0, chassis_y + body_h * 0.51, 0.0), Vector3(0.38, 0.03, l * 0.96), "#f8f9fa")

	# Front & Rear Bumpers + Radiator Grille
	_box(root, Vector3(0.0, 0.34, l * 0.50), Vector3(w * 0.96, 0.22, 0.16), "#2b2d42")
	_box(root, Vector3(0.0, 0.34, -l * 0.50), Vector3(w * 0.96, 0.22, 0.16), "#2b2d42")
	_box(root, Vector3(0.0, chassis_y, l * 0.505), Vector3(w * 0.48, body_h * 0.48, 0.06), "#1b1f2a")

	# Glowing Headlights (+z) & Red Taillights (-z)
	for sx in [-1.0, 1.0]:
		_box(root, Vector3(sx * w * 0.34, chassis_y + 0.04, l * 0.505), Vector3(0.32, 0.18, 0.06), "#fff3b0", Vector3.ZERO, true)
		_box(root, Vector3(sx * w * 0.34, chassis_y + 0.04, -l * 0.505), Vector3(0.34, 0.18, 0.06), "#ef233c", Vector3.ZERO, true)

	# 2) Interior Seat + Steering Wheel + Visible Seated Driver!
	var seat := Node3D.new()
	seat.position = Vector3(-0.35 if w > 2.2 else 0.0, 0.42, 0.22 if v_type != "city_bus" else l * 0.30)
	root.add_child(seat)
	car.seat_node = seat
	_box(seat, Vector3(0.0, 0.25, -0.15), Vector3(0.52, 0.55, 0.12), "#2b2d42")
	_cyl(seat, Vector3(0.0, 0.48, 0.36), 0.16, 0.16, 0.05, "#1b1f2a", Vector3(deg_to_rad(65.0), 0.0, 0.0))

	var drv := Node3D.new()
	seat.add_child(drv)
	car.driver_visual = drv
	_box(drv, Vector3(0.0, 0.32, 0.0), Vector3(0.36, 0.44, 0.22), "#ff9f1c" if v_type != "police_car" else "#3a86ff")
	_sphere(drv, Vector3(0.0, 0.68, 0.0), 0.15, 0.30, "#f4cbb2")
	_box(drv, Vector3(0.0, 0.80, 0.0), Vector3(0.30, 0.10, 0.30), "#3d2618")

	# 3) Framed Transparent Windshields & Windows + Solid Roof Cap
	var cab_h := h * 0.46
	var cab_y := 0.36 + body_h + cab_h * 0.5
	var cab_l := l * (0.88 if v_type == "city_bus" else (0.36 if v_type == "fire_truck" else 0.52))
	var cab_z := l * 0.24 if v_type == "fire_truck" else -0.08

	if v_type == "roadster":
		# Open-top roadster: angled transparent front windshield + rollbars behind seat
		_box_glass(root, Vector3(0.0, cab_y - 0.04, 0.68), Vector3(w * 0.88, cab_h * 0.88, 0.07), "#a8dadc", 0.38, Vector3(deg_to_rad(-28.0), 0.0, 0.0))
		for rx in [-0.32, 0.32]:
			_box(root, Vector3(rx, cab_y - 0.08, -0.38), Vector3(0.12, cab_h * 0.75, 0.12), "#adb5bd")
	else:
		# Separate front windshield, rear window, and side glass panels so there are no internal cube artifacts!
		_box_glass(root, Vector3(0.0, cab_y, cab_z + cab_l * 0.49), Vector3(w * 0.86, cab_h * 0.88, 0.06), "#caf0f8", 0.34, Vector3(deg_to_rad(-14.0), 0.0, 0.0))
		_box_glass(root, Vector3(0.0, cab_y, cab_z - cab_l * 0.49), Vector3(w * 0.86, cab_h * 0.88, 0.06), "#caf0f8", 0.34, Vector3(deg_to_rad(12.0), 0.0, 0.0))
		for sx in [-1.0, 1.0]:
			_box_glass(root, Vector3(sx * w * 0.45, cab_y, cab_z), Vector3(0.05, cab_h * 0.86, cab_l * 0.92), "#caf0f8", 0.30)

		# Solid Roof Cap + Corner Pillars
		var roof_col := "#f8f9fa" if (v_type == "police_car" or v_type == "city_bus") else col
		_box(root, Vector3(0.0, cab_y + cab_h * 0.48, cab_z), Vector3(w * 0.92, 0.12, cab_l + 0.08), roof_col)
		for px in [-1.0, 1.0]:
			for pz in [-1.0, 1.0]:
				_box(root, Vector3(px * w * 0.44, cab_y, cab_z + pz * cab_l * 0.46), Vector3(0.10, cab_h, 0.10), col)

	# 4) Special Vehicle Roof & Rear Equipment
	if v_type == "fire_truck":
		# Rear Fire Engine Pump Compartment + Silver Roll-Up Lockers + Turntable Ladder + Sirens
		_box(root, Vector3(0.0, cab_y - 0.08, -l * 0.18), Vector3(w * 0.94, cab_h * 0.86, l * 0.52), "#d62828")
		_box(root, Vector3(0.0, cab_y - 0.08, -l * 0.18), Vector3(w * 0.97, cab_h * 0.62, l * 0.38), "#adb5bd")
		_box(root, Vector3(0.0, h + 0.38, -0.35), Vector3(0.68, 0.18, l * 0.72), "#f8f9fa")
		_box(root, Vector3(-0.52, h + 0.38, l * 0.34), Vector3(0.30, 0.18, 0.28), "#ffbe0b", Vector3.ZERO, true)
		_box(root, Vector3(0.52, h + 0.38, l * 0.34), Vector3(0.30, 0.18, 0.28), "#e63946", Vector3.ZERO, true)
	elif v_type == "police_car":
		_box(root, Vector3(-0.32, h + 0.34, cab_z), Vector3(0.34, 0.14, 0.24), "#e63946", Vector3.ZERO, true)
		_box(root, Vector3(0.32, h + 0.34, cab_z), Vector3(0.34, 0.14, 0.24), "#3a86ff", Vector3.ZERO, true)
	elif v_type == "race_car":
		_box(root, Vector3(-0.55, 0.42 + body_h + 0.14, -l * 0.42), Vector3(0.08, 0.28, 0.24), "#1d3557")
		_box(root, Vector3(0.55, 0.42 + body_h + 0.14, -l * 0.42), Vector3(0.08, 0.28, 0.24), "#1d3557")
		_box(root, Vector3(0.0, 0.42 + body_h + 0.28, -l * 0.44), Vector3(w * 0.98, 0.10, 0.40), "#1d3557")
	elif v_type == "city_bus":
		_box(root, Vector3(0.0, cab_y + cab_h * 0.32, l * 0.49), Vector3(w * 0.65, 0.26, 0.08), "#ffbe0b", Vector3.ZERO, true)

	# 5) 4 Round Cylindrical Wheels + Alloy Hubcaps!
	var wheel_r := 0.38 if (v_type == "city_bus" or v_type == "fire_truck") else 0.33
	var rim_col := "#ffd166" if v_type == "race_car" else "#dee2e6"
	var wheel_rot := Vector3(0.0, 0.0, PI * 0.5)
	for wx in [-w * 0.48, w * 0.48]:
		for wz in [-l * 0.31, l * 0.31]:
			_cyl(root, Vector3(wx, wheel_r, wz), wheel_r, wheel_r, 0.26, "#1b1f2a", wheel_rot)
			_cyl(root, Vector3(wx, wheel_r, wz), wheel_r * 0.56, wheel_r * 0.56, 0.29, rim_col, wheel_rot)

func _spawn_roaming_boat(idx: int) -> void:
	var stripe_col := "#e63946" if idx % 2 == 0 else "#0077b6"
	var boat := _create_actor("boat", "Sea Cruiser #%d" % (idx + 1), "speedboat", stripe_col, 1.4, 1.6)
	boat.collision_layer = 4
	boat.collision_mask = 1 | 2 | 4
	boat.boat_angle = float(idx) * TAU / 5.0
	boat.boat_radius = 48.0 + float(idx % 3) * 18.0
	boat.cruise_speed = 14.0

	var bx := boat.boat_center.x + cos(boat.boat_angle) * boat.boat_radius
	var bz := boat.boat_center.y + sin(boat.boat_angle) * boat.boat_radius
	boat.position = Vector3(bx, WorldTerrain.WATER_Y + 0.15, bz)

	var root := Node3D.new()
	boat.add_child(root)
	# Sleek V-Bow Speedboat Hull + Racing Stripe + Teak Deck + Glass Windshield + Twin Outboard Motors
	_box(root, Vector3(0.0, 0.35, -0.3), Vector3(2.3, 0.74, 4.4), "#f8f9fa")
	_cyl(root, Vector3(0.0, 0.36, 2.55), 0.08, 1.15, 1.45, "#f8f9fa", Vector3(PI * 0.5, 0.0, 0.0))
	_box(root, Vector3(0.0, 0.62, -0.2), Vector3(2.38, 0.16, 4.5), stripe_col)
	_box(root, Vector3(0.0, 0.66, -0.3), Vector3(1.95, 0.12, 3.8), "#d4a373")
	_box(root, Vector3(0.0, 0.85, 0.85), Vector3(1.85, 0.24, 0.35), "#2b2d42")
	_box_glass(root, Vector3(0.0, 1.12, 0.92), Vector3(1.85, 0.56, 0.08), "#90e0ef", 0.36, Vector3(deg_to_rad(-28.0), 0.0, 0.0))
	for sx in [-0.55, 0.55]:
		_cyl(root, Vector3(sx, 0.28, -2.65), 0.22, 0.26, 0.55, "#2b2d42", Vector3(PI * 0.5, 0.0, 0.0))

	var seat := Node3D.new()
	seat.position = Vector3(0.0, 0.62, 0.10)
	root.add_child(seat)
	boat.seat_node = seat

	var drv := Node3D.new()
	seat.add_child(drv)
	boat.driver_visual = drv
	_box(drv, Vector3(0.0, 0.32, 0.0), Vector3(0.36, 0.44, 0.22), "#00b4d8")
	_sphere(drv, Vector3(0.0, 0.68, 0.0), 0.15, 0.30, "#f4cbb2")
	_box(drv, Vector3(0.0, 0.80, 0.0), Vector3(0.30, 0.10, 0.30), "#3d2618")

	add_child(boat)
	boats.append(boat)

func _spawn_pedestrian(idx: int) -> void:
	var shirts: Array[String] = ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#8338ec", "#fb5607"]
	var pants: Array[String] = ["#2b2d42", "#1d3557", "#495057", "#3d405b"]
	var hairs: Array[String] = ["#3d2618", "#5c3d2e", "#d4a373", "#1b1f2a"]
	var ped := _create_actor("npc", "Citizen #%d" % (idx + 1), "Pedestrian", shirts[idx % shirts.size()], 0.34, 1.72)
	ped.collision_layer = 8
	ped.collision_mask = 1 | 2 | 4
	ped.road_axis = "x" if (idx % 2 == 0) else "z"
	ped.road_coord = WorldTerrain.ROAD_COORDS[idx % WorldTerrain.ROAD_COORDS.size()]
	var side := (WorldTerrain.road_width(ped.road_coord) * 0.5 + 1.1) * (1.0 if idx % 3 == 0 else -1.0)
	ped.lane_offset = side
	ped.move_dir = 1.0 if (idx % 2 == 0) else -1.0
	ped.cruise_speed = 1.65

	var s_pos := -200.0 + fmod(float(idx) * 37.0, 400.0)
	var px := s_pos if ped.road_axis == "x" else (ped.road_coord + ped.lane_offset)
	var pz := (ped.road_coord + ped.lane_offset) if ped.road_axis == "x" else s_pos
	ped.position = Vector3(px, WorldTerrain.floor_at(px, pz) + 0.18, pz)

	_build_stylized_human(ped, 0.96, shirts[idx % shirts.size()], pants[idx % pants.size()], hairs[idx % hairs.size()])
	add_child(ped)
	pedestrians.append(ped)

func _create_actor(kind: String, a_name: String, role: String, p_color: String, radius: float, height: float) -> WorldActor:
	var a := WorldActor.new()
	a.actor_kind = kind
	a.actor_name = a_name
	a.actor_role = role
	a.portrait_color = p_color
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = radius
	cap.height = maxf(height, radius * 2.1)
	cs.shape = cap
	cs.position = Vector3(0.0, cap.height * 0.5, 0.0)
	a.add_child(cs)
	return a

func trigger_shockwave(origin: Vector3, radius: float, force: float, is_meteor: bool) -> void:
	var ring_mi := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.5
	cyl.bottom_radius = 1.5
	cyl.height = 0.25
	ring_mi.mesh = cyl
	ring_mi.position = origin + Vector3(0.0, 0.2, 0.0)
	ring_mi.material_override = GameSettings.mat("#ff5400" if is_meteor else "#ffd166", 0.3, 0.78, true)
	add_child(ring_mi)
	shockwave_rings.append({"node": ring_mi, "age": 0.0, "max_r": radius})

	for group in [cars, pedestrians]:
		for act: WorldActor in group:
			if not is_instance_valid(act) or act.player_driving:
				continue
			var d := act.global_position.distance_to(origin)
			if d <= radius:
				var push := (act.global_position - origin).normalized()
				act.apply_raptor_hit(push, force * (1.0 - d / (radius * 1.2)), true)

func step_world(delta: float) -> void:
	_time_of_day += delta

	for i in range(shockwave_rings.size() - 1, -1, -1):
		var sw: Dictionary = shockwave_rings[i]
		sw["age"] = float(sw["age"]) + delta
		var t := float(sw["age"]) / 0.55
		var node: MeshInstance3D = sw["node"]
		if t >= 1.0:
			if is_instance_valid(node):
				node.queue_free()
			shockwave_rings.remove_at(i)
		elif is_instance_valid(node):
			var sc := lerpf(1.0, float(sw["max_r"]) * 0.5, t)
			node.scale = Vector3(sc, 1.0, sc)

	# Step Family NPC daily patrol routines + limb walk swing
	for i in range(family_npcs.size()):
		var f := family_npcs[i]
		if not is_instance_valid(f):
			continue
		var phase := _time_of_day * 0.35 + float(i) * 1.4
		var base_x := -16.0 if i < 3 else 91.5
		var base_z := (44.0 + float(i) * 2.0) if i < 3 else -80.0
		var tx := base_x + cos(phase) * 5.0
		var tz := base_z + sin(phase) * 5.0
		var dir := Vector3(tx - f.global_position.x, 0.0, tz - f.global_position.z)
		if dir.length() > 0.2:
			f.rotation.y = lerp_angle(f.rotation.y, atan2(dir.x, dir.z), minf(1.0, 6.0 * delta))
		f.global_position.x = move_toward(f.global_position.x, tx, 1.5 * delta)
		f.global_position.z = move_toward(f.global_position.z, tz, 1.5 * delta)
		f.global_position.y = WorldTerrain.floor_at(f.global_position.x, f.global_position.z)
		_animate_actor_limbs(f, _time_of_day * 4.2 + float(i))

	for c in cars:
		if not is_instance_valid(c) or c.player_driving:
			continue
		_step_ground_actor(c, delta, 240.0)

	for i in range(pedestrians.size()):
		var p := pedestrians[i]
		if not is_instance_valid(p):
			continue
		_step_ground_actor(p, delta, 225.0)
		_animate_actor_limbs(p, _time_of_day * 5.5 + float(i) * 0.7)

	for b in boats:
		if not is_instance_valid(b) or b.player_driving:
			continue
		b.boat_angle += (b.cruise_speed / maxf(25.0, b.boat_radius)) * delta
		var bx := b.boat_center.x + cos(b.boat_angle) * b.boat_radius
		var bz := b.boat_center.y + sin(b.boat_angle) * b.boat_radius
		var dx := -sin(b.boat_angle)
		var dz := cos(b.boat_angle)
		b.rotation.y = atan2(dx, dz)
		b.global_position = Vector3(bx, WorldTerrain.WATER_Y + 0.15 + sin(_time_of_day * 2.5 + b.boat_angle) * 0.08, bz)

func _animate_actor_limbs(act: WorldActor, phase: float) -> void:
	var sw := sin(phase) * 0.45
	if act.has_meta("leg_l"):
		var ll: Node3D = act.get_meta("leg_l")
		var lr: Node3D = act.get_meta("leg_r")
		ll.rotation.x = sw
		lr.rotation.x = -sw
	if act.has_meta("arm_l"):
		var al: Node3D = act.get_meta("arm_l")
		var ar: Node3D = act.get_meta("arm_r")
		al.rotation.x = -sw * 0.7
		ar.rotation.x = sw * 0.7

func _step_ground_actor(act: WorldActor, delta: float, wrap_bound: float) -> void:
	if act.flung:
		act.velocity.y -= 28.0 * delta
		act.rotation.x += 4.5 * delta
		act.rotation.z += 3.2 * delta
		act.move_and_slide()
		var fy := WorldTerrain.floor_at(act.global_position.x, act.global_position.z)
		if act.global_position.y <= fy + 0.15 and act.velocity.y <= 0.0:
			act.global_position.y = fy + 0.1
			act.flung = false
			act.rotation.x = 0.0
			act.rotation.z = 0.0
		return

	if act.stun_timer > 0.0:
		act.stun_timer -= delta
		act.velocity.x = move_toward(act.velocity.x, 0.0, 18.0 * delta)
		act.velocity.z = move_toward(act.velocity.z, 0.0, 18.0 * delta)
		act.global_position.y = WorldTerrain.floor_at(act.global_position.x, act.global_position.z)
		return

	if act.road_axis == "x":
		act.velocity.x = act.move_dir * act.cruise_speed
		act.velocity.z = ((act.road_coord + act.lane_offset) - act.global_position.z) * 4.0
		act.rotation.y = PI * 0.5 if act.move_dir > 0.0 else -PI * 0.5
		if absf(act.global_position.x) > wrap_bound:
			act.global_position.x = -signf(act.global_position.x) * (wrap_bound - 4.0)
	else:
		act.velocity.z = act.move_dir * act.cruise_speed
		act.velocity.x = ((act.road_coord + act.lane_offset) - act.global_position.x) * 4.0
		act.rotation.y = 0.0 if act.move_dir > 0.0 else PI
		if absf(act.global_position.z) > wrap_bound:
			act.global_position.z = -signf(act.global_position.z) * (wrap_bound - 4.0)

	var y_off := 0.18 if act.actor_kind == "npc" else 0.08
	var gy := WorldTerrain.floor_at(act.global_position.x, act.global_position.z) + y_off
	act.velocity.y = (gy - act.global_position.y) * 12.0
	act.move_and_slide()

func _box(parent: Node3D, pos: Vector3, size: Vector3, color: String, rot := Vector3.ZERO, unshaded: bool = false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.rotation = rot
	mi.material_override = GameSettings.mat(color, 0.45, 1.0, unshaded)
	parent.add_child(mi)
	return mi

func _cyl(parent: Node3D, pos: Vector3, top_r: float, bot_r: float, h: float, color: String, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = top_r
	cm.bottom_radius = bot_r
	cm.height = h
	cm.radial_segments = 14
	mi.mesh = cm
	mi.position = pos
	mi.rotation = rot
	mi.material_override = GameSettings.mat(color, 0.48)
	parent.add_child(mi)
	return mi

func _box_glass(parent: Node3D, pos: Vector3, size: Vector3, color: String, alpha: float, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.rotation = rot
	mi.material_override = GameSettings.mat(color, 0.12, alpha)
	parent.add_child(mi)
	return mi

func _sphere(parent: Node3D, pos: Vector3, radius: float, height: float, color: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = radius
	sm.height = height
	sm.radial_segments = 10
	sm.rings = 5
	mi.mesh = sm
	mi.position = pos
	mi.material_override = GameSettings.mat(color, 0.50)
	parent.add_child(mi)
	return mi
