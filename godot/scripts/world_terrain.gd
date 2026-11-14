class_name WorldTerrain
extends Node3D

const WATER_Y: float = -0.5
const SEABED_Y: float = -3.4
const MAIN_HALF: float = 280.0
const PALM_CENTER := Vector2(500.0, -30.0)
const PALM_RADIUS: float = 115.0
const SPACE_Y: float = 300.0

const ROAD_COORDS: Array[float] = [-240.0, -180.0, -120.0, -60.0, 0.0, 60.0, 120.0, 180.0, 240.0]

var lab_pad_pos := Vector3(-30.0, 0.0, 46.0)
var professor_spawn := Vector3(-23.0, 0.0, 50.0)
var grandma_pos := Vector3(90.0, 0.0, -90.0)
var observatory_pos := Vector3(-165.0, 0.0, -165.0)
var refill_points: Array[Vector3] = []
var lighthouse_beam: Node3D = null

var _rng := RandomNumberGenerator.new()
var _batch_tools: Dictionary = {}
var _unit_box: BoxMesh = null

func _ready() -> void:
	_rng.seed = 20261115
	_unit_box = BoxMesh.new()
	_unit_box.size = Vector3.ONE

	lab_pad_pos.y = floor_at(lab_pad_pos.x, lab_pad_pos.z)
	professor_spawn.y = floor_at(professor_spawn.x, professor_spawn.z)
	grandma_pos.y = floor_at(grandma_pos.x, grandma_pos.z)
	observatory_pos.y = floor_at(observatory_pos.x, observatory_pos.z)

	_build_sea_and_terrain_mesh()
	_build_roads()
	_build_lab()
	_build_grandma_estate()
	_build_observatory_hilltop()
	_build_city_blocks()
	_build_palm_isle()
	_flush_batches()

func _process(delta: float) -> void:
	if lighthouse_beam != null:
		lighthouse_beam.rotate_y(delta * 1.1)

static func is_four_lane(coord: float) -> bool:
	return absf(coord) < 1.0 or absf(absf(coord) - 240.0) < 1.0

static func road_width(coord: float) -> float:
	return 14.0 if is_four_lane(coord) else 10.0

static func distance_to_land(x: float, z: float) -> float:
	var dx := maxf(absf(x) - MAIN_HALF, 0.0)
	var dz := maxf(absf(z) - MAIN_HALF, 0.0)
	var d_main := Vector2(dx, dz).length()
	var d_palm := maxf(0.0, Vector2(x - PALM_CENTER.x, z - PALM_CENTER.y).length() - PALM_RADIUS)
	return minf(d_main, d_palm)

static func floor_at(x: float, z: float) -> float:
	var d_land := distance_to_land(x, z)
	if d_land > 0.0:
		var shelf_t := clampf(d_land / 14.0, 0.0, 1.0)
		return lerpf(0.2, SEABED_Y, shelf_t)

	# Palm Isle elevation: beach rim rising to a central Lighthouse Hill (16.5 m)
	var palm_dist := Vector2(x - PALM_CENTER.x, z - PALM_CENTER.y).length()
	if palm_dist <= PALM_RADIUS:
		var edge_fade := clampf((PALM_RADIUS - palm_dist) / 22.0, 0.0, 1.0)
		var hill_t := clampf(1.0 - (palm_dist / 68.0), 0.0, 1.0)
		var hill_h := smoothstep(0.0, 1.0, hill_t) * 15.5
		return (1.0 + hill_h) * edge_fade

	# Main Island multi-height elevation:
	var coast_margin := minf(MAIN_HALF - absf(x), MAIN_HALF - absf(z))
	var coast_blend := smoothstep(0.0, 18.0, clampf(coast_margin, 0.0, 18.0))

	# Base downtown & midtown elevation = 2.0 m
	var h := 2.0

	# 1) Uptown / Observatory Hill in NW (-165, -165) -> plateau at +20 m (total 22 m)
	var d_obs := Vector2(x - (-165.0), z - (-165.0)).length()
	var obs_t := 1.0 - smoothstep(38.0, 105.0, d_obs)
	h += obs_t * 20.0

	# 2) Grandma's Hillside Terrace in NE (+90, -90) -> terrace at +9.5 m (total 11.5 m)
	var d_gm := Vector2(x - 90.0, z - (-90.0)).length()
	var gm_t := 1.0 - smoothstep(42.0, 105.0, d_gm)
	h += gm_t * 9.5

	# 3) Professor's Lab & West Suburb Terrace (-85, +85) -> terrace at +4.0 m (total 6.0 m)
	var d_lab := Vector2(x - (-85.0), z - 85.0).length()
	var lab_t := 1.0 - smoothstep(48.0, 115.0, d_lab)
	h += lab_t * 4.0

	# 4) SE Sunken Park / Lagoon Valley (+90, +90) -> dips gently by -1.1 m
	var d_park := Vector2(x - 90.0, z - 90.0).length()
	var park_t := 1.0 - smoothstep(25.0, 68.0, d_park)
	h -= park_t * 1.1

	return lerpf(0.35, h, coast_blend)

static func surface_at(x: float, z: float) -> float:
	return maxf(floor_at(x, z), WATER_Y)

static func water_depth(x: float, z: float) -> float:
	return maxf(0.0, WATER_Y - floor_at(x, z))

static func gravity_at(y: float) -> float:
	var t := clampf((y - (SPACE_Y - 60.0)) / 120.0, 0.0, 1.0)
	return 28.0 * (1.0 - 0.65 * t)

func _build_sea_and_terrain_mesh() -> void:
	# Deep Seabed Plane
	var seabed_mesh := PlaneMesh.new()
	seabed_mesh.size = Vector2(3200.0, 3200.0)
	var seabed_inst := MeshInstance3D.new()
	seabed_inst.mesh = seabed_mesh
	seabed_inst.position = Vector3(120.0, SEABED_Y, 0.0)
	seabed_inst.material_override = GameSettings.mat("#2b7a9e", 0.9)
	add_child(seabed_inst)

	# Translucent Turquoise LEGO City Sea Plane
	var water_mesh := PlaneMesh.new()
	water_mesh.size = Vector2(3200.0, 3200.0)
	var water_inst := MeshInstance3D.new()
	water_inst.mesh = water_mesh
	water_inst.position = Vector3(120.0, WATER_Y, 0.0)
	water_inst.material_override = GameSettings.mat("#3fa7d6", 0.18, 0.82)
	add_child(water_inst)

	# Sculpted Main Island + Sea Shelf + Palm Isle terrain mesh
	_build_grid_patch(Rect2(-305.0, -305.0, 610.0, 610.0), 120, 120)
	_build_grid_patch(Rect2(355.0, -175.0, 290.0, 290.0), 56, 56)

func _build_grid_patch(rect: Rect2, steps_x: int, steps_z: int) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)

	var dx := rect.size.x / float(steps_x)
	var dz := rect.size.y / float(steps_z)

	for ix in range(steps_x):
		var x0 := rect.position.x + float(ix) * dx
		var x1 := x0 + dx
		for iz in range(steps_z):
			var z0 := rect.position.y + float(iz) * dz
			var z1 := z0 + dz

			var p00 := Vector3(x0, floor_at(x0, z0), z0)
			var p10 := Vector3(x1, floor_at(x1, z0), z0)
			var p01 := Vector3(x0, floor_at(x0, z1), z1)
			var p11 := Vector3(x1, floor_at(x1, z1), z1)

			var c_avg := _terrain_color((p00 + p11) * 0.5)
			st.set_color(c_avg)
			st.add_vertex(p00)
			st.add_vertex(p10)
			st.add_vertex(p11)

			st.set_color(c_avg)
			st.add_vertex(p00)
			st.add_vertex(p11)
			st.add_vertex(p01)

	st.generate_normals()
	var arr_mesh := st.commit()
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.86
	arr_mesh.surface_set_material(0, mat)

	var mi := MeshInstance3D.new()
	mi.mesh = arr_mesh
	add_child(mi)

	var sb := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = arr_mesh.create_trimesh_shape()
	sb.add_child(cs)
	add_child(sb)

func _terrain_color(p: Vector3) -> Color:
	if p.y < 0.85:
		return Color("#f2dca0") # Warm sandy beach & shallow shelf
	if p.y > 15.0:
		return Color("#6a994e") # Highland grass
	if p.y > 7.5:
		return Color("#7cb518") # Hillside meadow
	return Color("#8ccf6a") # Lush LEGO City park grass

func _build_roads() -> void:
	var seg_len := 6.0
	for r_coord in ROAD_COORDS:
		var four := is_four_lane(r_coord)
		var w := road_width(r_coord)
		var s := -246.0
		while s < 246.0:
			var mid := s + seg_len * 0.5
			var near_inter := false
			for rc in ROAD_COORDS:
				if absf(mid - rc) < (road_width(rc) * 0.5 + 1.5):
					near_inter = true
					break

			# 1) North-South Road Segment at x = r_coord
			var y_ns0 := floor_at(r_coord, s)
			var y_ns1 := floor_at(r_coord, s + seg_len)
			var y_ns := (y_ns0 + y_ns1) * 0.5
			var pitch_ns := atan2(y_ns1 - y_ns0, seg_len)
			var rot_ns := Vector3(pitch_ns, 0.0, 0.0)

			# Crisp Asphalt Road Ribbon
			_deco_box(Vector3(r_coord, y_ns + 0.04, mid), Vector3(w, 0.08, seg_len + 0.12), "#4a505c", rot_ns)

			if not near_inter:
				# Raised Concrete Sidewalks + Curbs on both sides
				for side: float in [-1.0, 1.0]:
					var sw_x := r_coord + side * (w * 0.5 + 1.1)
					var sw_y := (floor_at(sw_x, s) + floor_at(sw_x, s + seg_len)) * 0.5
					_deco_box(Vector3(sw_x, sw_y + 0.09, mid), Vector3(2.2, 0.18, seg_len + 0.08), "#d8dde6", rot_ns)
					_deco_box(Vector3(r_coord + side * (w * 0.5 + 0.12), sw_y + 0.11, mid), Vector3(0.24, 0.20, seg_len + 0.08), "#adb5bd", rot_ns)

				# Center lane lines
				if four:
					_deco_box(Vector3(r_coord - 0.18, y_ns + 0.09, mid), Vector3(0.14, 0.03, seg_len * 0.92), "#ffd166", rot_ns)
					_deco_box(Vector3(r_coord + 0.18, y_ns + 0.09, mid), Vector3(0.14, 0.03, seg_len * 0.92), "#ffd166", rot_ns)
					_deco_box(Vector3(r_coord - 3.5, y_ns + 0.09, mid), Vector3(0.16, 0.03, seg_len * 0.48), "#f8f9fa", rot_ns)
					_deco_box(Vector3(r_coord + 3.5, y_ns + 0.09, mid), Vector3(0.16, 0.03, seg_len * 0.48), "#f8f9fa", rot_ns)
				else:
					_deco_box(Vector3(r_coord, y_ns + 0.09, mid), Vector3(0.18, 0.03, seg_len * 0.48), "#f4f1de", rot_ns)

			# 2) East-West Road Segment at z = r_coord
			var y_ew0 := floor_at(s, r_coord)
			var y_ew1 := floor_at(s + seg_len, r_coord)
			var y_ew := (y_ew0 + y_ew1) * 0.5
			var pitch_ew := atan2(y_ew1 - y_ew0, seg_len)
			var rot_ew := Vector3(0.0, 0.0, -pitch_ew)

			_deco_box(Vector3(mid, y_ew + 0.042, r_coord), Vector3(seg_len + 0.12, 0.08, w), "#4a505c", rot_ew)

			if not near_inter:
				for side: float in [-1.0, 1.0]:
					var sw_z := r_coord + side * (w * 0.5 + 1.1)
					var sw_y := (floor_at(s, sw_z) + floor_at(s + seg_len, sw_z)) * 0.5
					_deco_box(Vector3(mid, sw_y + 0.09, sw_z), Vector3(seg_len + 0.08, 0.18, 2.2), "#d8dde6", rot_ew)
					_deco_box(Vector3(mid, sw_y + 0.11, r_coord + side * (w * 0.5 + 0.12)), Vector3(seg_len + 0.08, 0.20, 0.24), "#adb5bd", rot_ew)

				if four:
					_deco_box(Vector3(mid, y_ew + 0.092, r_coord - 0.18), Vector3(seg_len * 0.92, 0.03, 0.14), "#ffd166", rot_ew)
					_deco_box(Vector3(mid, y_ew + 0.092, r_coord + 0.18), Vector3(seg_len * 0.92, 0.03, 0.14), "#ffd166", rot_ew)
					_deco_box(Vector3(mid, y_ew + 0.092, r_coord - 3.5), Vector3(seg_len * 0.48, 0.03, 0.16), "#f8f9fa", rot_ew)
					_deco_box(Vector3(mid, y_ew + 0.092, r_coord + 3.5), Vector3(seg_len * 0.48, 0.03, 0.16), "#f8f9fa", rot_ew)
				else:
					_deco_box(Vector3(mid, y_ew + 0.092, r_coord), Vector3(seg_len * 0.48, 0.03, 0.18), "#f4f1de", rot_ew)

			s += seg_len

		# Intersections: Zebra Crosswalks, Streetlights & Fire Hydrants
		for z_coord in ROAD_COORDS:
			var wz := road_width(z_coord)
			var iy := floor_at(r_coord, z_coord)

			# Zebra crosswalk stripes on all 4 approaches of each intersection
			for dir_sign: float in [-1.0, 1.0]:
				var cw_z := z_coord + dir_sign * (wz * 0.5 + 1.4)
				var cw_y := floor_at(r_coord, cw_z) + 0.095
				for st_i in range(-2, 3):
					_deco_box(Vector3(r_coord + float(st_i) * 1.5, cw_y, cw_z), Vector3(0.65, 0.03, 1.8), "#f8f9fa")

				var cw_x := r_coord + dir_sign * (w * 0.5 + 1.4)
				var cw_y2 := floor_at(cw_x, z_coord) + 0.095
				for st_i in range(-2, 3):
					_deco_box(Vector3(cw_x, cw_y2, z_coord + float(st_i) * 1.5), Vector3(1.8, 0.03, 0.65), "#f8f9fa")

			# Corner Streetlight at every intersection
			var lamp_x := r_coord - (w * 0.5 + 1.3)
			var lamp_z := z_coord - (wz * 0.5 + 1.3)
			var lamp_y := floor_at(lamp_x, lamp_z)
			_deco_box(Vector3(lamp_x, lamp_y + 2.6, lamp_z), Vector3(0.18, 5.2, 0.18), "#2b2d42")
			_deco_box(Vector3(lamp_x + 0.6, lamp_y + 5.1, lamp_z), Vector3(1.4, 0.14, 0.18), "#2b2d42")
			_deco_box(Vector3(lamp_x + 1.15, lamp_y + 4.95, lamp_z), Vector3(0.42, 0.18, 0.32), "#fff3b0")

			# Detailed Fire Hydrant on alternating intersection corners
			if int(absf(r_coord + z_coord) / 60.0) % 2 == 0:
				var hx := r_coord + (w * 0.5) + 1.1
				var hz := z_coord + (wz * 0.5) + 1.1
				var hy := floor_at(hx, hz)
				_solid_cylinder(Vector3(hx, hy + 0.45, hz), 0.28, 0.9, "#e63946")
				_deco_box(Vector3(hx, hy + 0.92, hz), Vector3(0.42, 0.18, 0.42), "#ffd166")
				_deco_box(Vector3(hx, hy + 0.56, hz), Vector3(0.76, 0.16, 0.16), "#c1121f")
				refill_points.append(Vector3(hx, hy, hz))

func _build_lab() -> void:
	# Professor's High-Tech LEGO City Lab at (-30, z=28)
	var lx := -30.0
	var lz := 28.0
	var ly := floor_at(lx, lz)

	# Concrete compound plaza
	_deco_box(Vector3(lx, ly + 0.05, lz + 2.0), Vector3(46.0, 0.10, 46.0), "#d8dcd0")

	# Main Lab Building + Roof Trim + Foundation Plinth
	_solid_box(Vector3(lx, ly + 3.8, lz), Vector3(22.0, 8.2, 16.0), "#f4f6f8")
	_deco_box(Vector3(lx, ly + 0.4, lz), Vector3(22.4, 0.9, 16.4), "#2b2d42")
	_solid_box(Vector3(lx, ly + 8.15, lz), Vector3(23.0, 0.6, 17.0), "#3d5a80")

	# Skylight Dome + Glowing Beacon + Satellite Dish on Roof
	_solid_cylinder(Vector3(lx - 4.0, ly + 9.6, lz - 1.5), 4.6, 2.6, "#74c0fc")
	_deco_box(Vector3(lx - 4.0, ly + 11.2, lz - 1.5), Vector3(0.8, 0.8, 0.8), "#5ef2ff")
	_solid_cylinder(Vector3(lx + 7.5, ly + 9.2, lz + 2.5), 1.8, 1.2, "#dfe6ee")

	# Raptor Hangar Bay Door (left side) with horizontal slats + glowing cyan frame
	_deco_box(Vector3(lx - 4.2, ly + 2.4, lz + 8.08), Vector3(6.8, 4.8, 0.16), "#2b2d42")
	for slat in range(5):
		_deco_box(Vector3(lx - 4.2, ly + 0.7 + float(slat) * 0.88, lz + 8.16), Vector3(6.2, 0.68, 0.08), "#4a5568")
	_deco_box(Vector3(lx - 4.2, ly + 5.05, lz + 8.16), Vector3(7.2, 0.28, 0.22), "#5ef2ff")

	# Human Lab Entrance Door (right side) + Upper Lab Windows
	_deco_box(Vector3(lx + 5.5, ly + 1.35, lz + 8.08), Vector3(1.8, 2.7, 0.16), "#e63946")
	_deco_box(Vector3(lx + 5.5, ly + 2.95, lz + 8.18), Vector3(2.4, 0.24, 0.45), "#3d5a80")
	for wx in [-7.5, -2.5, 2.5, 7.5]:
		_deco_box(Vector3(lx + wx, ly + 6.0, lz + 8.08), Vector3(3.2, 1.6, 0.14), "#90e0ef")
		_deco_box(Vector3(lx + wx, ly + 6.0, lz - 8.08), Vector3(3.2, 1.6, 0.14), "#90e0ef")

	# Upgrade Bench beside the garage door (table + red toolbox + computer monitor + cookie jar)
	var bx := lx + 9.2
	var bz := lz + 9.8
	var by := floor_at(bx, bz)
	_solid_box(Vector3(bx, by + 0.55, bz), Vector3(3.2, 1.0, 1.4), "#8d6e63")
	_deco_box(Vector3(bx - 0.9, by + 1.28, bz - 0.15), Vector3(0.9, 0.5, 0.6), "#e63946")
	_deco_box(Vector3(bx + 0.5, by + 1.48, bz - 0.35), Vector3(1.2, 0.8, 0.12), "#2b2d42")
	_deco_box(Vector3(bx + 0.5, by + 1.48, bz - 0.27), Vector3(1.02, 0.62, 0.04), "#5ef2ff")
	_deco_box(Vector3(bx + 1.25, by + 1.25, bz + 0.25), Vector3(0.42, 0.46, 0.42), "#caf0f8")

	# Raptor Landing / Parking Pad with glowing ring & directional chevron
	var py := floor_at(lab_pad_pos.x, lab_pad_pos.z)
	_solid_cylinder(Vector3(lab_pad_pos.x, py + 0.10, lab_pad_pos.z), 5.6, 0.20, "#2e3440")
	_solid_cylinder(Vector3(lab_pad_pos.x, py + 0.14, lab_pad_pos.z), 4.8, 0.18, "#ffd166")
	_solid_cylinder(Vector3(lab_pad_pos.x, py + 0.18, lab_pad_pos.z), 4.1, 0.18, "#2e3440")
	_deco_box(Vector3(lab_pad_pos.x, py + 0.28, lab_pad_pos.z), Vector3(3.2, 0.04, 0.7), "#ffd166")
	_deco_box(Vector3(lab_pad_pos.x, py + 0.28, lab_pad_pos.z), Vector3(0.7, 0.04, 3.2), "#ffd166")
	# Driveway connecting pad to road
	_deco_box(Vector3(lab_pad_pos.x, py + 0.06, lab_pad_pos.z + 8.5), Vector3(8.0, 0.08, 9.0), "#6c757d")
	refill_points.append(lab_pad_pos)

func _build_grandma_estate() -> void:
	# Grandma Evelyn's (Prof's Mother's) Cozy 2-Storey House + Picket Fence Yard at (90, -90)
	var gx := grandma_pos.x
	var gz := grandma_pos.z
	var gy := floor_at(gx, gz)

	# Main 2-storey cottage + white trim band + pitched gable roof slopes + chimney
	_solid_box(Vector3(gx, gy + 3.6, gz), Vector3(14.0, 7.6, 12.0), "#f7c6c7")
	_deco_box(Vector3(gx, gy + 3.6, gz), Vector3(14.4, 0.28, 12.4), "#fff3e2")
	_solid_box(Vector3(gx, gy + 8.4, gz - 3.2), Vector3(15.4, 0.45, 7.6), "#b5485d", Vector3(deg_to_rad(28.0), 0.0, 0.0))
	_solid_box(Vector3(gx, gy + 8.4, gz + 3.2), Vector3(15.4, 0.45, 7.6), "#b5485d", Vector3(deg_to_rad(-28.0), 0.0, 0.0))
	_solid_box(Vector3(gx - 3.8, gy + 9.8, gz - 2.5), Vector3(1.3, 3.6, 1.3), "#8d5a4a")

	# Front Door + Covered Porch with White Posts + Garden Path
	var door_x := gx + 1.5
	_deco_box(Vector3(door_x, gy + 1.35, gz + 6.08), Vector3(1.7, 2.6, 0.16), "#6d4c41")
	_solid_box(Vector3(door_x, gy + 0.22, gz + 7.6), Vector3(6.2, 0.44, 3.2), "#d9b38c")
	_deco_box(Vector3(door_x - 2.6, gy + 1.75, gz + 8.9), Vector3(0.26, 3.0, 0.26), "#fff3e2")
	_deco_box(Vector3(door_x + 2.6, gy + 1.75, gz + 8.9), Vector3(0.26, 3.0, 0.26), "#fff3e2")
	_deco_box(Vector3(door_x, gy + 3.3, gz + 7.6), Vector3(6.6, 0.25, 3.6), "#b5485d")

	# Framed Cottage Windows
	for wx in [-4.5, 5.0]:
		_deco_box(Vector3(gx + wx, gy + 1.8, gz + 6.08), Vector3(1.8, 1.4, 0.12), "#fff3e2")
		_deco_box(Vector3(gx + wx, gy + 1.8, gz + 6.12), Vector3(1.5, 1.1, 0.12), "#9ad7ff")
	for wx in [-3.2, 3.2]:
		_deco_box(Vector3(gx + wx, gy + 5.4, gz + 6.08), Vector3(1.8, 1.4, 0.12), "#fff3e2")
		_deco_box(Vector3(gx + wx, gy + 5.4, gz + 6.12), Vector3(1.5, 1.1, 0.12), "#9ad7ff")

	# White Picket Fence & Pink Cookie Mailbox along the south garden edge
	var fz := gz + 22.0
	for fx_i in range(-15, 16):
		var fx := gx + float(fx_i) * 1.5
		if absf(fx - door_x) < 2.0:
			continue
		var fy := floor_at(fx, fz)
		_deco_box(Vector3(fx, fy + 0.55, fz), Vector3(0.16, 1.1, 0.16), "#ffffff")
	var f_mid_y := floor_at(gx, fz)
	_deco_box(Vector3(gx - 11.0, f_mid_y + 0.78, fz), Vector3(19.0, 0.12, 0.08), "#ffffff")
	_deco_box(Vector3(gx + 12.5, f_mid_y + 0.78, fz), Vector3(16.0, 0.12, 0.08), "#ffffff")
	# Pink Cookie Mailbox
	var mb_x := door_x + 2.4
	var mb_y := floor_at(mb_x, fz)
	_deco_box(Vector3(mb_x, mb_y + 0.6, fz), Vector3(0.18, 1.2, 0.18), "#8d5a4a")
	_deco_box(Vector3(mb_x, mb_y + 1.28, fz), Vector3(0.65, 0.45, 0.85), "#ff8fab")

	# Garden trees around Grandma's yard
	for offset: Vector2 in [Vector2(-14.0, 8.0), Vector2(14.0, 10.0), Vector2(-15.0, -10.0), Vector2(15.0, -12.0)]:
		var tx := gx + offset.x
		var tz := gz + offset.y
		_build_tree(Vector3(tx, floor_at(tx, tz), tz))

func _build_observatory_hilltop() -> void:
	# Uptown Observatory & Cliff Stunt Jump overlooking the city at (-165, -165)
	var ox := observatory_pos.x
	var oz := observatory_pos.z
	var oy := floor_at(ox, oz)
	_deco_box(Vector3(ox, oy + 0.08, oz), Vector3(32.0, 0.16, 32.0), "#d8dcd0")
	_solid_cylinder(Vector3(ox, oy + 5.0, oz), 9.2, 10.0, "#edf2f4")
	_deco_box(Vector3(ox, oy + 10.1, oz), Vector3(19.5, 0.4, 19.5), "#8d99ae")
	_solid_cylinder(Vector3(ox, oy + 12.0, oz), 7.8, 4.2, "#4ea8de")
	_deco_box(Vector3(ox + 3.5, oy + 12.6, oz + 3.5), Vector3(1.8, 3.2, 6.5), "#1d3557", Vector3(deg_to_rad(-25.0), deg_to_rad(45.0), 0.0))

	# Stunt jump ramp pointing SE toward Downtown + Ring-Road Stunt Ramps
	_build_stunt_ramp(ox + 26.0, oz + 26.0, deg_to_rad(45.0))
	_build_stunt_ramp(254.0, -60.0, 0.0)
	_build_stunt_ramp(-254.0, 60.0, PI)
	_build_stunt_ramp(-120.0, 254.0, -PI * 0.5)
	_build_stunt_ramp(-60.0, -254.0, PI * 0.5)

func _build_stunt_ramp(rx: float, rz: float, yaw: float) -> void:
	var ry := floor_at(rx, rz)
	var pitch := deg_to_rad(-20.0)
	var rot := Vector3(pitch, yaw, 0.0)
	_solid_box(Vector3(rx, ry + 1.4, rz), Vector3(6.2, 0.5, 12.0), "#f4a261", rot)
	_deco_box(Vector3(rx, ry + 1.68, rz), Vector3(4.4, 0.08, 8.5), "#ffffff", rot)
	var hi_off := Vector3(sin(yaw) * 4.8, 0.0, cos(yaw) * 4.8)
	_solid_box(Vector3(rx + hi_off.x, ry + 1.1, rz + hi_off.z), Vector3(5.8, 2.4, 1.4), "#6d6875", Vector3(0.0, yaw, 0.0))

func _build_city_blocks() -> void:
	var palette: Array[String] = [
		"#f4a261", "#e9c46a", "#74c0fc", "#ffd6a5",
		"#95d5b2", "#b197fc", "#ff8fa3", "#e9ecef",
		"#f28482", "#84a59d", "#f6bd60", "#a8dadc"
	]
	var shop_colors: Array[String] = ["#2b2d42", "#3d405b", "#495057", "#5c3d2e", "#1d3557"]
	var awning_colors: Array[String] = ["#e63946", "#2a9d8f", "#fb8500", "#3a86ff", "#8338ec"]

	for bx_i in range(-4, 4):
		for bz_i in range(-4, 4):
			var bx := float(bx_i) * 60.0 + 30.0
			var bz := float(bz_i) * 60.0 + 30.0

			# Skip special landmark blocks (Lab, Grandma's Estate, Observatory Hilltop)
			if absf(bx - (-30.0)) < 5.0 and absf(bz - 30.0) < 5.0:
				continue
			if absf(bx - 90.0) < 5.0 and absf(bz - (-90.0)) < 5.0:
				continue
			if bx < -110.0 and bz < -110.0:
				continue

			# Park & Fountain Blocks at (90, 90), (30, -30), and (-90, 150)
			if (absf(bx - 90.0) < 5.0 and absf(bz - 90.0) < 5.0) or (absf(bx - 30.0) < 5.0 and absf(bz - (-30.0)) < 5.0) or (absf(bx - (-90.0)) < 5.0 and absf(bz - 150.0) < 5.0):
				_build_park_block(bx, bz)
				continue

			# Concrete city block courtyard pad
			var by_center := floor_at(bx, bz)
			_deco_box(Vector3(bx, by_center + 0.04, bz), Vector3(44.0, 0.12, 44.0), "#d8dcd0")

			var downtown := Vector2(bx, bz).length() < 125.0
			for qx in [-1, 1]:
				for qz in [-1, 1]:
					if _rng.randf() < (0.10 if downtown else 0.24):
						var tx := bx + float(qx) * 11.5
						var tz := bz + float(qz) * 11.5
						_build_tree(Vector3(tx, floor_at(tx, tz), tz))
						continue

					var cx := bx + float(qx) * 11.5
					var cz := bz + float(qz) * 11.5
					var cy := floor_at(cx, cz)
					var storeys := _rng.randi_range(4, 8) if downtown else _rng.randi_range(2, 4)
					var storey_h := 3.8
					var bh := float(storeys) * storey_h
					var bw := _rng.randf_range(12.2, 15.6)
					var bd := _rng.randf_range(12.2, 15.6)
					var col: String = palette[_rng.randi() % palette.size()]
					var shop_col: String = shop_colors[_rng.randi() % shop_colors.size()]
					var awn_col: String = awning_colors[_rng.randi() % awning_colors.size()]

					# 1) Main building volume (extended 2.5m into ground so hills never leave gaps)
					_solid_box(Vector3(cx, cy + bh * 0.5 - 1.0, cz), Vector3(bw, bh + 2.0, bd), col)

					# 2) Ground-floor LEGO City Shopfront Plinth + Cornice Ledge
					_deco_box(Vector3(cx, cy + 1.85, cz), Vector3(bw + 0.22, 3.7, bd + 0.22), shop_col)
					_deco_box(Vector3(cx, cy + 3.75, cz), Vector3(bw + 0.52, 0.28, bd + 0.52), "#edf2f4")

					# 3) Street-facing Entrance Door + Striped Awning + Shop Display Windows
					var door_z := cz + (bd * 0.5 + 0.16) * float(qz)
					_deco_box(Vector3(cx, cy + 1.35, door_z), Vector3(1.8, 2.7, 0.16), "#e63946" if downtown else "#8d5a3b")
					_deco_box(Vector3(cx, cy + 2.95, door_z + 0.42 * float(qz)), Vector3(3.2, 0.26, 0.95), awn_col)
					_deco_box(Vector3(cx, cy + 2.97, door_z + 0.44 * float(qz)), Vector3(1.2, 0.27, 0.97), "#f8f9fa")
					for sx in [-1.0, 1.0]:
						_deco_box(Vector3(cx + sx * (bw * 0.28), cy + 1.75, door_z), Vector3(bw * 0.24, 1.65, 0.12), "#caf0f8")

					# 4) Individual Framed Window Grids on Upper Storeys + Floor Cornices
					for s_idx in range(1, storeys):
						var wy := cy + float(s_idx) * storey_h + 1.95
						# Subtle floor divider trim every 2 floors
						if s_idx % 2 == 0:
							_deco_box(Vector3(cx, cy + float(s_idx) * storey_h, cz), Vector3(bw + 0.36, 0.20, bd + 0.36), "#dee2e6")

						for w_col in [-1, 0, 1]:
							var wx_off := float(w_col) * (bw * 0.27)
							var wz_off := float(w_col) * (bd * 0.27)
							# North & South facades: dark frame + glowing cyan glass + white sill
							for fz_sign: float in [-1.0, 1.0]:
								var fz_pos := cz + fz_sign * (bd * 0.5 + 0.08)
								_deco_box(Vector3(cx + wx_off, wy, fz_pos), Vector3(1.85, 1.65, 0.10), "#2b2d42")
								_deco_box(Vector3(cx + wx_off, wy, fz_pos + fz_sign * 0.04), Vector3(1.55, 1.35, 0.08), "#90e0ef")
								_deco_box(Vector3(cx + wx_off, wy - 0.85, fz_pos + fz_sign * 0.06), Vector3(1.98, 0.14, 0.22), "#f8f9fa")
							# East & West facades
							for fx_sign: float in [-1.0, 1.0]:
								var fx_pos := cx + fx_sign * (bw * 0.5 + 0.08)
								_deco_box(Vector3(fx_pos, wy, cz + wz_off), Vector3(0.10, 1.65, 1.85), "#2b2d42")
								_deco_box(Vector3(fx_pos + fx_sign * 0.04, wy, cz + wz_off), Vector3(0.08, 1.35, 1.55), "#90e0ef")
								_deco_box(Vector3(fx_pos + fx_sign * 0.06, wy - 0.85, cz + wz_off), Vector3(0.22, 0.14, 1.98), "#f8f9fa")

					# 5) Rooftop Parapet + AC Units / Rooftop Details
					var roof_y := cy + bh
					_deco_box(Vector3(cx, roof_y + 0.25, cz), Vector3(bw + 0.65, 0.50, bd + 0.65), "#343a40")
					_deco_box(Vector3(cx, roof_y + 0.55, cz), Vector3(bw - 0.9, 0.35, bd - 0.9), "#495057")
					# Rooftop HVAC / Skylight
					_deco_box(Vector3(cx - bw * 0.22, roof_y + 1.1, cz - bd * 0.20), Vector3(2.4, 1.2, 2.0), "#adb5bd")
					if downtown and storeys >= 5:
						_deco_box(Vector3(cx + bw * 0.22, roof_y + 1.6, cz + bd * 0.20), Vector3(2.2, 2.2, 2.2), "#8d5a3b")
						_deco_box(Vector3(cx + bw * 0.22, roof_y + 2.85, cz + bd * 0.20), Vector3(2.5, 0.35, 2.5), "#2b2d42")

func _build_park_block(bx: float, bz: float) -> void:
	var py := floor_at(bx, bz)
	# Paved central plaza + stone fountain basin + turquoise water + center spout
	_deco_box(Vector3(bx, py + 0.05, bz), Vector3(14.0, 0.10, 14.0), "#e2c79f")
	_solid_cylinder(Vector3(bx, py + 0.45, bz), 3.6, 0.9, "#d9d9d9")
	_solid_cylinder(Vector3(bx, py + 0.82, bz), 3.1, 0.25, "#4cc9f0")
	_solid_cylinder(Vector3(bx, py + 1.45, bz), 0.45, 1.8, "#bfc5cc")
	_deco_box(Vector3(bx, py + 2.45, bz), Vector3(1.1, 0.85, 1.1), "#90e0ef")
	refill_points.append(Vector3(bx, py, bz))

	# Park benches & lush multi-cluster trees
	for side: float in [-1.0, 1.0]:
		var bench_y := floor_at(bx + side * 5.8, bz)
		_deco_box(Vector3(bx + side * 5.8, bench_y + 0.35, bz), Vector3(0.8, 0.45, 2.6), "#8d5a3b")
	for t in range(7):
		var ang := float(t) * TAU / 7.0
		var tx := bx + cos(ang) * 15.5
		var tz := bz + sin(ang) * 15.5
		_build_tree(Vector3(tx, floor_at(tx, tz), tz))

func _build_palm_isle() -> void:
	# Classic Striped Lighthouse on the peak of Palm Isle's central hill
	var lx := PALM_CENTER.x + 12.0
	var lz := PALM_CENTER.y - 8.0
	var ly := floor_at(lx, lz)
	_solid_cylinder(Vector3(lx, ly + 9.0, lz), 3.6, 18.0, "#f8f9fa")
	_solid_cylinder(Vector3(lx, ly + 6.0, lz), 3.72, 3.8, "#e63946")
	_solid_cylinder(Vector3(lx, ly + 13.5, lz), 3.65, 3.8, "#e63946")
	_solid_cylinder(Vector3(lx, ly + 18.2, lz), 4.2, 0.6, "#2b2d42")
	_solid_cylinder(Vector3(lx, ly + 19.6, lz), 2.8, 2.6, "#ffd166")
	_solid_cylinder(Vector3(lx, ly + 21.3, lz), 3.2, 1.0, "#e63946")

	lighthouse_beam = Node3D.new()
	lighthouse_beam.position = Vector3(lx, ly + 19.6, lz)
	add_child(lighthouse_beam)
	var beam_mesh := MeshInstance3D.new()
	var b_box := BoxMesh.new()
	b_box.size = Vector3(1.2, 1.2, 44.0)
	beam_mesh.mesh = b_box
	beam_mesh.position = Vector3(0.0, 0.0, 22.0)
	beam_mesh.material_override = GameSettings.mat("#fff3b0", 0.2, 0.42, true)
	lighthouse_beam.add_child(beam_mesh)

	# Wooden Boarding Piers facing each other across the sea channel
	var pier_y := WATER_Y + 0.85
	_solid_box(Vector3(284.0, pier_y, -30.0), Vector3(18.0, 0.55, 6.2), "#bc6c25")
	_solid_box(Vector3(PALM_CENTER.x - PALM_RADIUS - 4.0, pier_y, -30.0), Vector3(18.0, 0.55, 6.2), "#bc6c25")
	for px in [278.0, 290.0, PALM_CENTER.x - PALM_RADIUS - 10.0, PALM_CENTER.x - PALM_RADIUS + 2.0]:
		for pz in [-32.6, -27.4]:
			_deco_box(Vector3(px, pier_y - 0.6, pz), Vector3(0.45, 2.2, 0.45), "#6d4c41")

	# Curved Multi-Frond Palm Trees around the island slope
	for i in range(32):
		var ang := float(i) * TAU / 32.0 + _rng.randf_range(-0.08, 0.08)
		var rad := _rng.randf_range(24.0, PALM_RADIUS - 10.0)
		var px := PALM_CENTER.x + cos(ang) * rad
		var pz := PALM_CENTER.y + sin(ang) * rad
		_build_tree(Vector3(px, floor_at(px, pz), pz), true)

func _build_tree(pos: Vector3, palm: bool = false) -> void:
	if palm:
		# Curved 6-segment Palm Trunk + Coconuts + 7 Drooping Fronds!
		var height := _rng.randf_range(6.4, 8.2)
		var lean := _rng.randf_range(1.1, 2.0)
		var lean_dir := _rng.randf_range(0.0, TAU)
		var segs := 6
		var seg_h := height / float(segs)
		var top_x := pos.x
		var top_z := pos.z
		for i in range(segs):
			var t := float(i) / float(segs)
			var off := t * t * lean
			top_x = pos.x + cos(lean_dir) * off
			top_z = pos.z + sin(lean_dir) * off
			var w := 0.56 - float(i) * 0.045
			var col := "#9c6b3f" if (i % 2 == 0) else "#b07d4f"
			_deco_box(Vector3(top_x, pos.y + seg_h * (float(i) + 0.5), top_z), Vector3(w, seg_h * 1.08, w), col)

		_solid_cylinder(pos + Vector3(0.0, height * 0.45, 0.0), 0.36, height * 0.9, "#9c6b3f")
		var top_pos := Vector3(top_x, pos.y + height, top_z)
		_deco_box(top_pos + Vector3(0.0, -0.15, 0.0), Vector3(0.75, 0.45, 0.75), "#6d4c41")

		for k in range(7):
			var a := float(k) * TAU / 7.0 + _rng.randf_range(-0.15, 0.15)
			var pitch := 0.42 + _rng.randf_range(0.0, 0.18)
			var f_rot := Vector3(pitch, a, 0.0)
			var f_off := Vector3(sin(a) * 1.55, -0.25, cos(a) * 1.55)
			var f_col := "#2d9a4e" if (k % 2 == 0) else "#3fb35c"
			_deco_box(top_pos + f_off, Vector3(0.88, 0.14, 3.3), f_col, f_rot)
	else:
		# Stylized Multi-Cluster LEGO City Park / Street Tree
		var trunk_h := _rng.randf_range(3.2, 4.2)
		_solid_cylinder(pos + Vector3(0.0, trunk_h * 0.5, 0.0), 0.36, trunk_h, "#7f4f24")
		_deco_box(pos + Vector3(0.0, trunk_h + 0.9, 0.0), Vector3(2.9, 2.3, 2.9), "#38b000")
		_deco_box(pos + Vector3(0.55, trunk_h + 1.6, 0.45), Vector3(2.2, 1.9, 2.2), "#52b788")
		_deco_box(pos + Vector3(-0.5, trunk_h + 1.9, -0.35), Vector3(1.9, 1.6, 1.9), "#70e000")

func _solid_box(pos: Vector3, size: Vector3, color: String, rot := Vector3.ZERO) -> StaticBody3D:
	var sb := StaticBody3D.new()
	sb.position = pos
	sb.rotation = rot
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	sb.add_child(cs)
	add_child(sb)
	# Also batch its visual mesh into our per-color static array mesh for ultra-fast rendering
	_deco_box(pos, size, color, rot)
	return sb

func _solid_cylinder(pos: Vector3, radius: float, height: float, color: String) -> StaticBody3D:
	var sb := StaticBody3D.new()
	sb.position = pos
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = radius
	cm.bottom_radius = radius
	cm.height = height
	cm.radial_segments = 16
	mi.mesh = cm
	mi.material_override = GameSettings.mat(color)
	sb.add_child(mi)
	var cs := CollisionShape3D.new()
	var cshape := CylinderShape3D.new()
	cshape.radius = radius
	cshape.height = height
	cs.shape = cshape
	sb.add_child(cs)
	add_child(sb)
	return sb

func _deco_box(pos: Vector3, size: Vector3, color: String, rot := Vector3.ZERO) -> void:
	var st: SurfaceTool = _batch_tools.get(color)
	if st == null:
		st = SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_batch_tools[color] = st
	var basis := Basis.from_euler(rot).scaled(size)
	var xform := Transform3D(basis, pos)
	st.append_from(_unit_box, 0, xform)

func _flush_batches() -> void:
	for color: String in _batch_tools.keys():
		var st: SurfaceTool = _batch_tools[color]
		var arr_mesh := st.commit()
		var mi := MeshInstance3D.new()
		mi.mesh = arr_mesh
		mi.material_override = GameSettings.mat(color)
		add_child(mi)
	_batch_tools.clear()
